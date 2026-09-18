/**
 * Revisão das planilhas de atendimento dos backups (18/09/2026) — SÓ LÊ, não grava nada.
 *
 * Pedido: "revise as planilhas com todos os atendimentos, principalmente a do backup do HD,
 * acredito que não estão todos aqui; tem outros operadores que passaram pela central
 * (Cleverson, Gustavo, Roberto, Julia...)".
 *
 * Para cada planilha (.xlsx/.xlsm) acha as tabelas que têm coluna de OPERADOR e de DATA
 * (cada tabela pelo seu próprio cabeçalho), lê as linhas e compara com o banco pelo ID PR7.
 * Saída: logs/revisao-planilhas-AAAA-MM-DD.md (+ .json com o detalhe).
 * Uso: npx ts-node -T scripts/revisar-planilhas-backup.ts
 */
import * as ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, relative } from 'path';

const AREA = 'C:/Users/ferna/OneDrive/Área de Trabalho';
const RAIZES = [
  join(AREA, 'Projeto Financeiro PR7/backup_hd_pr7'),
  join(AREA, 'Projeto Financeiro PR7/backup_arquivo_pr7'),
  join(AREA, 'Projeto Financeiro PR7/backup_fechamentos'),
  join(AREA, 'Operadores'), join(AREA, 'Para organizar'), join(AREA, 'PR7PAT'), join(AREA, '01-FECHAMENTO'), join(AREA, 'planilhas dos apoios'),
];
const ARQUIVOS_SOLTOS = [
  join(AREA, 'Controle de Atendimentos e Pagamento de Apoios 2023.xlsx'),
  join(AREA, 'Controle de Atendimentos e Pagamento de Apoios 2023 (1).xlsx'),
  join(AREA, 'FECHAMENTO VEICULAR DEZEMBRO25 (2)(Recuperado Automaticamente).xlsx'),
  join(AREA, 'Sincro Julho.xlsx'), join(AREA, 'veicular abril.xlsx'), join(AREA, 'Joe Agosto.xlsx'),
  'C:/Users/ferna/OneDrive/PAGAMENTOS DE JAN A DEZEMBRO 2024.xlsx',
  'C:/Users/ferna/OneDrive/De Mattos-PAGAMENTOS DE JAN A DEZEMBRO 2025.xlsx',
];

const texto = (v: any): string => (v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' && 'richText' in v ? v.richText.map((r: any) => r.text).join('') : typeof v === 'object' && 'text' in v ? String(v.text) : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v)).trim();
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const R_OPERADOR = /^(operador|op\.?\s*pr7|operador\s*pr7|atendente|help\s*desk|operador\s*\(a\)|respons[aá]vel\s*pr7)/i;
const R_DATA = /^data(\s|$)|^data da|^data de|^dt\b|^dia$/i;
const R_ID = /^id(\s*pr7)?$|^id\s|^n[ºo°]?\s*id/i;

function lerData(v: any): Date | null {
  if (v instanceof Date) return isNaN(+v) ? null : v;
  if (typeof v === 'number' && v > 30000 && v < 60000) return new Date(Math.round((v - 25569) * 864e5));
  const t = texto(v);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const a = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const d = new Date(Date.UTC(a, +m[2] - 1, +m[1], 12)); return isNaN(+d) ? null : d; }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12)) : null;
}
const nomeValido = (t: string) => /[a-zà-ú]{3,}/i.test(t) && !/^\d/.test(t) && !/^(s\/i|nao consta|n\/a|-|rj|sp|ce|mg|pr)$/i.test(semAcento(t));

type Linha = { data: string; operador: string; id: string | null; arquivo: string; aba: string };

function* planilhas(): Generator<string> {
  const vistos = new Set<string>();
  const andar = function* (dir: string): Generator<string> {
    if (!existsSync(dir)) return;
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!/node_modules|\.git/.test(n)) yield* andar(p); }
      else if (/\.(xlsx|xlsm)$/i.test(n) && !n.startsWith('~$') && st.size < 80e6) yield p;
    }
  };
  for (const r of RAIZES) for (const p of andar(r)) if (!vistos.has(p)) { vistos.add(p); yield p; }
  for (const p of ARQUIVOS_SOLTOS) if (existsSync(p) && !vistos.has(p)) { vistos.add(p); yield p; }
}

