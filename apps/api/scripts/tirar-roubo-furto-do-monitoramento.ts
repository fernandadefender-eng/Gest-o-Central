/**
 * Roubo e furto são ocorrência de atendimento Veicular — não tratativa de evento.
 * Este script tira da fila do Monitoramento os eventos desse tipo que já foram
 * gravados, guardando antes o histórico das tratativas no próprio atendimento
 * (nada se perde: o chamado continua com tudo).
 *
 *   npx ts-node -T scripts/tirar-roubo-furto-do-monitoramento.ts [--aplicar]
 *
 * Sem --aplicar só mostra o que faria.
 */
import { PrismaClient } from '@prisma/client';
import { tipoEventoVeicular } from '../src/monitoramento/prioridade';

const prisma = new PrismaClient();

async function main() {
  const aplicar = process.argv.includes('--aplicar');

  const eventos = await prisma.evento.findMany({
    include: { tratativas: { orderBy: { criadoEm: 'asc' } }, atendimento: true },
    orderBy: { recebidoEm: 'asc' },
  });
  // Fora da lista oficial do Monitoramento = não é evento de tratativa
  const foraDoMonitoramento = eventos.filter((e) => !tipoEventoVeicular(e.tipo));

  console.log(`eventos na fila: ${eventos.length} · fora da regra do Monitoramento: ${foraDoMonitoramento.length}\n`);
  for (const e of foraDoMonitoramento) {
    const alvo = e.atendimento;
    console.log(`${e.idInterno} · "${e.tipo}" · ${e.tratativas.length} tratativa(s) · atendimento: ${alvo ? (alvo.idPR7 ?? alvo.idInterno) : 'NENHUM'}`);
    if (!alvo) {
      console.log('   !! sem atendimento ligado — não removo, precisa virar chamado antes');
      continue;
    }
    // O que o operador escreveu vai para o histórico do chamado
    const historico = e.tratativas
      .filter((t) => t.tipo !== 'SISTEMA')
      .map((t) => `${t.criadoEm.toISOString().slice(0, 16).replace('T', ' ')} · ${t.usuario ?? 'sistema'}: ${t.texto}`);
    for (const h of historico) console.log(`   guarda: ${h}`);
    if (!aplicar) continue;

    const detalhes = (alvo.detalhes as Record<string, unknown> | null) ?? {};
    const antes = Array.isArray(detalhes.historicoMonitoramento) ? (detalhes.historicoMonitoramento as string[]) : [];
    const novo = [...antes, ...historico.filter((h) => !antes.includes(h))];
    await prisma.atendimento.update({
      where: { id: alvo.id },
      data: { detalhes: { ...detalhes, ...(novo.length ? { historicoMonitoramento: novo } : {}) } },
    });
    await prisma.eventoTratativa.deleteMany({ where: { eventoId: e.id } });
    await prisma.evento.delete({ where: { id: e.id } });
    console.log('   → removido da fila do Monitoramento (chamado mantido)');
  }

  const restam = await prisma.evento.groupBy({ by: ['tipo'], _count: true });
  console.log(`\nfila do Monitoramento agora: ${restam.map((r) => `${r.tipo} (${r._count})`).join(' · ') || 'vazia'}`);
  if (!aplicar) console.log('\n(simulação — rode com --aplicar para efetivar)');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
