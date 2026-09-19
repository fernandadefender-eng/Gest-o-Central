/** Roda a varredura de valores uma vez (aplica regras atuais, incl. TBG) e reporta. */
import { PrismaClient } from '@prisma/client';
import { preencherValores } from '../src/pagamentos/valores-automaticos';
const prisma = new PrismaClient();
async function main() {
  // Janela ampla para reavaliar tudo que veio do WhatsApp sem valor
  const r = await preencherValores(prisma as any, new Date(Date.now() - 400 * 864e5));
  console.log(`Valores: ${r.preenchidos} calculados · ${r.pendentes} sem regra/dado.`);
  // Quantos ficaram com o valor acordado da TBG?
  const tbg = await prisma.atendimento.count({ where: { detalhes: { path: ['valorCalculado', 'regra'], string_contains: 'TBG (valor acordado' } } });
  console.log(`Destes, ${tbg} com valor acordado da TBG.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
