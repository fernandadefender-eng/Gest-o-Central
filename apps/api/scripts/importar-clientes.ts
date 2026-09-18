/**
 * Importa as empresas clientes (contratantes) da planilha "Clientes.xlsx" do sistema atual
 * e liga os grupos de WhatsApp do tipo CLIENTE à empresa pelo nome do grupo.
 *
 * Pode rodar de novo: atualiza pelo CNPJ (ou razão social, se não houver CNPJ).
 * Uso: npx ts-node -T scripts/importar-clientes.ts "caminho/Clientes.xlsx"
 */
import * as ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { normalizar } from '../src/geo/normalizar';
import { empresaDoGrupo } from '../src/empresas/empresa-grupo';

const prisma = new PrismaClient();

const texto = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.text) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
    return '';
  }
  return String(v).trim();
};
// "—", "-" e vazio viram null
const valor = (v: unknown) => { const t = texto(v); return !t || /^[—–-]+$/.test(t) ? null : t; };

// Palavras que não identificam a empresa
const GENERICAS = new Set(['ltda', 'sa', 's/a', 'me', 'eireli', 'comercio', 'comercial', 'servicos', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'seguranca', 'monitoramento', 'eletronica', 'eletronico', 'sistemas', 'solucoes', 'tecnologia', 'gestao', 'vigilancia', 'patrimonial', 'brasil', 'grupo', 'associacao', 'protecao', 'veicular', 'rastreamento', 'integrando', 'inteligencia', 'investigacao', 'corporativa', 'refrigeracao', 'locacao', 'veiculos', 'bens', 'valores', 'clube', 'beneficios', 'alarme', 'incendios', 'eletronca']);

function apelidosDe(razao: string, fantasia: string | null) {
  const base = normalizar(`${fantasia ?? ''} ${razao}`).replace(/[^a-z0-9\s-]/g, ' ');
  const palavras = base.split(/\s+/).filter((p) => p.length >= 3 && !GENERICAS.has(p) && !/^\d+$/.test(p));
  // A primeira palavra marcante (ex: "orsegups", "segurpro") e nomes compostos conhecidos
  const set = new Set<string>(palavras.slice(0, 1));
  if (/guard center/.test(base)) set.add('guard center');
  if (/x-?global/.test(base)) set.add('xglobal').add('x-global');
  if (/\bg4s\b/.test(base)) set.add('g4s');
  return [...set];
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) throw new Error('Informe o caminho da planilha Clientes.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const ws = wb.worksheets[0];
  const cab = (ws.getRow(1).values as unknown[]).map((h) => normalizar(texto(h)));
  const col = (re: RegExp) => cab.findIndex((h, i) => i > 0 && re.test(h));
  const c = {
    razao: col(/razao social/), fantasia: col(/nome fantasia/), doc: col(/cpf\/cnpj|cnpj/), im: col(/insc\. municipal|municipal/),
    ie: col(/insc\. estadual|estadual/), email: col(/e-?mail/), fone: col(/telefone/), end: col(/^endereco/), bairro: col(/bairro/),
    cidade: col(/^cidade/), uf: col(/^uf$/), cep: col(/^cep/), ativo: col(/ativo/), situacao: col(/situacao/), os: col(/ordens de servico/), cadastro: col(/cadastrado em/),
  };
  if (c.razao < 0) throw new Error('Coluna "Razão Social / Nome" não encontrada');

  let criadas = 0, atualizadas = 0;
  const linhas: number[] = [];
  ws.eachRow((_r, n) => { if (n > 1) linhas.push(n); });
  for (const n of linhas) {
    const r = ws.getRow(n);
    const cel = (i: number) => (i > 0 ? r.getCell(i).value : null);
    const razao = valor(cel(c.razao));
    if (!razao) continue;
    const fantasia = valor(cel(c.fantasia));
    const cnpj = valor(cel(c.doc))?.replace(/\D/g, '') || null;
    const cadastroTxt = valor(cel(c.cadastro));
    const cadastro = cel(c.cadastro) instanceof Date ? (cel(c.cadastro) as Date) : cadastroTxt?.match(/(\d{2})\/(\d{2})\/(\d{4})/) ? new Date(Date.UTC(+RegExp.$3, +RegExp.$2 - 1, +RegExp.$1)) : null;
    const dados = {
      razaoSocial: razao, nomeFantasia: fantasia, cnpj,
      inscMunicipal: valor(cel(c.im)), inscEstadual: valor(cel(c.ie)), email: valor(cel(c.email)),
      telefone: valor(cel(c.fone))?.replace(/\D/g, '') || null, endereco: valor(cel(c.end)), bairro: valor(cel(c.bairro)),
      cidade: valor(cel(c.cidade)), uf: valor(cel(c.uf))?.toUpperCase() ?? null, cep: valor(cel(c.cep))?.replace(/\D/g, '') || null,
      ativo: !/^n/i.test(valor(cel(c.ativo)) ?? 'sim'), situacao: valor(cel(c.situacao)),
      qtdOrdensServico: Number(valor(cel(c.os)) ?? '') || 0, cadastradoEm: cadastro, apelidos: apelidosDe(razao, fantasia),
    };
    const existente = cnpj
      ? await prisma.empresa.findUnique({ where: { cnpj } })
      : await prisma.empresa.findFirst({ where: { razaoSocial: razao } });
    if (existente) { await prisma.empresa.update({ where: { id: existente.id }, data: dados }); atualizadas++; }
    else { await prisma.empresa.create({ data: dados }); criadas++; }
  }
  console.log(`Empresas: ${criadas} criadas, ${atualizadas} atualizadas`);

  // Liga grupos de cliente à empresa pelo nome do grupo
  const empresas = await prisma.empresa.findMany({ select: { id: true, razaoSocial: true, nomeFantasia: true, cidade: true, apelidos: true } });
  const grupos = await prisma.conversation.findMany({ where: { isGroup: true }, select: { id: true, groupName: true, tipoGrupo: true, empresaId: true } });
  for (const g of grupos) {
    const e = empresaDoGrupo(g.groupName, empresas);
    if (e && g.empresaId !== e.id && g.tipoGrupo !== 'PRESTADOR' && g.tipoGrupo !== 'INTERNO') {
      await prisma.conversation.update({ where: { id: g.id }, data: { empresaId: e.id } });
      await prisma.atendimento.updateMany({ where: { conversationId: g.id, empresaId: null }, data: { empresaId: e.id } });
      console.log(`Grupo "${g.groupName}" → ${e.nomeFantasia || e.razaoSocial}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
