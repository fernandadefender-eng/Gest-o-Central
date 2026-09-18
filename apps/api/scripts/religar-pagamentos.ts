/**
 * Religa os pagamentos aos atendimentos depois de uma reimportação da planilha
 * (a importação recria as linhas, então os vínculos por id mudam).
 *
 * Usa o ID PR7, que é estável, e volta a marcar Atendimento.pagoEm.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const itens = await prisma.pagamentoAtendimento.findMany({
    where: { atendimentoId: null },
    select: { id: true, idPR7: true, pagamento: { select: { pagoEm: true, valor: true } } },
  });
  console.log(`vínculos a refazer: ${itens.length}`);

  let ligados = 0, semAtendimento = 0;
  for (const i of itens) {
    const a = await prisma.atendimento.findFirst({ where: { idPR7: i.idPR7 }, select: { id: true, valorPrestador: true } });
    if (!a) { semAtendimento++; continue; }
    await prisma.pagamentoAtendimento.update({ where: { id: i.id }, data: { atendimentoId: a.id } });
    await prisma.atendimento.update({
      where: { id: a.id },
      data: {
        pagoEm: i.pagamento.pagoEm,
        ...(a.valorPrestador == null && i.pagamento.valor ? { valorPrestador: i.pagamento.valor } : {}),
      },
    });
    if (++ligados % 500 === 0) process.stdout.write(`  ${ligados}/${itens.length}\r`);
  }

  const pagos = await prisma.atendimento.count({ where: { pagoEm: { not: null } } });
  console.log(`\nreligados: ${ligados} · sem atendimento no sistema: ${semAtendimento}`);
  console.log(`atendimentos com pagamento: ${pagos}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
