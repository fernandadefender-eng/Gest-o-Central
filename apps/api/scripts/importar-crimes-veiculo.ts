/**
 * Importa estatística oficial de crime contra veículo e monta a área de risco por
 * município — vale para qualquer estado.
 *
 *   npx ts-node -T scripts/importar-crimes-veiculo.ts <arquivo.csv> --fonte "ISP-RJ" [--uf RJ] [--meses 12]
 *
 * Reconhece o cabeçalho sozinho. Precisa de: município (munic/municipio/cidade),
 * e pelo menos uma coluna de roubo ou furto de veículo. UF vem da coluna (uf/estado)
 * ou do parâmetro --uf. Período usa ano/mês quando existirem.
 *
 * As coordenadas saem da tabela Cidade (a mesma que posiciona prestadores no mapa).
 * O grau de risco é comparação com a média do próprio conjunto — não é classificação
 * do sistema sobre facção.
 */
import { readFileSync } from 'fs';
import * as ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { chaveCidade } from '../src/geo/normalizar';

const prisma = new PrismaClient();

const arg = (nome: string, padrao?: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const num = (v?: string) => {
  const n = Number((v ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function separador(linha: string) {
  return [';', '\t', ','].sort((a, b) => linha.split(b).length - linha.split(a).length)[0];
}

type Bruto = { cidade: string; uf: string; periodo: string; roubo: number; furto: number; carga: number };

const textoCel = (c: unknown): string => {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') {
    const o = c as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    return '';
  }
  return String(c);
};

/**
 * Planilha estadual (ex.: SSP-RS): cabeçalho não fica na linha 1 e cada mês é uma aba.
 * Acha a linha que tem "Município" e lê as colunas de roubo/furto de veículo.
 */
async function lerPlanilha(arquivo: string, ufFixa: string): Promise<Bruto[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const saida: Bruto[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible') continue;
    let iCab = 0, cab: string[] = [];
    for (let n = 1; n <= Math.min(20, ws.rowCount); n++) {
      const v = (ws.getRow(n).values as unknown[]).map(textoCel);
      if (v.some((c) => /^munic[ií]pios?$/i.test(c.trim()))) { iCab = n; cab = v; break; }
    }
    if (!iCab) continue;
    const acha = (re: RegExp) => cab.findIndex((c, i) => i > 0 && re.test(c.replace(/\s+/g, ' ').trim()));
    const iMunic = acha(/^munic[ií]pios?$/i);
    const iRoubo = acha(/roubo de ve[ií]culo/i);
    const iFurto = acha(/furto de ve[ií]culo/i);
    const iCarga = acha(/roubo de carga/i);
    if (iMunic < 0 || (iRoubo < 0 && iFurto < 0)) continue;
    // Período: o nome da aba (JAN, FEV...) ou o título acima do cabeçalho
    const titulo = (ws.getRow(Math.max(1, iCab - 2)).values as unknown[]).map(textoCel).join(' ');
    const ano = titulo.match(/(20\d{2})/)?.[1] ?? ws.name.match(/(20\d{2})/)?.[1] ?? String(new Date().getFullYear());
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const mesNome = ws.name.trim().slice(0, 3).toLowerCase();
    const iMes = MESES.indexOf(mesNome);
    // Aba do ano inteiro entra como acumulado (não some com as abas mensais)
    if (iMes < 0) continue;
    const periodo = `${ano}-${String(iMes + 1).padStart(2, '0')}`;
    ws.eachRow((row, n) => {
      if (n <= iCab || row.hidden) return;
      const v = (row.values as unknown[]).map(textoCel);
      const cidade = (v[iMunic] ?? '').trim();
      if (!cidade || /total|munic[ií]pio/i.test(cidade)) return;
      const n0 = (i: number) => (i >= 0 ? Number(String(v[i] ?? '0').replace(/[^\d-]/g, '')) || 0 : 0);
      saida.push({ cidade, uf: ufFixa, periodo, roubo: n0(iRoubo), furto: n0(iFurto), carga: n0(iCarga) });
    });
    console.log(`  aba "${ws.name}" (${periodo}): ${saida.length} linhas acumuladas`);
  }
  return saida;
}

/** Grava as áreas de risco a partir das contagens por município. */
async function gravar(linhas: Bruto[], fonte: string, meses: number, referencia?: string, jaAgrupado?: { uf: string; cidade: string; roubo: number; furto: number; carga: number; porMes: Map<string, { roubo: number; furto: number }> }[]) {
  type Acum = { uf: string; cidade: string; roubo: number; furto: number; carga: number; porMes: Map<string, { roubo: number; furto: number }> };
  let porCidade: Map<string, Acum>;
  if (jaAgrupado) {
    porCidade = new Map(jaAgrupado.map((v) => [chaveCidade(v.cidade, v.uf), v]));
  } else {
    porCidade = new Map();
    const periodos = [...new Set(linhas.map((l) => l.periodo))].sort();
    const recentes = new Set(periodos.slice(-meses));
    for (const l of linhas) {
      if (!recentes.has(l.periodo)) continue;
      const chave = chaveCidade(l.cidade, l.uf);
      const atual = porCidade.get(chave) ?? { uf: l.uf, cidade: l.cidade, roubo: 0, furto: 0, carga: 0, porMes: new Map() };
      atual.roubo += l.roubo; atual.furto += l.furto; atual.carga += l.carga;
      const m = atual.porMes.get(l.periodo) ?? { roubo: 0, furto: 0 };
      m.roubo += l.roubo; m.furto += l.furto;
      atual.porMes.set(l.periodo, m);
      porCidade.set(chave, atual);
    }
    console.log(`${fonte}: municípios com dado ${porCidade.size} · período ${[...recentes][0]} a ${[...recentes].pop()}`);
  }

  const ultimoPeriodo = [...new Set(linhas.map((l) => l.periodo))].sort().pop() ?? '';
  const coordenadas = new Map((await prisma.cidade.findMany({ where: { lat: { not: null } }, select: { chave: true, lat: true, lng: true } })).map((c) => [c.chave, c]));
  const totais = [...porCidade.values()].map((v) => v.roubo + v.furto).filter((n) => n > 0);
  const media = totais.reduce((s, n) => s + n, 0) / (totais.length || 1);
  const vigenteEm = /^\d{4}-\d{2}$/.test(ultimoPeriodo) ? new Date(`${ultimoPeriodo}-01T12:00:00Z`) : new Date();

  let gravados = 0, semCoordenada = 0;
  for (const [chave, v] of porCidade) {
    const total = v.roubo + v.furto;
    if (!total) continue;
    const geo = coordenadas.get(chave);
    if (!geo) semCoordenada++;
    const situacao = total >= media * 3 ? 'DOMINIO' : total >= media ? 'INFLUENCIA' : 'DISPUTA';
    const nome = `${v.cidade} — ${v.roubo} roubos e ${v.furto} furtos de veículo`;
    const existente = await prisma.areaRisco.findFirst({ where: { fonte, cidade: v.cidade, uf: v.uf } });
    const dados = {
      faccao: 'INDEFINIDA', uf: v.uf, cidade: v.cidade, bairro: null, nome,
      latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
      raioMetros: geo ? Math.min(8000, 1500 + total * 4) : null,
      populacao: null, situacao, geojson: undefined as never,
      indicadores: {
        rouboVeiculo: v.roubo, furtoVeiculo: v.furto, rouboCarga: v.carga, meses,
        porMes: [...v.porMes.entries()].sort().map(([mes, n]) => ({ mes, roubo: n.roubo, furto: n.furto })),
      } as never,
      fonte, referencia: referencia ?? null, vigenteEm,
    };
    if (existente) await prisma.areaRisco.update({ where: { id: existente.id }, data: dados });
    else await prisma.areaRisco.create({ data: dados });
    gravados++;
  }
  console.log(`áreas gravadas: ${gravados} · sem coordenada (não aparecem no mapa): ${semCoordenada}`);
  const top = [...porCidade.values()].sort((a, b) => b.roubo + b.furto - (a.roubo + a.furto)).slice(0, 8);
  console.table(top.map((v) => ({ uf: v.uf, municipio: v.cidade, roubo: v.roubo, furto: v.furto })));
}

async function main() {
  const arquivo = process.argv[2];
  const fonte = arg('fonte');
  const ufFixa = arg('uf')?.toUpperCase();
  const meses = Number(arg('meses', '12'));
  if (!arquivo || !fonte) { console.error('uso: importar-crimes-veiculo.ts <csv> --fonte "<fonte>" [--uf UF] [--meses 12]'); process.exit(1); }

  if (/\.xlsx?$/i.test(arquivo)) {
    if (!ufFixa) { console.error('para planilha, informe --uf'); process.exit(1); }
    const linhasPlanilha = await lerPlanilha(arquivo, ufFixa);
    await gravar(linhasPlanilha, fonte, meses, arg('referencia'));
    return;
  }

  const bruto = readFileSync(arquivo, 'latin1');
  const linhas = bruto.split(/\r?\n/).filter((l) => l.trim());
  const sep = separador(linhas[0]);
  const cab = linhas[0].split(sep).map((c) => c.replace(/"/g, '').trim().toLowerCase());
  const col = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c === n || c.replace(/[^a-z_]/g, '') === n));
  const iMunic = col('munic', 'municipio', 'município', 'cidade', 'municipio_fato');
  const iUf = col('uf', 'estado', 'sigla_uf');
  const iAno = col('ano'), iMes = col('mes', 'mês');
  const iRoubo = col('roubo_veiculo', 'roubo_de_veiculo', 'roubo_veiculos');
  const iFurto = col('furto_veiculos', 'furto_veiculo', 'furto_de_veiculo');
  const iCarga = col('roubo_carga', 'roubo_de_carga');
  if (iMunic < 0 || (iRoubo < 0 && iFurto < 0)) {
    console.error(`cabeçalho não reconhecido. Colunas lidas: ${cab.slice(0, 20).join(' | ')}`);
    process.exit(1);
  }

  const registros = linhas.slice(1).map((l) => l.split(sep).map((c) => c.replace(/"/g, '').trim()));
  const periodo = (r: string[]) => (iAno >= 0 ? `${r[iAno]}-${String(num(r[iMes] ?? '1')).padStart(2, '0')}` : 'único');
  const periodos = [...new Set(registros.map(periodo))].sort();
  const recentes = new Set(periodos.slice(-meses));
  const ultimo = periodos[periodos.length - 1];

  type Acumulado = { uf: string; cidade: string; roubo: number; furto: number; carga: number; porMes: Map<string, { roubo: number; furto: number }> };
  const porCidade = new Map<string, Acumulado>();
  for (const r of registros) {
    const p = periodo(r);
    if (!recentes.has(p)) continue;
    const cidade = r[iMunic];
    const uf = (ufFixa ?? (iUf >= 0 ? r[iUf] : '') ?? '').toUpperCase().slice(0, 2);
    if (!cidade || uf.length !== 2) continue;
    const chave = `${chaveCidade(cidade, uf)}`;
    const atual = porCidade.get(chave) ?? { uf, cidade, roubo: 0, furto: 0, carga: 0, porMes: new Map() };
    const roubo = iRoubo >= 0 ? num(r[iRoubo]) : 0;
    const furto = iFurto >= 0 ? num(r[iFurto]) : 0;
    atual.roubo += roubo;
    atual.furto += furto;
    if (iCarga >= 0) atual.carga += num(r[iCarga]);
    const mes = atual.porMes.get(p) ?? { roubo: 0, furto: 0 };
    mes.roubo += roubo; mes.furto += furto;
    atual.porMes.set(p, mes);
    porCidade.set(chave, atual);
  }
  console.log(`${fonte}: ${registros.length} linhas · período ${[...recentes][0]} a ${ultimo} · municípios com dado: ${porCidade.size}`);

  await gravar([...porCidade.values()].flatMap((v) => [{ cidade: v.cidade, uf: v.uf, periodo: ultimo, roubo: v.roubo, furto: v.furto, carga: v.carga }]), fonte, meses, arg('referencia'), [...porCidade.values()]);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
