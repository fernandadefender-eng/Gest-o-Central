/**
 * Troca o e-mail de login pelo nome do Help Desk nos atendimentos (planilha 2024 e
 * jul/2025). O valor original fica guardado em detalhes.operadorOriginal.
 *   npx ts-node -T scripts/unificar-help-desk.ts [--aplicar]
 */
import { PrismaClient } from '@prisma/client';
import { nomeDoHelpDesk } from '../src/equipe/nomes-help-desk';

const prisma = new PrismaClient();
async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const grupos = await prisma.atendimento.groupBy({ by: ['operadorPR7'], where: { operadorPR7: { contains: '@' } }, _count: true });
  const conhecidos = (await prisma.atendimento.groupBy({ by: ['operadorPR7'], where: { operadorPR7: { not: null } } }))
    .map((x) => x.operadorPR7!).filter((n) => !n.includes('@'));
  for (const g of grupos) {
    const nome = nomeDoHelpDesk(g.operadorPR7, conhecidos);
    if (!nome || nome === g.operadorPR7) { console.log(`mantido (não identifica a pessoa): ${g.operadorPR7} · ${g._count}`); continue; }
    console.log(`${g.operadorPR7} → ${nome} · ${g._count} atendimentos`);
    if (!aplicar) continue;
    const alvos = await prisma.atendimento.findMany({ where: { operadorPR7: g.operadorPR7 }, select: { id: true, detalhes: true } });
    for (const a of alvos) {
      await prisma.atendimento.update({ where: { id: a.id }, data: { operadorPR7: nome, detalhes: { ...((a.detalhes ?? {}) as Record<string, unknown>), operadorOriginal: g.operadorPR7 } } });
    }
  }
  if (!aplicar) console.log('\n(simulação — rode com --aplicar para efetivar)');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