async function lerArquivo(caminho: string): Promise<{ linhas: Linha[]; erro?: string; abas: number }> {
  const linhas: Linha[] = [];
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(caminho); } catch (e) { return { linhas, erro: (e as Error).message.slice(0, 120), abas: 0 }; }
  for (const ws of wb.worksheets) {
    // Cabeçalhos: linhas com coluna de operador E de data (cada tabela empilhada tem o seu)
    const cabs: { linha: number; op: number; data: number; id: number | null }[] = [];
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      const vals = (row.values as unknown[]).map(texto);
      const op = vals.findIndex((v, j) => j > 0 && R_OPERADOR.test(v));
      const dt = vals.findIndex((v, j) => j > 0 && R_DATA.test(v));
      if (op > 0 && dt > 0) { const id = vals.findIndex((v, j) => j > 0 && R_ID.test(v)); cabs.push({ linha: i, op, data: dt, id: id > 0 ? id : null }); }
    });
    for (let k = 0; k < cabs.length; k++) {
      const c = cabs[k], ate = cabs[k + 1]?.linha ?? ws.rowCount + 1;
      for (let i = c.linha + 1; i < ate; i++) {
        const row = ws.getRow(i);
        const data = lerData(row.getCell(c.data).value);
        const operador = texto(row.getCell(c.op).value).replace(/\s+/g, ' ');
        if (!data || data.getUTCFullYear() < 2019 || data.getUTCFullYear() > 2027) continue;
        const idv = c.id ? texto(row.getCell(c.id).value).replace(/\D/g, '') : '';
        linhas.push({ data: data.toISOString().slice(0, 10), operador, id: /^\d{4,6}$/.test(idv) ? idv : null, arquivo: caminho, aba: ws.name });
      }
    }
  }
  return { linhas, abas: wb.worksheets.length };
}

