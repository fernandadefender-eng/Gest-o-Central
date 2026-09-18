/**
 * Junta as grafias da mesma pessoa do Help Desk (confirmadas pela operação ou únicas com
 * aquele primeiro nome) — regra em src/equipe/nomes-help-desk.ts. O valor original fica
 * em detalhes.operadorOriginal. Pode rodar de novo (não muda o que já está certo).
 *   npx ts-node -T scripts/unificar-nomes-help-desk.ts [--aplicar]
 */
import { PrismaClient } from '@prisma/client';
import { nomeDoHelpDesk } from '../src/equipe/nomes-help-desk';

const prisma = new PrismaClient();
async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const grupos = await prisma.atendimento.groupBy({ by: ['operadorPR7'], where: { operadorPR7: { not: null } }, _count: true });
  let total = 0;
  for (const g of grupos) {
    const nome = nomeDoHelpDesk(g.operadorPR7);
    if (!nome || nome === g.operadorPR7) continue;
    console.log(`"${g.operadorPR7}" → "${nome}" · ${g._count}`);
    total += g._count;
    if (!aplicar) continue;
    await prisma.$executeRaw`UPDATE "Atendimento" SET detalhes = coalesce(detalhes, '{}'::jsonb) || jsonb_build_object('operadorOriginal', coalesce(detalhes->>'operadorOriginal', "operadorPR7")), "operadorPR7" = ${nome} WHERE "operadorPR7" = ${g.operadorPR7}`;
  }
  console.log(`\n${total} atendimentos ${aplicar ? 'unificados' : 'a unificar (simulação — rode com --aplicar)'}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
