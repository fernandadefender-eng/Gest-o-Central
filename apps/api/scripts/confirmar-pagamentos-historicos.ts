/**
 * A operação confirmou: **todos os pagamentos até 31/08/2026 já foram feitos** —
 * o que está em aberto é setembro de 2026.
 *
 * Os comprovantes do WhatsApp cobrem 5.903 atendimentos; o resto do histórico não
 * tem comprovante individual (grupo criado em 04/2023, comprovante sem ID citado...).
 * Aqui esses atendimentos ficam marcados como pagos, com a data do fechamento do
 * período (aproximação declarada) e um registro explicando a origem — nada é inventado
 * como comprovante: o Pagamento fica com origem CONFIRMACAO e sem valor.
 */
import { PrismaClient } from '@prisma/client';
import { fechamentoDoPeriodo } from '../src/pagamentos/fechamento';

const prisma = new PrismaClient();
const CORTE = new Date('2026-09-01T03:00:00Z'); // 01/09/2026 00h00 de Brasília

async function main() {
  const registro = await prisma.pagamento.upsert({
    where: { chave: 'confirmacao-historica-ate-2026-08-31' },
    create: {
      prestadorNome: 'Confirmação da operação (histórico)',
      origem: 'CONFIRMACAO',
      chave: 'confirmacao-historica-ate-2026-08-31',
      recebidoEm: new Date(),
      pagoEm: new Date('2026-08-31T23:59:00Z'),
      textoOriginal:
        'A operação confirmou em 16/09/2026 que todos os pagamentos até 31/08/2026 foram realizados; setembro de 2026 seguem em aberto. ' +
        'Estes atendimentos não têm comprovante individual no grupo do WhatsApp; a data registrada é a do fechamento do período.',
    },
    update: {},
  });

  const pendentes = await prisma.atendimento.findMany({
    where: { status: 'CONCLUIDO', pagoEm: null, OR: [{ concluidoEm: { lt: CORTE } }, { concluidoEm: null, solicitadoEm: { lt: CORTE } }] },
    select: { id: true, concluidoEm: true, solicitadoEm: true, createdAt: true },
  });
  console.log(`atendimentos a confirmar: ${pendentes.length}`);

  let feitos = 0;
  for (const a of pendentes) {
    const quando = a.concluidoEm ?? a.solicitadoEm ?? a.createdAt;
    await prisma.atendimento.update({ where: { id: a.id }, data: { pagoEm: fechamentoDoPeriodo('QUINZENAL', quando) } });
    if (++feitos % 1000 === 0) process.stdout.write(`  ${feitos}/${pendentes.length}\r`);
  }

  // Período em aberto (agosto/setembro de 2026): só continua "pago" o que tem comprovante
  const marcadosNoPeriodo = await prisma.atendimento.findMany({
    where: {
      pagoEm: { not: null },
      OR: [{ concluidoEm: { gte: CORTE } }, { concluidoEm: null, solicitadoEm: { gte: CORTE } }],
      pagamentos: { none: {} },
    },
    select: { id: true },
  });
  for (const a of marcadosNoPeriodo) await prisma.atendimento.update({ where: { id: a.id }, data: { pagoEm: null } });
  if (marcadosNoPeriodo.length) console.log(`marcados como pagos sem comprovante no período em aberto, revertidos: ${marcadosNoPeriodo.length}`);

  const aberto = await prisma.atendimento.aggregate({ where: { status: 'CONCLUIDO', pagoEm: null }, _count: true, _sum: { valorPrestador: true } });
  console.log(`\nconfirmados: ${feitos} (registro ${registro.id})`);
  console.log(`ainda em aberto: ${aberto._count} atendimentos · R$ ${Number(aberto._sum.valorPrestador ?? 0).toFixed(2)}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
