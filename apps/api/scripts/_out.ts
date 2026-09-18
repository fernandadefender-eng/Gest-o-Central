import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
(async () => {
  const altos = await p.atendimento.findMany({
    where: { valorPrestador: { gt: 1000 } },
    orderBy: { valorPrestador: 'desc' },
    take: 8,
    select: {
      idPR7: true, category: true, vertical: true, valorPrestador: true, valorTotalPrestador: true,
      formaPagamento: true, solicitadoEm: true, concluidoEm: true, agenteNome: true, summary: true,
      client: { select: { name: true } }, conta: { select: { estabelecimento: true, cidade: true, estado: true } },
    },
  });
  for (const a of altos) {
    console.log(`ID ${a.idPR7 ?? '-'} | ${a.client.name.slice(0, 28)} | ${a.category} | ${a.formaPagamento} | R$ ${a.valorPrestador} (total ${a.valorTotalPrestador ?? '-'}) | ${a.solicitadoEm?.toISOString().slice(0, 10) ?? 'sem data'} | ${a.conta?.cidade ?? ''}/${a.conta?.estado ?? ''} | ${(a.summary ?? '').slice(0, 50)}`);
  }
  await p.$disconnect();
})();
