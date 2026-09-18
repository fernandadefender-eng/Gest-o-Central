/**
 * Leitura das mensagens de SAC (canal do prestador com a operação), sem IA.
 *
 * Dois formatos importam:
 * 1) Reclamação do prestador ("estou com atendimento em atraso", "não recebi o pagamento").
 * 2) Comprovante postado pela supervisão ("[Foto] Alberto Fonseca/ Recife/ IDs 36259/36467"),
 *    que é a prova de pagamento e encerra a reclamação daquele prestador.
 */
import { SacTipo } from '@prisma/client';

const IDS = /\b3\d{4,5}\b/g;

/** Grupo de comprovantes/pagamentos da supervisão (não é grupo de cliente) */
export const ehGrupoFinanceiro = (nome?: string | null) =>
  /comprovante|pagamento|financeiro/i.test(nome ?? '');

export type Comprovante = { nome: string; regiao?: string; ids: string[] };

/**
 * "[Foto] Alberto Fonseca/ Recife/ IDs 36259/36467" — nome, região e IDs pagos.
 * Os IDs às vezes vêm na mensagem seguinte ("36254 / 36332 / ..."), por isso a lista pode vir vazia.
 */
export function lerComprovantePagamento(texto: string): Comprovante | null {
  const linha = texto.replace(/^\[(foto|imagem|documento)\]\s*/i, '').trim();
  const partes = linha.split('/').map((p) => p.trim());
  if (partes.length < 2) return null;
  const nome = partes[0];
  // Nome de pessoa: duas palavras começando com maiúscula, sem números
  if (!/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ']+(\s+[A-Za-zÀ-ÿ']+){1,3}$/.test(nome) || /\d/.test(nome)) return null;
  const regiao = partes[1] && !/^ids?\b/i.test(partes[1]) && !/^\d/.test(partes[1]) ? partes[1] : undefined;
  const ids = [...linha.matchAll(IDS)].map((m) => m[0]);
  return { nome, regiao, ids };
}

/** Continuação do comprovante: só os IDs ("36254 / 36332 / 36389") */
export function ehSoIds(texto: string): string[] | null {
  const t = texto.trim();
  if (!/^[\d\s/.,-]+$/.test(t)) return null;
  const ids = [...t.matchAll(IDS)].map((m) => m[0]);
  return ids.length ? ids : null;
}

export type Reclamacao = { tipo: SacTipo; assunto: string; idsCitados: string[] };

/**
 * Reclamação de prestador. Fica restrita a grupos de prestador/internos — no grupo
 * do cliente "atraso" costuma ser sobre o chamado, não sobre o prestador.
 */
export function lerReclamacaoSac(texto: string): Reclamacao | null {
  const t = texto.toLowerCase();
  const idsCitados = [...texto.matchAll(IDS)].map((m) => m[0]);
  const pagamento = /(pagamento|comprovante|recebi(?:mento)?|dep[óo]sito|pix|nota)/.test(t) && /(atras|pendent|n[ãa]o (?:caiu|recebi|foi pago)|aguardando|esquecer|sem retorno|at[ée] agora)/.test(t);
  if (pagamento) return { tipo: 'PAGAMENTO_ATRASO', assunto: 'Pagamento em atraso', idsCitados };
  if (/atendimento[s]? em atraso|chamado[s]? em atraso|atendimento parado|sem retorno do atendimento/.test(t)) {
    return { tipo: 'ATENDIMENTO_ATRASO', assunto: 'Atendimento em atraso', idsCitados };
  }
  if (/reclama[çc][ãa]o|insatisfeit|desrespeit|absurdo|descaso/.test(t)) return { tipo: 'RECLAMACAO', assunto: 'Reclamação do prestador', idsCitados };
  return null;
}
