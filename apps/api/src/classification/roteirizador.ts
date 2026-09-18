import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { proximoIdInterno } from '../atendimentos/identificador';
import { nomeDoHelpDesk } from '../equipe/nomes-help-desk';

/**
 * Roteirizador — acompanhamento velado de veículo (grupo "PR7 Acompanhamento Velado").
 *
 * O Help Desk vai narrando o trajeto: "Veículo no próximo cliente", "No cliente
 * descarregando", "Veículo saiu do cliente" + fotos. Cada DIA de acompanhamento vira um
 * atendimento (serviço "Roteirizador", linha Veicular) com a linha do tempo das paradas.
 * Lido direto das mensagens: sem IA, sem custo, e nada se perde.
 */
export const ehGrupoRoteirizador = (nome?: string | null) => /acompanhamento|velad|roteiriz|escolta/i.test(nome ?? '');

const FUSO = 'America/Sao_Paulo';
const diaBr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FUSO }); // AAAA-MM-DD
const horaBr = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });

export type Parada = { em: string; hora: string; tipo: string; texto: string; messageId: string };

/** O que a mensagem diz sobre o trajeto (null = conversa que não é parada). */
export function tipoDeParada(texto: string): string | null {
  const t = texto.toLowerCase();
  if (/sa(iu|indo) d[oa] cliente|deixou o cliente|liberad[oa] do cliente/.test(t)) return 'Saiu do cliente';
  if (/descarreg/.test(t)) return 'No cliente descarregando';
  if (/pr[oó]ximo cliente|a caminho|em deslocamento|em rota|seguindo/.test(t)) return 'A caminho do próximo cliente';
  if (/no cliente|chegou|chegada|na frente do cliente/.test(t)) return 'No cliente';
  if (/iniciad|in[ií]cio|come[cç]ou|saiu da base|partiu/.test(t)) return 'Início do acompanhamento';
  if (/finaliz|encerrad|retornou [àa] base|fim do acompanhamento/.test(t)) return 'Fim do acompanhamento';
  return null;
}

export async function registrarRoteirizador(
  prisma: PrismaService,
  logger: Logger,
  conversation: { id: string; clientId: string; groupName: string | null; empresaId?: string | null },
  mensagens: { id: string; sentAt: Date; content: string; senderName: string | null }[],
): Promise<number> {
  let alterados = 0;
  const porDia = new Map<string, typeof mensagens>();
  for (const m of mensagens) {
    const d = diaBr(m.sentAt);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d)!.push(m);
  }

  for (const [dia, msgs] of porDia) {
    const inicioDia = new Date(`${dia}T00:00:00-03:00`), fimDia = new Date(+inicioDia + 864e5);
    let a = await prisma.atendimento.findFirst({
      where: { conversationId: conversation.id, category: 'Roteirizador', solicitadoEm: { gte: inicioDia, lt: fimDia } },
    });
    const det = ((a?.detalhes ?? {}) as Record<string, unknown>);
    const paradas: Parada[] = Array.isArray(det.paradas) ? (det.paradas as Parada[]) : [];
    const vistos = new Set(paradas.map((p) => p.messageId));

    let operador: string | null = a?.operadorPR7 ?? null;
    for (const m of msgs) {
      // "*Laysla Larissa:* No cliente descarregando" → quem narrou + o texto
      const assinado = m.content.match(/^\*([^*:]{3,40}):\*\s*([\s\S]*)$/);
      const texto = (assinado?.[2] ?? m.content).replace(/\*/g, '').trim();
      if (assinado && !operador) operador = nomeDoHelpDesk(assinado[1]);
      const tipo = tipoDeParada(texto);
      if (!tipo || vistos.has(m.id)) continue;
      paradas.push({ em: m.sentAt.toISOString(), hora: horaBr(m.sentAt), tipo, texto: texto.slice(0, 200), messageId: m.id });
      vistos.add(m.id);
    }
    paradas.sort((x, y) => x.em.localeCompare(y.em));

    const primeira = msgs[0].sentAt;
    const chegada = paradas.find((p) => /^No cliente/.test(p.tipo));
    const fim = paradas.find((p) => p.tipo === 'Fim do acompanhamento');
    const resumo = paradas.length
      ? `Acompanhamento velado — ${paradas.filter((p) => /^No cliente/.test(p.tipo)).length} parada(s) em cliente.\n` +
        paradas.map((p) => `${p.hora} · ${p.tipo}${p.texto && p.texto.toLowerCase() !== p.tipo.toLowerCase() ? ` (${p.texto})` : ''}`).join('\n')
      : 'Acompanhamento velado — aguardando as paradas do trajeto.';

    const dados: Prisma.AtendimentoUncheckedUpdateInput = {
      summary: resumo.slice(0, 4000),
      operadorPR7: operador,
      ...(chegada && !a?.chegadaEm ? { chegadaEm: new Date(chegada.em) } : {}),
      ...(fim ? { status: 'CONCLUIDO', concluidoEm: new Date(fim.em), encerradoEm: new Date(fim.em), encerradoPor: 'fim do acompanhamento (roteirizador)' } : {}),
      detalhes: { ...det, paradas, grupo: conversation.groupName } as Prisma.InputJsonValue,
    };
    if (a) {
      a = await prisma.atendimento.update({ where: { id: a.id }, data: dados });
    } else {
      a = await prisma.atendimento.create({
        data: {
          ...(dados as Prisma.AtendimentoUncheckedCreateInput),
          clientId: conversation.clientId, conversationId: conversation.id, empresaId: conversation.empresaId ?? null,
          vertical: 'VEICULAR', category: 'Roteirizador', status: fim ? 'CONCLUIDO' : 'EM_ANDAMENTO',
          solicitadoEm: primeira, acionadoEm: primeira, idInterno: await proximoIdInterno(prisma),
        },
      });
      logger.log(`Roteirizador: acompanhamento de ${dia} aberto (${a.idInterno}) em "${conversation.groupName}"`);
    }
    // Grupo de um acompanhamento só: as fotos do dia são deste trajeto
    await prisma.midia.updateMany({ where: { conversationId: conversation.id, atendimentoId: null, recebidaEm: { gte: inicioDia, lt: fimDia } }, data: { atendimentoId: a.id } });
    alterados++;
  }
  return alterados;
}
