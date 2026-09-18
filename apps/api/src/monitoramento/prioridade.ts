import { EventoPrioridade } from '@prisma/client';

/**
 * Eventos que o Monitoramento trata: só telemetria de veículo vinda da central
 * de rastreamento. O patrimonial é acompanhado na tela de Atendimentos.
 *
 * Roubo e furto NÃO entram aqui: são ocorrência de atendimento Veicular
 * (recuperação de veículo), não tratativa de evento.
 */
export const EVENTOS_VEICULARES = [
  'Painel violado',
  'Desconexão de bateria',
  'Remoção de bateria',
  'Veículo bloqueado',
  'Cerca',
  'Perda de sinal',
] as const;
export type EventoVeicular = (typeof EVENTOS_VEICULARES)[number];

/** Encaixa o texto que veio (WhatsApp, central) num dos eventos oficiais. */
export function tipoEventoVeicular(texto?: string | null): EventoVeicular | null {
  const t = (texto ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/painel\s+violad|viola[çc][ãa]o\s+de\s+painel/.test(t)) return 'Painel violado';
  if (/remo[çc][ãa]o\s+(?:d[aeo]s?\s+)?bateria|bateria\s+removida|retirada\s+d[ae]\s+bateria/.test(t)) return 'Remoção de bateria';
  if (/desconex[ãa]o\s+(?:d[aeo]s?\s+)?bateria|bateria\s+desconectada|desconectou\s+a\s+bateria/.test(t)) return 'Desconexão de bateria';
  if (/bloqueio|bloquead[oa]|bloquear\s+o?\s*ve[íi]culo/.test(t)) return 'Veículo bloqueado';
  if (/cerca|geo\s?cerca|geofence/.test(t)) return 'Cerca';
  if (/perda de sinal|sem sinal|sem comunica|falha de comunica/.test(t)) return 'Perda de sinal';
  // Roubo/furto/recuperação: atendimento veicular, não evento de monitoramento
  return null;
}

/** Prioridade pelo tipo/descrição do evento: invasão e violação na frente de tudo. */
export function prioridadePorTexto(texto: string): EventoPrioridade {
  const t = texto.toLowerCase();
  if (/arromb|invas|assalt|roubo|furto|pânico|panico|coa[cç][aã]o|refém|refem|viola|remo[çc][ãa]o\s+(?:da?\s+)?bateria/.test(t)) return EventoPrioridade.CRITICA;
  if (/disparo|alarme|sirene|sinistro|recupera|bloque|desconex[ãa]o\s+(?:da?\s+)?bateria/.test(t)) return EventoPrioridade.ALTA;
  if (/cerca|geofence|perda de sinal|sem sinal|bateria|energia|falha|comunica/.test(t)) return EventoPrioridade.MEDIA;
  return EventoPrioridade.BAIXA;
}
