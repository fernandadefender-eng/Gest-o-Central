/**
 * Identificador de acionamento.
 *
 * Regra da operação: cada acionamento tem um ID. Quando o chamado nasce no sistema
 * antigo (ou é citado no WhatsApp com "ID: 36879"), vale o **ID PR7**. Quando chega
 * sem ID — histórico anterior ao sistema ou chamado aberto aqui — recebe um **ID
 * interno** nosso, que nunca colide com o do PR7:
 *
 *   PR7-H-000001   atendimento
 *   EV-2026-000001 evento de tratativa (central de monitoramento)
 */
import { PrismaService } from '../prisma/prisma.service';

const PREFIXO_ATENDIMENTO = 'PR7-H-';

/**
 * Próximo ID interno de atendimento. Sai da sequência do banco (pr7_id_interno_seq):
 * nunca repete — nem quando um chamado é removido (antes o "maior + 1" reaproveitou o
 * PR7-H-000099 de um chamado falso). Também é seguro com dois chamados nascendo juntos.
 */
export async function proximoIdInterno(prisma: Pick<PrismaService, '$queryRaw'>): Promise<string> {
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('pr7_id_interno_seq') AS n`;
  return `${PREFIXO_ATENDIMENTO}${String(n).padStart(6, '0')}`;
}

/** Próximo ID de evento do ano ("EV-2026-000123"). */
export async function proximoIdEvento(prisma: PrismaService, quando = new Date()): Promise<string> {
  const ano = quando.getUTCFullYear();
  const ultimo = await prisma.evento.findFirst({
    where: { idInterno: { startsWith: `EV-${ano}-` } },
    orderBy: { idInterno: 'desc' },
    select: { idInterno: true },
  });
  const n = ultimo ? Number(ultimo.idInterno!.split('-')[2]) + 1 : 1;
  return `EV-${ano}-${String(n).padStart(6, '0')}`;
}

/**
 * O ID do PR7 é sequencial e tem 4 a 6 dígitos (2151 … 36911). Número muito maior é
 * ocorrência do cliente (ORSEGUPS "33760663") e número muito curto é sobra de leitura:
 * nenhum dos dois pode entrar como ID do acionamento.
 */
export function idPR7Valido(valor?: string | null): boolean {
  const so = (valor ?? '').replace(/\D/g, '');
  return so.length >= 4 && so.length <= 6 && Number(so) > 0;
}

/** O que mostrar na tela: o ID PR7 quando existe, senão o nosso. */
export const identificador = (a: { idPR7?: string | null; idInterno?: string | null }) =>
  a.idPR7 ?? a.idInterno ?? null;