async function main() {
  const prisma = new PrismaClient();
  const noBanco = new Set((await prisma.atendimento.findMany({ where: { idPR7: { not: null } }, select: { idPR7: true } })).map((a) => a.idPR7!));
  const opsBanco = (await prisma.atendimento.groupBy({ by: ['operadorPR7'], _count: true })).map((o) => ({ nome: o.operadorPR7 ?? '', n: o._count }));
  const porMes = new Map((await prisma.$queryRaw<{ m: string; n: number }[]>`SELECT to_char(coalesce("solicitadoEm","createdAt"),'YYYY-MM') m, count(*)::int n FROM "Atendimento" GROUP BY 1`).map((x) => [x.m, x.n]));
  await prisma.$disconnect();
  const primeiroNomeNoBanco = (nome: string) => {
    const p = semAcento(nome).split(/\s+/)[0];
    return opsBanco.filter((o) => semAcento(o.nome).split(/\s+/)[0] === p).map((o) => `${o.nome} (${o.n})`);
  };

  const arquivos: { arquivo: string; linhas: number; periodo: string; operadores: string[]; comId: number; idsForaDoBanco: number; erro?: string }[] = [];
  const todas: Linha[] = [];
  let n = 0;
  for (const p of planilhas()) {
    n++;
    const r = await lerArquivo(p);
    if (!r.linhas.length && !r.erro) continue;
    const datas = r.linhas.map((l) => l.data).sort();
    const comId = r.linhas.filter((l) => l.id);
    arquivos.push({
      arquivo: relative(AREA, p).replace(/\\/g, '/'), linhas: r.linhas.length, periodo: datas.length ? `${datas[0]} → ${datas[datas.length - 1]}` : '—',
      operadores: [...new Set(r.linhas.map((l) => l.operador).filter(nomeValido))].slice(0, 25),
      comId: comId.length, idsForaDoBanco: new Set(comId.filter((l) => !noBanco.has(l.id!)).map((l) => l.id)).size, erro: r.erro,
    });
    todas.push(...r.linhas);
    process.stdout.write(`\r${n} planilhas lidas · ${todas.length} linhas com operador`);
  }
  console.log();

  // Operadores: nome como está na planilha (primeiro nome agrupa) × banco
  const ops = new Map<string, { grafias: Set<string>; linhas: number; de: string; ate: string; arquivos: Set<string> }>();
  for (const l of todas) {
    if (!nomeValido(l.operador)) continue;
    const chave = semAcento(l.operador).split(/\s+/)[0];
    const o = ops.get(chave) ?? { grafias: new Set(), linhas: 0, de: l.data, ate: l.data, arquivos: new Set() };
    o.grafias.add(l.operador); o.linhas++; o.arquivos.add(basename(l.arquivo));
    if (l.data < o.de) o.de = l.data; if (l.data > o.ate) o.ate = l.data;
    ops.set(chave, o);
  }
  // IDs das planilhas que não existem no banco, por mês (sem repetir o mesmo ID de arquivos diferentes)
  const idsFora = new Map<string, { data: string; operador: string; arquivos: Set<string> }>();
  for (const l of todas) if (l.id && !noBanco.has(l.id)) {
    const x = idsFora.get(l.id) ?? { data: l.data, operador: l.operador, arquivos: new Set<string>() };
    x.arquivos.add(basename(l.arquivo)); idsFora.set(l.id, x);
  }
  const foraPorMes = new Map<string, number>();
  for (const x of idsFora.values()) foraPorMes.set(x.data.slice(0, 7), (foraPorMes.get(x.data.slice(0, 7)) ?? 0) + 1);
  // Linhas por mês nas planilhas (sem repetir: mesma data+operador+id conta uma vez)
  const unicas = new Set(todas.map((l) => `${l.data}|${semAcento(l.operador)}|${l.id ?? ''}|${l.id ? '' : basename(l.arquivo) + l.aba}`));
  const planMes = new Map<string, number>();
  for (const u of unicas) { const m = u.slice(0, 7); planMes.set(m, (planMes.get(m) ?? 0) + 1); }

  const hoje = new Date().toISOString().slice(0, 10);
  mkdirSync(join(__dirname, '..', '..', '..', 'logs'), { recursive: true });
  const saida = join(__dirname, '..', '..', '..', 'logs', `revisao-planilhas-${hoje}`);
  const opsOrd = [...ops.entries()].sort((a, b) => b[1].linhas - a[1].linhas);
  const md = [
    `# Revisão das planilhas de atendimento — ${hoje}`, '',
    `Só leitura. ${n} planilhas abertas; ${arquivos.length} com tabela de atendimentos (coluna de operador + data); ${todas.length} linhas lidas (com repetição entre arquivos: validações e prévias repetem o controle principal).`, '',
    '## Operadores encontrados nas planilhas × banco', '',
    '| Operador (1º nome) | Grafias nas planilhas | Linhas | Período | No banco hoje |', '|---|---|---|---|---|',
    ...opsOrd.map(([k, o]) => `| ${k} | ${[...o.grafias].slice(0, 4).join(' / ')} | ${o.linhas} | ${o.de} → ${o.ate} | ${primeiroNomeNoBanco(k).join('; ') || '**NÃO ESTÁ**'} |`), '',
    '## Meses: linhas nas planilhas × atendimentos no banco', '',
    '| Mês | Linhas nas planilhas (sem repetir) | No banco | IDs das planilhas que não estão no banco |', '|---|---|---|---|',
    ...[...new Set([...planMes.keys(), ...porMes.keys()])].sort().map((m) => `| ${m} | ${planMes.get(m) ?? 0} | ${porMes.get(m) ?? 0} | ${foraPorMes.get(m) ?? 0} |`), '',
    '## Planilhas com atendimentos', '',
    '| Arquivo | Linhas | Período | Com ID | IDs fora do banco | Operadores |', '|---|---|---|---|---|---|',
    ...arquivos.sort((a, b) => b.linhas - a.linhas).map((a) => `| ${a.arquivo} | ${a.linhas} | ${a.periodo} | ${a.comId} | ${a.idsForaDoBanco} | ${a.erro ? 'ERRO: ' + a.erro : a.operadores.slice(0, 8).join(', ')} |`),
  ].join('\n');
  writeFileSync(saida + '.md', md);
  writeFileSync(saida + '.json', JSON.stringify({ arquivos, operadores: opsOrd.map(([k, o]) => ({ chave: k, grafias: [...o.grafias], linhas: o.linhas, de: o.de, ate: o.ate, arquivos: [...o.arquivos] })), idsFora: [...idsFora.entries()].map(([id, x]) => ({ id, ...x, arquivos: [...x.arquivos] })) }, null, 1));
  console.log(`Relatório: ${saida}.md`);
}
main().catch((e) => { console.error(e); process.exit(1); });
