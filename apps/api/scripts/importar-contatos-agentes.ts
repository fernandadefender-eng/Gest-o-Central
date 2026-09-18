/**
 * Completa os contatos dos AGENTES (prestadores em campo) a partir da base
 * "Megazap Contatos.xlsx": Cidade | Estado | Nome do Agente (com telefone) | Equipe.
 *
 *   npx ts-node -T scripts/importar-contatos-agentes.ts "<planilha>" [--aplicar]
 *
 * Sem --aplicar só mostra o que faria. Só dados operacionais do prestador
 * (nome, telefone, cidade/UF, equipe) — nada de cliente.
 * Telefone já preenchido no organograma não é sobrescrito.
 */
import * as ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { ufValida } from '../src/mapa/estados';
import { normalizar, separarContato } from '../src/geo/normalizar';

const prisma = new PrismaClient();

const txt = (c: unknown): string => {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString();
  if (typeof c === 'object') {
    const o = c as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    return '';
  }
  return String(c).trim();
};

type Contato = { nome: string; telefone?: string; cidade?: string; uf?: string; equipe?: string };

async function main() {
  const arquivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!arquivo) throw new Error('Informe a planilha de contatos');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const contatos = new Map<string, Contato>();

  for (const ws of wb.worksheets) {
    const cab = (ws.getRow(1).values as unknown[]).map((v) => txt(v).trim());
    const col = (re: RegExp) => cab.findIndex((h, i) => i > 0 && re.test(h));
    const iNome = col(/nome do agente|pronta resposta/i), iEquipe = col(/^equipe$/i), iCidade = col(/^cidade$/i), iUf = col(/^estado$/i);
    if (iNome <= 0) continue;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const bruto = txt(row.getCell(iNome).value);
      if (!bruto) return;
      // "Carlos Silva (21 99533-7268)" ou "GELIELSON 47 8429-8762"
      const { nome, telefone } = separarContato(bruto.replace(/[()]/g, ' '));
      if (!nome || nome.length < 3) return;
      const uf = iUf > 0 ? txt(row.getCell(iUf).value).toUpperCase() : '';
      const chave = normalizar(nome);
      const anterior = contatos.get(chave);
      contatos.set(chave, {
        nome: anterior?.nome ?? nome,
        telefone: anterior?.telefone ?? telefone ?? undefined,
        cidade: anterior?.cidade ?? (iCidade > 0 ? txt(row.getCell(iCidade).value) || undefined : undefined),
        uf: anterior?.uf ?? (ufValida(uf) ? uf : undefined),
        equipe: anterior?.equipe ?? (iEquipe > 0 ? txt(row.getCell(iEquipe).value) || undefined : undefined),
      });
    });
  }

  const comTelefone = [...contatos.values()].filter((c) => c.telefone);
  console.log(`contatos lidos: ${contatos.size} · com telefone: ${comTelefone.length}`);

  const membros = await prisma.providerMembro.findMany({ select: { id: true, nome: true, nomeCompleto: true, telefone: true, providerId: true } });
  const porNome = new Map(membros.map((m) => [normalizar(m.nomeCompleto || m.nome), m]));
  const prestadores = await prisma.provider.findMany({ select: { id: true, name: true, phone: true } });
  const prestadorPorNome = new Map(prestadores.map((p) => [normalizar(p.name), p]));

  let preenchidos = 0, divergentes = 0, semCadastro = 0, prestadorPreenchido = 0;
  for (const c of comTelefone) {
    const chave = normalizar(c.nome);
    const m = porNome.get(chave);
    if (m) {
      if (!m.telefone) {
        preenchidos++;
        if (aplicar) await prisma.providerMembro.update({ where: { id: m.id }, data: { telefone: c.telefone, nomeCompleto: m.nomeCompleto ?? c.nome } });
      } else if (m.telefone !== c.telefone) divergentes++;
      continue;
    }
    const p = prestadorPorNome.get(chave);
    if (p && p.phone.startsWith('sem-telefone:')) {
      prestadorPreenchido++;
      if (aplicar) await prisma.provider.update({ where: { id: p.id }, data: { phone: c.telefone! } }).catch(() => undefined);
      continue;
    }
    if (!p) semCadastro++;
  }

  console.log(`telefones a preencher em agentes: ${preenchidos}`);
  console.log(`prestadores sem telefone que a base resolve: ${prestadorPreenchido}`);
  console.log(`telefone diferente do cadastrado (mantido): ${divergentes}`);
  console.log(`nomes da base sem cadastro no sistema: ${semCadastro}`);
  console.log(aplicar ? '\nAplicado.' : '\nSimulação — rode com --aplicar para gravar.');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
