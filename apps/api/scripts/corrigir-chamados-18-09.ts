/**
 * Correção de 7 chamados do WhatsApp com horário, Help Desk ou fotos errados (18/09/2026).
 * Cada valor abaixo foi conferido na mensagem original do grupo — a fonte está ao lado.
 *
 * Causas (corrigidas no código no mesmo dia):
 *  - horas citadas ("21:00") pegavam o dia em que a IA rodou, não o do pedido;
 *  - mensagem sem ID em grupo caía no único chamado aberto, mesmo de outro dia/cliente;
 *  - foto nova ia para o chamado aberto mais recente do grupo;
 *  - nome do grupo ("PR7 & ORSEGUPS"), "<UNKNOWN>" ou a operadora do cliente entravam como Help Desk.
 *
 *   npx ts-node -T scripts/corrigir-chamados-18-09.ts [--aplicar]
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { detalheCancelamento } from '../src/classification/classification.service';

const prisma = new PrismaClient();
const br = (s: string) => new Date(`${s}:00-03:00`); // horário de Brasília → UTC
const NOTA = 'Horários/atribuição corrigidos em 18/09/2026 conferindo as mensagens do grupo';

async function main() {
  const aplicar = process.argv.includes('--aplicar');

  const correcoes: { onde: Prisma.AtendimentoWhereInput; dados: Prisma.AtendimentoUpdateInput; fonte: string }[] = [
    {
      // Formulário da Ingridy 16/09 21:06: "Hr. solicitada: 20:24 · Hr. de chegada: 21:00 · Op. PR7: Ingridy"
      onde: { idPR7: '36897' },
      dados: {
        solicitadoEm: br('2026-09-16T20:24'), chegadaEm: br('2026-09-16T21:00'),
        // Término = envio do retorno com o relatório (21:06); o "liberado" era de outra ocorrência
        concluidoEm: br('2026-09-16T21:06'), encerradoEm: br('2026-09-16T21:06'), encerradoPor: 'retorno do Help Desk (correção)',
        operadorPR7: 'Ingridy',
      },
      fonte: 'formulário 16/09 21:06 (ID 36897)',
    },
    {
      // Formulário 16/09 23:06: "Hr. solicitada: 20:03 · Hr. de chegada: 22:55"; "Apoio a 25 min, posso deslocar?" / "Segue ambas" às 20:06
      onde: { idPR7: '36895' },
      dados: { solicitadoEm: br('2026-09-16T20:03'), acionadoEm: br('2026-09-16T20:06'), chegadaEm: br('2026-09-16T22:55') },
      fonte: 'formulário 16/09 23:06 (ID 36895) + "Segue ambas" 20:06',
    },
    {
      // Ronda diária: "data da realização: 15/09/2026 · Hora de chegada 19:00" (a data 04/08/2025 é do início do contrato)
      onde: { idPR7: '36881' },
      dados: { chegadaEm: br('2026-09-15T19:00') },
      fonte: 'retorno da Eliane 15/09 19:18 (ID 36881)',
    },
    {
      // Clamed 973 - FPP Dourados II: só existe o pedido "pode deslocar?" de 15/09 22:45.
      // As mensagens de 16/09 (Boticário L329, "liebrado tks") eram de outra ocorrência.
      onde: { idInterno: 'PR7-H-000033' },
      dados: {
        status: 'EM_ANDAMENTO', concluidoEm: null, encerradoEm: null, encerradoPor: null, operadorPR7: null, resultado: null,
        summary: 'Cliente (ORSEGUPS · Corporativo) pergunta "pode deslocar?" às 22:45 de 15/09 — CLAMED 973 - FPP Dourados II. Sem retorno registrado no grupo: conferir se houve atendimento.',
      },
      fonte: 'mensagem 15/09 22:45 "pode deslocar?"; encerramento anterior era do Boticário',
    },
    // "Operador solicitante: MARIA" é a operadora do CLIENTE; quem assinou pela PR7 foi a Eliane
    { onde: { idPR7: '36909' }, dados: { operadorPR7: 'Eliane Lopes' }, fonte: 'retorno "*Eliane Lopes:*" 17/09 20:02' },
    { onde: { idPR7: '36910' }, dados: { operadorPR7: 'Eliane Lopes' }, fonte: 'retorno "*Eliane Lopes:*" 17/09 19:37' },
    // Help Desk "<UNKNOWN>" devolvido pela IA
    { onde: { idInterno: 'PR7-H-000095' }, dados: { operadorPR7: null }, fonte: 'IA devolveu "<UNKNOWN>"' },
    // Recuperados por scripts/recuperar-formularios.ts antes do ajuste de ronda/assinatura:
    // ronda sem "Hr. solicitada" usa a chegada como pedido (20:10, não a postagem 21:03)
    { onde: { idPR7: '36891' }, dados: { solicitadoEm: br('2026-09-16T20:10') }, fonte: 'formulário 16/09 21:03: "Hr. de chegada: 20:10", sem hora solicitada' },
    // Formato da Eliane não tem "Op. PR7": vale a assinatura "*Eliane Lopes:*"
    { onde: { idPR7: '36912' }, dados: { operadorPR7: 'Eliane Lopes' }, fonte: 'retorno "*Eliane Lopes:*" 17/09 21:27' },
  ];

  for (const c of correcoes) {
    const a = await prisma.atendimento.findFirst({ where: c.onde, select: { id: true, idPR7: true, idInterno: true, detalhes: true } });
    if (!a) { console.log(`!! não encontrado: ${JSON.stringify(c.onde)}`); continue; }
    console.log(`${a.idPR7 ?? a.idInterno}: ${Object.keys(c.dados).join(', ')} — fonte: ${c.fonte}`);
    if (!aplicar) continue;
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    await prisma.atendimento.update({
      where: { id: a.id },
      data: { ...c.dados, detalhes: { ...det, correcao: NOTA, correcaoFonte: c.fonte, aguardandoRevisao: true } },
    });
  }

  // Cancelamentos da noite de 17/09 gravados como dia 16 (regra de horário pegava a 1ª
  // mensagem do lote). Motivo registrado com o contexto da conversa, sem inventar.
  const cancelados = [
    {
      idInterno: 'PR7-H-000096', pedido: br('2026-09-17T22:12'), cancelou: br('2026-09-17T22:18'),
      detalhe: detalheCancelamento({ minutos: 6, horaCancelamento: '22:18', prazo: '15 min', horaPrazo: '22:18', prazoEm: br('2026-09-17T22:18'), cancelou: br('2026-09-17T22:18') }),
      fonte: 'Monitoramento Boticário 22:12 "[Foto] Agente disponível?" · Eliane 22:18 "15 MIN PODE?" · cliente 22:18 "Cancelar por gentileza"',
    },
    {
      idInterno: 'PR7-H-000097', pedido: br('2026-09-17T23:16'), cancelou: br('2026-09-17T23:18'),
      detalhe: detalheCancelamento({ minutos: 2, horaCancelamento: '23:18' }),
      fonte: 'PA Curitiba 23:16 "[Foto] ronda" · Eliane 23:16 "VERIFICANDO" · cliente 23:18 "cancela"',
    },
  ];
  for (const c of cancelados) {
    const a = await prisma.atendimento.findFirst({ where: { idInterno: c.idInterno }, select: { id: true, conversationId: true, detalhes: true } });
    if (!a) continue;
    console.log(`${c.idInterno}: pedido/cancelamento em 17/09 e motivo com contexto — ${c.detalhe}`);
    if (!aplicar) continue;
    await prisma.atendimento.update({
      where: { id: a.id },
      data: {
        solicitadoEm: c.pedido, encerradoEm: c.cancelou, detalheNaoAtendimento: c.detalhe,
        detalhes: { ...((a.detalhes ?? {}) as Record<string, unknown>), correcao: NOTA, correcaoFonte: c.fonte },
      },
    });
    // A print do pedido (foto do cliente no minuto do pedido) é deste chamado
    const r = await prisma.midia.updateMany({ where: { conversationId: a.conversationId, atendimentoId: null, recebidaEm: { gte: c.pedido, lt: new Date(+c.pedido + 60000) } }, data: { atendimentoId: a.id } });
    console.log(`   print do pedido ligada: ${r.count}`);
  }

  // PR7-H-000099 não é atendimento: nasceu de "positivo central" / "OK" (23:37). Sem foto,
  // evento ou pagamento ligado; as mensagens continuam no registro da conversa.
  const falso = await prisma.atendimento.findFirst({ where: { idInterno: 'PR7-H-000099', ocorrencia: '<UNKNOWN>' }, select: { id: true } });
  if (falso) {
    console.log('PR7-H-000099: removido (confirmação "positivo central"/"OK", não é pedido)');
    if (aplicar) await prisma.atendimento.delete({ where: { id: falso.id } });
  }

  // Fotos do 36897: são dele o vídeo e as 3 fotos logo após o retorno (21:22–21:23).
  // As outras 16 chegaram depois, de outras ocorrências do grupo → ficam soltas para
  // a regra do nº da ocorrência / o Help Desk ligarem ao chamado certo.
  const campneus = await prisma.atendimento.findFirst({ where: { idPR7: '36897' }, select: { id: true } });
  if (campneus) {
    const fora = await prisma.midia.findMany({ where: { atendimentoId: campneus.id, recebidaEm: { gt: br('2026-09-16T21:30') } }, select: { id: true } });
    console.log(`36897: ${fora.length} mídias de outras ocorrências saem do chamado (ficam soltas no grupo)`);
    if (aplicar) await prisma.midia.updateMany({ where: { id: { in: fora.map((f) => f.id) } }, data: { atendimentoId: null } });
  }
  if (!aplicar) console.log('\n(simulação — rode com --aplicar para efetivar)');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
