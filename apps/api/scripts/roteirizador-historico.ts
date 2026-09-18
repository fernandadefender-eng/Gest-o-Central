/**
 * Aplica o Roteirizador ao histórico dos grupos de acompanhamento velado (mensagens
 * que chegaram antes de a regra existir). Pode rodar de novo: não duplica paradas.
 *   npx ts-node -T scripts/roteirizador-historico.ts
 */
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ehGrupoRoteirizador, registrarRoteirizador } from '../src/classification/roteirizador';

const prisma = new PrismaClient();
async function main() {
  const grupos = (await prisma.conversation.findMany({ where: { isGroup: true }, select: { id: true, clientId: true, groupName: true, empresaId: true } })).filter((c) => ehGrupoRoteirizador(c.groupName));
  for (const g of grupos) {
    const msgs = await prisma.message.findMany({ where: { conversationId: g.id }, orderBy: { sentAt: 'asc' }, select: { id: true, sentAt: true, content: true, senderName: true } });
    const n = await registrarRoteirizador(prisma as never, new Logger('Roteirizador'), g, msgs);
    console.log(`"${g.groupName}": ${msgs.length} mensagens → ${n} dia(s) de acompanhamento`);
  }
  const lista = await prisma.atendimento.findMany({ where: { category: 'Roteirizador' }, select: { idInterno: true, status: true, operadorPR7: true, summary: true, _count: { select: { midias: true } } } });
  for (const a of lista) console.log(`\n${a.idInterno} · ${a.status} · Help Desk ${a.operadorPR7} · ${a._count.midias} mídias\n${a.summary}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
