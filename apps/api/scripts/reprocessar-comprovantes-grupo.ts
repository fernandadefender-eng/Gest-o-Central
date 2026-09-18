/**
 * Lê os comprovantes que chegaram pelo WhatsApp e ainda não viraram pagamento.
 * Usa as mesmas regras do grupo exportado: "Nome/ Cidade/ IDs 36575" (+ a mensagem
 * seguinte só com IDs) quita o atendimento pelo ID PR7.
 *
 *   npx ts-node -T scripts/reprocessar-comprovantes-grupo.ts [--desde 2026-09-16]
 */
import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ehGrupoFinanceiro, ehSoIds, lerComprovantePagamento } from '../src/sac/sac';

const prisma = new PrismaClient();

async function main() {
  const i = process.argv.indexOf('--desde');
  const desde = i > 0 && process.argv[i + 1] ? new Date(`${process.argv[i + 1]}T00:00:00Z`) : new Date(Date.now() - 7 * 864e5);

  const conversas = await prisma.conversation.findMany({ where: { isGroup: true }, select: { id: true, groupName: true } });
  const financeiras = conversas.filter((c) => ehGrupoFinanceiro(c.groupName));
  console.log(`grupos de pagamento: ${financeiras.map((f) => f.groupName).join(' · ') || 'nenhum'}`);

  let novos = 0, jaTinha = 0, quitados = 0, semAtendimento = 0;
  for (const grupo of financeiras) {
    const mensagens = await prisma.message.findMany({
      where: { conversationId: grupo.id, sentAt: { gte: desde } },
      orderBy: { sentAt: 'asc' },
      select: { id: true, sentAt: true, content: true, senderName: true },
    });
    type Comprovante = { nome: string; regiao?: string; ids: string[] };
    let ultimo: Comprovante | null = null;
    for (const m of mensagens) {
      const lido = lerComprovantePagamento(m.content) as Comprovante | null;
      // Mensagem só com IDs logo depois do comprovante: continuação do mesmo pagamento
      const soIds = ehSoIds(m.content);
      let comp: Comprovante | null = lido;
      if (!comp && ultimo && soIds) comp = { nome: ultimo.nome, regiao: ultimo.regiao, ids: soIds };
      if (!comp) continue;
      if (lido) ultimo = lido;

      const chave = createHash('sha256').update(`${m.sentAt.toISOString()}|${m.content}`).digest('hex').slice(0, 32);
      if (await prisma.pagamento.findUnique({ where: { chave }, select: { id: true } })) { jaTinha++; continue; }

      const pagamento = await prisma.pagamento.create({
        data: {
          prestadorNome: comp.nome.slice(0, 120), regiao: comp.regiao?.slice(0, 120) ?? null,
          grupo: grupo.groupName, autor: m.senderName?.slice(0, 80) ?? null,
          chave, recebidoEm: m.sentAt, pagoEm: m.sentAt,
          textoOriginal: m.content.slice(0, 2000), origem: 'WHATSAPP',
        },
      });
      novos++;

      for (const idPR7 of comp.ids) {
        const a = await prisma.atendimento.findFirst({ where: { idPR7 }, select: { id: true } });
        await prisma.pagamentoAtendimento.create({ data: { pagamentoId: pagamento.id, idPR7, atendimentoId: a?.id ?? null } });
        if (!a) { semAtendimento++; continue; }
        await prisma.atendimento.update({ where: { id: a.id }, data: { pagoEm: m.sentAt } });
        quitados++;
      }
      console.log(`  ${m.sentAt.toISOString().slice(0, 16).replace('T', ' ')} · ${comp.nome} · IDs ${comp.ids.join(', ') || '(sem ID)'}`);
    }
  }

  const aberto = await prisma.atendimento.aggregate({ where: { status: 'CONCLUIDO', pagoEm: null }, _count: true, _sum: { valorPrestador: true } });
  console.log(`\ncomprovantes novos: ${novos} · já registrados: ${jaTinha}`);
  console.log(`atendimentos quitados: ${quitados} · IDs sem atendimento no sistema: ${semAtendimento}`);
  console.log(`ainda a pagar: ${aberto._count} atendimentos · R$ ${Number(aberto._sum.valorPrestador ?? 0).toFixed(2)}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
