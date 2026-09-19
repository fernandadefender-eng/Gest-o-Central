/**
 * Importa a aba "TBG-SEGURPRO" (apoios que atendem os pontos TBG) para a config
 * `tbg_apoios`. Guarda o VALOR ACORDADO por apoio — que é o valor do APOIO na TBG,
 * não os R$350 do cliente — e a regra da camiseta branca. O motor de valores usa
 * isso para aplicar o valor certo quando o apoio atende um ponto TBG.
 *
 * O ponto/cidade/UF/conta vêm mesclados na planilha (uma linha por ponto e as
 * demais em branco embaixo): fazemos carry-forward do último preenchido.
 *
 *   npx ts-node -T scripts/importar-tbg-apoios.ts "<arquivo EQUIPE.xlsx>" [--aplicar]
 */
import * as ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ABA = 'TBG-SEGURPRO';

const txt = (c: unknown): string => {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toLocaleDateString('pt-BR');
  if (typeof c === 'object') {
    const o = c as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    return '';
  }
  return String(c).trim();
};
const soDigitos = (s: string) => s.replace(/\D/g, '');
const valorNum = (s: string): number | null => {
  const m = s.replace(/[^\d,.]/g, '').replace('.', '').replace(',', '.');
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? n : null;
};

type Apoio = {
  nome: string; telefone: string; cpf: string;
  ponto: string; conta: string; cidade: string; uf: string; coordenada: string;
  camisa: string; atende: string; valorAcordado: number | null; obs: string;
};

async function main() {
  const arquivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!arquivo) throw new Error('Informe o arquivo EQUIPE .xlsx');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const ws = wb.getWorksheet(ABA);
  if (!ws) throw new Error(`Aba "${ABA}" não encontrada`);

  const apoios: Apoio[] = [];
  let ponto = '', conta = '', cidade = '', uf = '', coord = ''; // carry-forward

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const v = (i: number) => txt(row.getCell(i).value);
    conta = v(2) || conta;
    const unidade = v(3); if (unidade) { ponto = unidade; }
    cidade = v(5) || cidade;
    uf = v(6) || uf;
    coord = v(7) || coord;
    const nome = v(8);
    if (!nome) continue; // linha sem apoio
    apoios.push({
      nome,
      telefone: soDigitos(v(9)),
      cpf: soDigitos(v(10)),
      ponto, conta, cidade, uf, coordenada: coord,
      camisa: v(11),
      atende: v(12),
      valorAcordado: valorNum(v(16)),
      obs: [v(17)].filter(Boolean).join(' '),
    });
  }

  const comValor = apoios.filter((a) => a.valorAcordado != null);
  const semValor = apoios.filter((a) => a.valorAcordado == null);
  console.log(`${apoios.length} apoios TBG lidos — ${comValor.length} com valor acordado, ${semValor.length} sem valor.`);
  const faixa = comValor.map((a) => a.valorAcordado as number);
  if (faixa.length) console.log(`Valores acordados: mín R$ ${Math.min(...faixa)} · máx R$ ${Math.max(...faixa)}`);
  for (const a of apoios.slice(0, 12)) {
    console.log(`  ${a.ponto || '?'} — ${a.nome} · ${a.telefone || 's/ tel'} · camisa:${a.camisa || '—'} · ${a.valorAcordado != null ? 'R$ ' + a.valorAcordado : 'sem valor'} · atende:${(a.atende || '').slice(0, 20)}`);
  }
  if (apoios.length > 12) console.log(`  ... (+${apoios.length - 12})`);

  const payload = {
    atualizadoEm: new Date().toISOString(),
    origem: 'aba TBG-SEGURPRO (EQUIPE Validação Julho 2025)',
    regraCamiseta: 'TBG exige camiseta branca — conferir coluna camisa (Enviar/ok) antes de acionar.',
    clienteValorFixo: 350, // valor do CLIENTE por atendimento TBG (não é o do apoio)
    apoios,
  };

  if (!aplicar) { console.log('\nPRÉVIA (use --aplicar para gravar em ConfigSistema.tbg_apoios).'); return; }
  await prisma.configSistema.upsert({
    where: { chave: 'tbg_apoios' },
    update: { valor: JSON.stringify(payload) },
    create: { chave: 'tbg_apoios', valor: JSON.stringify(payload) },
  });
  console.log('\nAPLICADO: config tbg_apoios gravada.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
