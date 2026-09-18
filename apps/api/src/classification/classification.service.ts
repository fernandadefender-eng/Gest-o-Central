import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { AtendimentoStatus, MessageDirection, MotivoNaoAtendimento, Prisma, Vertical } from '@prisma/client';
import { CENTRO_UF } from '../mapa/estados';
import { prioridadePorTexto, tipoEventoVeicular } from '../monitoramento/prioridade';
import { FormularioRetorno, horaDoFormulario, lerDivulgacao, lerFormularioRetorno, responsavelNoRelato } from '../whatsapp/formulario-retorno';
import { costUsd } from './pricing';
import { CostsService } from '../costs/costs.service';
import { MidiasService } from '../midias/midias.module';
import { separarContato } from '../geo/normalizar';
import { empresaDoGrupo } from '../empresas/empresa-grupo';
import { identificador, idPR7Valido, proximoIdEvento, proximoIdInterno } from '../atendimentos/identificador';
import { lerEventoTelemetria, EventoTelemetria } from '../monitoramento/evento-telemetria';
import { SacService } from '../sac/sac.module';
import { ehGrupoRoteirizador, registrarRoteirizador } from './roteirizador';
import { nomeDoHelpDesk } from '../equipe/nomes-help-desk';
import { ehGrupoFinanceiro, ehSoIds, lerComprovantePagamento, lerReclamacaoSac } from '../sac/sac';
import { descreverPrint, ehImagemSuportada, lerPrintDoPedido, PrintDoPedido } from '../whatsapp/leitura-print';

const EXTRACTION_TOOL_NAME = 'registrar_atendimento';

/**
 * Conta cadastrada com o código informado, desde que o estabelecimento confira (o mesmo nº de
 * conta existe em empresas diferentes). Sem estabelecimento para conferir: não liga.
 */
export async function contaConfirmada(prisma: PrismaService, codigo?: string | null, estabelecimento?: string | null) {
  if (!codigo?.trim() || !estabelecimento?.trim()) return null;
  const conta = await prisma.conta.findUnique({ where: { codigo: codigo.trim() } });
  if (!conta) return null;
  const palavras = (s: string) => new Set(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((p) => p.length >= 4));
  const a = palavras(conta.estabelecimento), b = palavras(estabelecimento);
  return [...b].some((p) => a.has(p)) ? conta : null;
}

/** Nome oficial do serviço, mesmo que a IA devolva variação ("PATRIMONIAL: Ronda (pronta resposta)"). */
export function categoriaOficial(texto: string | undefined, placa?: string | null): string {
  const t = (texto ?? '').toLowerCase();
  if (/an[aá]lise|tecnologia rastre/.test(t)) return 'Análise de Tecnologia Rastreável';
  if (/recupera/.test(t)) return 'Recuperação de Veículo';
  if (/preserva/.test(t)) return 'Preservação';
  if (/manuten/.test(t)) return 'Manutenção Patrimonial';
  if (/ronda|pronta resposta|vistoria|alarme/.test(t)) return placa ? 'Análise de Tecnologia Rastreável' : 'Ronda';
  return placa ? 'Análise de Tecnologia Rastreável' : (texto?.trim().slice(0, 60) || 'Ronda');
}

/** HH:MM no horário de Brasília (as mensagens chegam com instante UTC). */
export function horaBrasilia(d: Date) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

/** "13:22" (Brasília) → instante real, no mesmo dia (Brasília) da mensagem de referência. */
export function instanteDaHora(hhmm: string | undefined, referencia: Date): Date | undefined {
  const m = hhmm?.match(/(\d{1,2})[:h](\d{2})/);
  if (!m || +m[1] > 23 || +m[2] > 59) return undefined;
  const [dia, mes, ano] = referencia.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').map(Number);
  // Brasília é UTC-3 (sem horário de verão desde 2019)
  return new Date(Date.UTC(ano, mes - 1, dia, +m[1] + 3, +m[2]));
}

/**
 * Horas citadas na conversa ("21:00") viram data+hora em SEQUÊNCIA a partir do pedido
 * (regra de 24 h da operação): cada marco é o primeiro instante com aquela hora que
 * vem depois do marco anterior — 23:59 → 00:01 é a virada do dia.
 *
 * Antes cada hora pegava o dia da última mensagem do lote: com a fila atrasada, a
 * chegada "21:00" de um pedido das 20:24 do dia 16 virou 21:00 do dia 17.
 *
 * - `solicitadoJa`: horário do pedido já gravado no chamado (âncora mais confiável).
 * - `primeiraMensagem`: sem pedido gravado, a hora do pedido é a mais próxima que
 *   não passe de 30 min depois da primeira mensagem do lote.
 */
/**
 * Motivo do cancelamento pelo cliente. Nunca inventa: usa as palavras do cliente quando
 * ele escreveu; quando não escreveu, registra o CONTEXTO que a conversa mostra — se
 * cancelou logo depois do prazo informado pela PR7 (sinal de que o prazo não serviu) ou
 * antes de qualquer prazo (PR7 ainda verificando agente).
 */
export function detalheCancelamento(i: {
  minutos: number; horaCancelamento?: string; motivo?: string; prazo?: string; horaPrazo?: string; cancelou?: Date; prazoEm?: Date;
}): string {
  const partes = [`Cliente cancelou ${i.minutos} min após a solicitação${i.horaCancelamento ? ` (${i.horaCancelamento})` : ''}.`];
  const motivo = i.motivo?.trim();
  if (motivo && !/^(cancela|cancelar|pode cancelar|cancelado)\.?$/i.test(motivo)) {
    partes.push(`Motivo dito pelo cliente: "${motivo.slice(0, 200)}".`);
  } else {
    partes.push('Cliente não informou o motivo.');
    const depoisDoPrazo = i.prazoEm && i.cancelou ? (+i.cancelou - +i.prazoEm) / 60000 : null;
    if (i.prazo && depoisDoPrazo !== null && depoisDoPrazo >= 0 && depoisDoPrazo <= 10) {
      partes.push(`Cancelou ${Math.round(depoisDoPrazo) === 0 ? 'no mesmo minuto em que' : `${Math.round(depoisDoPrazo)} min depois que`} a PR7 informou o prazo (${i.prazo}${i.horaPrazo ? ` às ${i.horaPrazo}` : ''}) — provável recusa do prazo.`);
    } else if (!i.prazo) {
      partes.push('Cancelou antes de a PR7 informar prazo (ainda verificando agente).');
    }
  }
  return partes.join(' ');
}

/**
 * Chamado aberto que pode receber mensagens sem ID/ocorrência. Em conversa 1-a-1 é o
 * mais recente; em grupo, só se for o ÚNICO aberto, do mesmo estabelecimento (quando a
 * mensagem cita um) e com pedido de até 12 h antes.
 */
export function abertoCompativel<T extends { solicitadoEm: Date | null; createdAt: Date; detalhes: unknown }>(
  abertos: T[], estabelecimento: string | undefined, primeiraMensagem: Date, grupo: boolean,
): T | undefined {
  if (!grupo) return abertos[0];
  if (abertos.length !== 1) return undefined;
  const a = abertos[0];
  if (+primeiraMensagem - +(a.solicitadoEm ?? a.createdAt) > 12 * 3600e3) return undefined;
  const estabA = String(((a.detalhes ?? {}) as Record<string, unknown>).estabelecimento ?? '');
  if (estabelecimento?.trim() && estabA.trim()) {
    const pal = (t: string) => new Set(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
    const x = pal(estabelecimento), y = pal(estabA);
    if (x.size && y.size && ![...x].some((w) => y.has(w))) return undefined;
  }
  return a;
}

/**
 * Help Desk é uma pessoa. A IA às vezes devolve o nome do grupo ("PR7 & ORSEGUPS")
 * ou da empresa nesse campo — isso não pode entrar como quem atendeu.
 */
export function operadorValido(nome: string | undefined | null, grupo?: string | null): boolean {
  const n = (nome ?? '').trim();
  if (n.length < 3 || !/[a-zà-ú]{3}/i.test(n)) return false;
  if (/unknown|desconhecid|n[aã]o (informad|identificad|sei)|^n\/?a$|^-+$/i.test(n)) return false;
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (grupo && norm(n) === norm(grupo)) return false;
  if (/&|pr7|grupo|ltda|s\.?a\.?$|monitoramento|seguran[cç]a|central/i.test(n)) return false;
  return true;
}

export function encaixarHoras(
  horas: { solicitacao?: string; outras: (string | undefined)[] },
  solicitadoJa: Date | null | undefined,
  primeiraMensagem: Date,
  agora = new Date(),
  mensagens: { sentAt: Date; content: string }[] = [],
): (hhmm?: string) => Date | undefined {
  const DIA = 864e5;
  const noDia = (hhmm: string, ref: Date) => instanteDaHora(hhmm, ref);
  const resolvidas = new Map<string, Date>();
  const chave = (h?: string) => h?.match(/(\d{1,2})[:h](\d{2})/)?.slice(1, 3).map((x) => x.padStart(2, '0')).join(':');

  // 1) Pedido
  let base: Date;
  const kSol = chave(horas.solicitacao);
  if (solicitadoJa) {
    base = solicitadoJa;
    if (kSol) {
      // Mesma hora citada de novo: o instante mais próximo do pedido já gravado
      const c = noDia(kSol, solicitadoJa)!;
      const opcoes = [c, new Date(+c - DIA), new Date(+c + DIA)].sort((a, b) => Math.abs(+a - +solicitadoJa) - Math.abs(+b - +solicitadoJa));
      resolvidas.set(kSol, opcoes[0]);
    }
  } else if (kSol) {
    // A hora do pedido vem de uma mensagem do lote: a que foi ENVIADA naquele horário
    // (a IA lê o horário do transcript) ou a que CITA a hora ("Hr. solicitada: 20:24").
    // O lote pode cobrir horas e virar a meia-noite, então não serve a primeira mensagem.
    const hm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const enviada = mensagens.find((m) => hm(m.sentAt) === kSol);
    const citada = mensagens.find((m) => m.content.includes(kSol) || m.content.includes(kSol.replace(':', 'h')));
    const ancora = enviada?.sentAt ?? citada?.sentAt ?? mensagens[mensagens.length - 1]?.sentAt ?? primeiraMensagem;
    let c = noDia(kSol, ancora)!;
    // O pedido é no momento da mensagem ou antes dela (nunca depois)
    if (+c > +ancora + 5 * 60000) c = new Date(+c - DIA);
    resolvidas.set(kSol, c);
    base = c;
  } else {
    base = primeiraMensagem;
  }

  // 2) Demais marcos (autorização, liberação, chegada, término...): cada um é o primeiro
  //    instante com aquela hora a partir do PEDIDO — não do marco anterior, para que uma
  //    hora fora de ordem na conversa (acionou 21:16, chegou 21:00) não empurre as outras
  //    para o dia seguinte. Nenhum marco passa de 24 h depois do pedido.
  const pedido = resolvidas.get(kSol ?? '') ?? base;
  for (const h of horas.outras) {
    const k = chave(h);
    if (!k || resolvidas.has(k)) continue;
    let c = noDia(k, pedido)!;
    if (+c < +pedido - 60000) c = new Date(+c + DIA);
    // Mais de 20 h depois do pedido é quase sempre hora digitada fora de ordem (antes do
    // pedido): fica no mesmo dia e a auditoria aponta a inversão, em vez de inventar um dia
    if (+c - +pedido > 20 * 3600e3) c = new Date(+c - DIA);
    // Nunca no futuro: se passou de agora, era do dia anterior
    if (+c > +agora + 5 * 60000) c = new Date(+c - DIA);
    resolvidas.set(k, c);
  }
  return (hhmm?: string) => {
    const k = chave(hhmm);
    return k ? resolvidas.get(k) : undefined;
  };
}

/**
 * Resumo no formato da central:
 * "Cliente solicita às 13:22. Laysla pede autorização (apoio em 20 min) às 13:32. Cliente libera às 13:32.
 *  Técnico de vistoria Adriano desloca, chega ao local às 13:57, realiza vistoria e laudo fotográfico do local.
 *  Relata: ... Laysla analisa as informações junto à equipe técnica de vistoria e retorna ao cliente."
 * Só monta quando a conversa trouxe a sequência (solicitação + chegada ou relato).
 */
export function montarResumoOperacional(i: {
  estabelecimento?: string; operador_pr7?: string; tecnico?: string; hora_solicitacao?: string; hora_pedido_autorizacao?: string;
  hora_liberacao?: string; hora_chegada?: string; prazo_informado?: string; relato?: string; categoria?: string;
  hora_fotos?: string; hora_encerramento?: string; hora_cancelamento?: string;
}): string | null {
  // Pedido cancelado pelo cliente antes do atendimento
  if (i.hora_solicitacao && i.hora_cancelamento && !i.hora_chegada) {
    const op = i.operador_pr7?.split(' ')[0] || 'Help Desk';
    const min = minutosEntreHoras(i.hora_solicitacao, i.hora_cancelamento);
    const p = [`Cliente solicita ${(i.categoria || 'atendimento').toLowerCase()}${i.estabelecimento ? ` para ${i.estabelecimento}` : ''} às ${i.hora_solicitacao}.`];
    if (i.hora_pedido_autorizacao) p.push(`${op} pede autorização${i.prazo_informado ? ` (apoio em ${i.prazo_informado})` : ''} às ${i.hora_pedido_autorizacao}.`);
    p.push(`Cliente cancela às ${i.hora_cancelamento}${min !== null ? ` (${min} min após a solicitação)` : ''}.`);
    return p.join('\n');
  }
  if (!i.hora_solicitacao || !(i.hora_chegada || i.relato)) return null;
  const op = i.operador_pr7?.split(' ')[0] || 'Help Desk';
  const partes = [`Cliente solicita ${(i.categoria || 'atendimento').toLowerCase()}${i.estabelecimento ? ` para ${i.estabelecimento}` : ''} às ${i.hora_solicitacao}.`];
  if (i.hora_pedido_autorizacao) partes.push(`${op} pede autorização${i.prazo_informado ? ` (apoio em ${i.prazo_informado})` : ''} às ${i.hora_pedido_autorizacao}.`);
  if (i.hora_liberacao) partes.push(`Cliente libera às ${i.hora_liberacao}.`);
  partes.push(`Técnico de vistoria${i.tecnico ? ` ${i.tecnico}` : ''} desloca${i.hora_chegada ? `, chega ao local às ${i.hora_chegada}` : ''}, realiza vistoria e laudo fotográfico do local.`);
  if (i.relato) partes.push(`Relata: ${i.relato.trim().replace(/\.?$/, '.')}`);
  partes.push(`${op} analisa as informações junto à equipe técnica de vistoria e retorna ao cliente.`);
  if (i.hora_fotos) partes.push(`Envia laudo fotográfico com localização às ${i.hora_fotos}.`);
  if (i.hora_encerramento) partes.push(`Estando tudo ok, cliente libera o técnico de vistoria às ${i.hora_encerramento}. Atendimento encerrado.`);
  return partes.join('\n');
}

/** Minutos entre dois HH:MM do mesmo dia (cancelamento após a solicitação). */
export function minutosEntreHoras(inicio?: string, fim?: string): number | null {
  const a = inicio?.match(/(\d{1,2})[:h](\d{2})/), b = fim?.match(/(\d{1,2})[:h](\d{2})/);
  if (!a || !b) return null;
  const d = +b[1] * 60 + +b[2] - (+a[1] * 60 + +a[2]);
  return d >= 0 ? d : d + 1440;
}

/**
 * Tipo do grupo pelo nome, enquanto a central não define na tela:
 * "PR7 & CLIENTE" = grupo do cliente; nomes de região/pronta resposta = prestadores.
 */
export function tipoGrupoPeloNome(nome?: string | null): 'CLIENTE' | 'PRESTADOR' | 'INTERNO' | null {
  const n = (nome ?? '').toLowerCase();
  if (!n) return null;
  if (/suporte|supervis|faturamento|interno|diretoria/.test(n)) return 'INTERNO';
  if (n.includes('&')) return 'CLIENTE';
  if (/regi[oõ]|pronta resposta|prestador|apoio|agentes|equipe|\bx\b|espirito santo|espírito santo/.test(n)) return 'PRESTADOR';
  return null;
}

// Descrições propositalmente curtas: elas são reenviadas em toda classificação,
// então cada palavra aqui é custo fixo multiplicado por milhares de atendimentos.
const EXTRACTION_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description:
    'Registra os atendimentos do PR7 (alarmes e rastreamento veicular) presentes nas mensagens. Um mesmo grupo trata chamados diferentes — devolva um item separado por ocorrência/local distinto, nunca os junte. Conversa sem chamado (teste, saudação, recado, figurinha) = lista vazia.',
  input_schema: {
    type: 'object' as const,
    properties: {
      atendimentos: {
        type: 'array',
        description: 'Um item por chamado distinto.',
        items: {
          type: 'object' as const,
          properties: {
            ocorrencia: {
              type: 'string',
              description: 'Nº da conta do cliente/ocorrência. Vazio se não houver — não invente.',
            },
            id_pr7: { type: 'string', description: 'ID do acionamento gerado pelo PR7 (ex: "Id: 36848" → 36848). Vazio se não houver.' },
            categoria: {
              type: 'string',
              description:
                'Exatamente um: Ronda | Preservação | Manutenção Patrimonial | Recuperação de Veículo | Análise de Tecnologia Rastreável. (Ronda = pronta resposta a alarme/vistoria em imóvel; os dois últimos são de veículo.)',
            },
            // Para a fila do Monitoramento
            evento: { type: 'string', description: 'Tipo do evento em até 4 palavras (ex: Disparo de alarme, Violação de painel, Perda de sinal).' },
            vertical: { type: 'string', enum: ['PATRIMONIAL', 'VEICULAR'] },
            // Local: é o que permite indicar na hora quem atende na região
            cidade: { type: 'string', description: 'Cidade do chamado, se citada.' },
            uf: { type: 'string', description: 'UF (2 letras), se citada ou óbvia pela cidade.' },
            placa: { type: 'string', description: 'Placa do veículo, se houver.' },
            resumo: { type: 'string', description: 'Resumo deste chamado, até 3 frases.' },
            // Sequência operacional (horários HH:MM das mensagens; vazio se não aconteceu)
            estabelecimento: { type: 'string', description: 'Loja/estabelecimento atendido.' },
            operador_pr7: { type: 'string', description: 'Help Desk da PR7 que conduziu: quem assina as mensagens do lado PR7 ("*Eliane Lopes:*", "Op. PR7: Ingridy") ou pede autorização. NUNCA o "Operador solicitante"/"Op. solicitante" (é do cliente) nem o nome do grupo. Vazio se não souber.' },
            tecnico: { type: 'string', description: 'Técnico/agente que foi ao local.' },
            hora_solicitacao: { type: 'string', description: 'HH:MM em que o cliente solicitou.' },
            hora_pedido_autorizacao: { type: 'string', description: 'HH:MM em que o operador PR7 pediu autorização para deslocar (ex: "apoio a 20min, pode seguir?").' },
            hora_liberacao: { type: 'string', description: 'HH:MM em que o cliente AUTORIZOU o deslocamento, ANTES da vistoria (ex: "pode ir"). Não é o "liberado" final.' },
            hora_chegada: { type: 'string', description: 'HH:MM em que o técnico chegou ao local.' },
            hora_termino: { type: 'string', description: 'HH:MM do término da vistoria.' },
            prazo_informado: { type: 'string', description: 'Prazo dado ao cliente, ex: "20 min".' },
            relato: { type: 'string', description: 'O que o técnico relatou da vistoria.' },
            hora_fotos: { type: 'string', description: 'HH:MM em que o PR7 enviou fotos/laudo com localização.' },
            hora_cancelamento: { type: 'string', description: 'HH:MM em que o CLIENTE cancelou o pedido (ex: "cancela", "pode cancelar"). Vazio se não cancelou.' },
            motivo_cancelamento: { type: 'string', description: 'Motivo do cancelamento COM AS PALAVRAS DO CLIENTE, só se ele escreveu (ex: "agente próprio chegou", "prazo muito longo", "alarme falso"). Vazio se o cliente só disse "cancela" — nunca invente.' },
            hora_encerramento: { type: 'string', description: 'HH:MM em que o cliente liberou o técnico DEPOIS do retorno/relato (ex: "liberado", "tks, liberado"). Vazio se ainda não liberou.' },
            responsavel_local: { type: 'string', description: 'Nome do responsável no local (ex: citado no relato).' },
            responsavel_telefone: { type: 'string', description: 'Telefone do responsável no local, com DDD, se informado.' },
            status: {
              type: 'string',
              enum: ['NOVO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO', 'NAO_ATENDIDO'],
            },
            // Só quando CANCELADO/NAO_ATENDIDO
            motivo_nao_atendimento: {
              type: 'string',
              enum: ['CANCELADO_CLIENTE', 'NEGATIVA_PRESTADOR', 'DEMORA_ATENDIMENTO', 'SEM_PRESTADOR_REGIAO', 'FALSO_ALARME', 'DUPLICADO', 'OUTRO'],
            },
            resultado: { type: 'string', description: 'Desfecho deste chamado, se houver.' },
          },
          required: ['categoria', 'resumo', 'status'],
        },
      },
    },
    required: ['atendimentos'],
  },
};

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: CostsService,
    private readonly midias: MidiasService,
    private readonly sac: SacService,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
  }

  async classifyConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { atendimentos: { orderBy: { createdAt: 'desc' } } },
    });

    if (!conversation) {
      this.logger.warn(`Conversa ${conversationId} não encontrada`);
      return;
    }

    // Teto de gasto mensal: protege contra surpresa na fatura. Ao estourar, o
    // sistema para de chamar a IA (as mensagens continuam sendo gravadas e
    // podem ser classificadas depois, ao aumentar o limite).
    const budgetUsd = Number(process.env.MONTHLY_BUDGET_USD ?? '0');
    if (budgetUsd > 0) {
      const spent = await this.costs.currentMonthUsd();
      if (spent >= budgetUsd) {
        this.logger.warn(
          `Teto mensal de US$ ${budgetUsd} atingido (US$ ${spent.toFixed(4)} gastos). ` +
            `Classificação da conversa ${conversationId} adiada.`,
        );
        return;
      }
    }

    // Contexto = o atendimento ainda aberto neste grupo. Quando as mensagens
    // novas trouxerem outra ocorrência, um novo atendimento é criado em vez de
    // sobrescrever este.
    const abertos = conversation.atendimentos.filter(
      (a) => a.status !== 'CONCLUIDO' && a.status !== 'CANCELADO',
    );
    const incremental = conversation.atendimentos.length > 0 && Boolean(conversation.lastClassifiedAt);

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(incremental ? { sentAt: { gt: conversation.lastClassifiedAt! } } : {}),
      },
      orderBy: { sentAt: 'asc' },
    });

    if (messages.length === 0) {
      this.logger.debug(`Nenhuma mensagem nova na conversa ${conversationId}`);
      return;
    }

    // Em grupo há vários participantes (cliente, operador PR7, agente de campo),
    // então o nome de quem falou importa para a IA entender o andamento. O horário
    // (Brasília) de cada mensagem é o que permite montar a sequência do atendimento.
    // Print do pedido: o número da ocorrência, a conta e o endereço só existem dentro da
    // imagem — sem ler, duas solicitações no mesmo horário viram um chamado só.
    const printPorMensagem = await this.lerPrintsDoPedido(messages, conversationId);

    const linhaTranscript = (m: (typeof messages)[number]) => {
      const autor = conversation.isGroup
        ? m.senderName || m.senderPhone || 'Participante'
        : m.direction === MessageDirection.ENTRANTE
          ? 'Cliente'
          : 'Atendente';
      const print = printPorMensagem.get(m.id);
      return `[${horaBrasilia(m.sentAt)}] ${autor}: ${m.content}${print ? ' ' + print : ''}`;
    };
    const transcript = messages.map(linhaTranscript).join('\n');

    const tipoGrupo = conversation.isGroup ? conversation.tipoGrupo ?? tipoGrupoPeloNome(conversation.groupName) : null;
    if (conversation.isGroup && !conversation.tipoGrupo && tipoGrupo) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { tipoGrupo } });
    }
    // Formulário de retorno (ID/Conta/Relato...) é lido direto, sem IA — aparece tanto no
    // grupo do prestador quanto no do cliente ("Retorno Deslocamento").
    let mensagensParaIA = messages;
    // "DIVULGAÇÃO FURTO/ROUBO": alerta veicular, não é chamado — registra e tira da IA (qualquer tipo de grupo)
    const divulgacoes = new Set<string>();
    for (const m of messages) {
      const d = lerDivulgacao(m.content);
      if (!d) continue;
      divulgacoes.add(m.id);
      await this.prisma.alertaVeicular.upsert({
        where: { messageId: m.id },
        create: {
          tipo: d.tipo, placa: d.placa, chassi: d.chassi, descricao: d.descricao, cor: d.cor, anoModelo: d.anoModelo,
          localOcorrencia: d.localOcorrencia, latitude: d.latitude, longitude: d.longitude, dataHoraTexto: d.dataHora,
          divulgadoEm: m.sentAt, grupo: conversation.groupName, remetente: m.senderName, empresaId: conversation.empresaId,
          messageId: m.id, textoOriginal: m.content.slice(0, 4000),
        },
        update: {},
      });
      this.logger.log(`Alerta veicular divulgado: ${d.tipo} placa ${d.placa} em "${conversation.groupName}"`);
    }
    if (divulgacoes.size) {
      messages.splice(0, messages.length, ...messages.filter((m) => !divulgacoes.has(m.id)));
      if (!messages.length) {
        await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: new Date() } });
        return;
      }
    }

    // Evento da central de rastreamento ("Descrição do Evento / Painel Violado / ...") —
    // lido sem IA e mandado direto para a fila do Monitoramento (só veicular).
    const eventosLidos = new Set<string>();
    for (const m of messages) {
      const ev = lerEventoTelemetria(m.content);
      if (!ev) continue;
      // Só sai da fila da IA se virou mesmo evento de monitoramento. Roubo/furto no
      // formato da central continua na lista para ser classificado como atendimento.
      if (await this.registrarEventoTelemetria(ev, m, conversation.groupName)) eventosLidos.add(m.id);
    }
    if (eventosLidos.size) {
      messages.splice(0, messages.length, ...messages.filter((m) => !eventosLidos.has(m.id)));
      if (!messages.length) {
        await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: new Date() } });
        return;
      }
    }

    // Grupo financeiro (comprovantes/pagamentos): reclamação e comprovante do
    // prestador vão para o SAC, nunca viram chamado de cliente.
    // Acompanhamento velado: cada dia vira um atendimento "Roteirizador" com as paradas
    // do trajeto — lido das mensagens, sem IA
    if (conversation.isGroup && ehGrupoRoteirizador(conversation.groupName)) {
      await registrarRoteirizador(this.prisma, this.logger, conversation, messages);
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: messages[messages.length - 1].sentAt } });
      return;
    }
    if (ehGrupoFinanceiro(conversation.groupName) || tipoGrupo === 'INTERNO' || tipoGrupo === 'PRESTADOR') {
      let ultimoComprovante: { nome: string; regiao?: string; ids: string[] } | null = null;
      for (const m of messages) {
        const comp = lerComprovantePagamento(m.content);
        if (comp) {
          ultimoComprovante = comp;
          await this.sac.registrarComprovante(comp, { grupo: conversation.groupName, quando: m.sentAt, messageId: m.id });
          continue;
        }
        // IDs na mensagem seguinte ("36254 / 36332 / ...") completam o comprovante anterior
        const ids = ultimoComprovante ? ehSoIds(m.content) : null;
        if (ids && ultimoComprovante) {
          await this.sac.registrarComprovante({ ...ultimoComprovante, ids }, { grupo: conversation.groupName, quando: m.sentAt, messageId: m.id });
          continue;
        }
        const rec = lerReclamacaoSac(m.content);
        if (rec) await this.sac.abrirPeloWhatsApp(rec, { texto: m.content, grupo: conversation.groupName, remetente: m.senderName, messageId: m.id, quando: m.sentAt });
      }
      if (ehGrupoFinanceiro(conversation.groupName)) {
        await this.prisma.conversation.update({ where: { id: conversationId }, data: { tipoGrupo: 'INTERNO', status: 'PROCESSADA', lastClassifiedAt: messages[messages.length - 1].sentAt } });
        return;
      }
    }

    // Grupo interno: só lê formulários (correção encaminhada ao Suporte), nunca chama a IA
    if (tipoGrupo === 'INTERNO') {
      for (const m of messages) {
        const form = lerFormularioRetorno(m.content);
        if (form) await this.registrarFormularioRetorno(form, conversation.groupName ?? 'grupo interno', m.sentAt, m.senderName, conversationId, null, false);
      }
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: messages[messages.length - 1].sentAt } });
      return;
    }
    if (tipoGrupo === 'PRESTADOR' || tipoGrupo === 'CLIENTE') {
      const restantes: typeof messages = [];
      for (const m of messages) {
        const form = lerFormularioRetorno(m.content);
        if (form) await this.registrarFormularioRetorno(form, conversation.groupName ?? 'grupo', m.sentAt, m.senderName, conversationId, conversation.empresaId, tipoGrupo === 'CLIENTE');
        else restantes.push(m);
      }
      mensagensParaIA = tipoGrupo === 'PRESTADOR' ? restantes.filter((m) => m.content.trim().length > 15 && !m.content.startsWith('[')) : restantes;
      // Formulário pode ter cadastrado/ligado chamado: a IA precisa enxergar a lista atualizada
      const atualizados = await this.prisma.atendimento.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' } });
      conversation.atendimentos.splice(0, conversation.atendimentos.length, ...atualizados);
      abertos.splice(0, abertos.length, ...atualizados.filter((a) => a.status !== 'CONCLUIDO' && a.status !== 'CANCELADO'));
      // Grupo de prestador só com formulários: nem chama a IA (custo zero)
      if (tipoGrupo === 'PRESTADOR' && !mensagensParaIA.length) {
        await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: messages[messages.length - 1].sentAt } });
        return;
      }
    }
    // No grupo do cliente o formulário também fica no texto enviado à IA como contexto (sequência completa)
    const transcriptIA = tipoGrupo === 'PRESTADOR' ? mensagensParaIA.map(linhaTranscript).join('\n') : transcript;

    const contexto = !conversation.isGroup
      ? 'Conversa de atendimento via WhatsApp.'
      : tipoGrupo === 'PRESTADOR'
        ? `Grupo de PRESTADORES "${conversation.groupName ?? ''}": o PR7 repassa chamados de clientes (com ID do acionamento e conta) e os prestadores/agentes dão retorno. Para cada chamado citado, informe id_pr7 e conta, e o andamento relatado.`
        : `Grupo do CLIENTE "${conversation.groupName ?? ''}": cliente e operador do PR7 tratam vários chamados diferentes aqui.`;

    const prompt = incremental
      ? `${contexto}\n\nChamados já registrados:\n` +
        abertos
          .map(
            (a) =>
              `- Ocorrência ${a.ocorrencia ?? '(sem número)'} | ${a.status} | ${a.category ?? ''} | ${a.summary ?? ''}`,
          )
          .join('\n') +
        `\n\nAbaixo estão APENAS as mensagens novas. Devolva o estado ATUAL de cada ` +
        `chamado citado nelas: se for um dos já registrados, repita a mesma ocorrência ` +
        `e atualize o resumo cobrindo o chamado inteiro; se for um chamado novo, ` +
        `devolva como item separado.\n\nMensagens novas:\n${transcriptIA}`
      : `${contexto}\n\nExtraia os chamados presentes nestas mensagens.\n\n${transcriptIA}`;

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1024,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
      messages: [{ role: 'user', content: prompt }],
    });

    const lastMessageAt = messages[messages.length - 1].sentAt;

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      this.logger.error(`Claude não retornou extração estruturada para a conversa ${conversationId}`);
      await this.recordUsage(conversationId, null, response.usage, incremental);
      return;
    }

    const { atendimentos: extraidos = [] } = toolUse.input as {
      atendimentos?: Array<{
        categoria: string;
        resumo: string;
        status: AtendimentoStatus;
        resultado?: string;
        ocorrencia?: string;
        vertical?: 'PATRIMONIAL' | 'VEICULAR';
        cidade?: string;
        uf?: string;
        placa?: string;
        motivo_nao_atendimento?: MotivoNaoAtendimento;
        evento?: string;
        id_pr7?: string;
        estabelecimento?: string;
        operador_pr7?: string;
        tecnico?: string;
        hora_solicitacao?: string;
        hora_pedido_autorizacao?: string;
        hora_liberacao?: string;
        hora_chegada?: string;
        hora_termino?: string;
        prazo_informado?: string;
        relato?: string;
        responsavel_local?: string;
        responsavel_telefone?: string;
        hora_fotos?: string;
        hora_encerramento?: string;
        hora_cancelamento?: string;
        motivo_cancelamento?: string;
      }>;
    };
    const primeiraMensagemAt = messages[0].sentAt;

    let ultimoId: string | null = null;

    // Grupo de prestador: nunca abre chamado nem evento — o retorno é ligado ao chamado
    // original pelo ID PR7 ou pela conta e vira anotação na tratativa.
    if (tipoGrupo === 'PRESTADOR') {
      for (const item of extraidos) ultimoId = (await this.vincularRetornoPrestador(item, conversation.groupName ?? 'grupo de prestador', lastMessageAt)) ?? ultimoId;
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: lastMessageAt } });
      await this.recordUsage(conversationId, ultimoId, response.usage, incremental);
      return;
    }
    // Empresa cliente dona do grupo (Orsegups, Segurpro...): descobre pelo nome uma única vez
    let empresaIdDoGrupo = conversation.empresaId;
    if (tipoGrupo === 'CLIENTE' && !empresaIdDoGrupo) {
      const empresas = await this.prisma.empresa.findMany({ select: { id: true, razaoSocial: true, nomeFantasia: true, cidade: true, apelidos: true } });
      empresaIdDoGrupo = empresaDoGrupo(conversation.groupName, empresas)?.id ?? null;
      if (empresaIdDoGrupo) await this.prisma.conversation.update({ where: { id: conversationId }, data: { empresaId: empresaIdDoGrupo } });
    }
    // Grupo interno ou ainda sem tipo definido: só registra as mensagens, sem abrir chamado
    if (conversation.isGroup && tipoGrupo !== 'CLIENTE') {
      this.logger.log(`Grupo "${conversation.groupName}" ${tipoGrupo === 'INTERNO' ? 'interno' : 'sem tipo definido'} — nenhum chamado aberto`);
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PROCESSADA', lastClassifiedAt: lastMessageAt } });
      await this.recordUsage(conversationId, null, response.usage, incremental);
      return;
    }

    for (const item of extraidos) {
      // "<UNKNOWN>", "não informado"... não é número de ocorrência
      if (item.ocorrencia && /unknown|desconhecid|n[aã]o (foi )?(informad|identificad)|^n\/?a$|^-+$|^sem\b/i.test(item.ocorrencia.trim())) item.ocorrencia = undefined;
      // Rede de segurança: item sem serviço reconhecível e sem nº de ocorrência não é chamado
      // (a IA às vezes devolve "desconhecido" para testes e conversas soltas)
      const semServico = !item.categoria?.trim() || /unknown|desconhecid|indefinid|n[aã]o identificad|n\/a/i.test(item.categoria);
      if (semServico && !item.ocorrencia) {
        this.logger.log(`Mensagens sem chamado em ${conversation.groupName ?? conversationId} — nada registrado`);
        continue;
      }
      // Sequência operacional no formato da central (quando a conversa traz essas etapas).
      // As horas são encaixadas a partir do pedido do próprio chamado (ver encaixarHoras).
      const idDoItem = idPR7Valido(item.id_pr7) ? item.id_pr7!.replace(/\D/g, '') : null;
      const chamadoPrevio = idDoItem
        ? conversation.atendimentos.find((a) => a.idPR7 === idDoItem) ?? (item.ocorrencia ? conversation.atendimentos.find((a) => a.ocorrencia === item.ocorrencia) : undefined)
        : item.ocorrencia ? conversation.atendimentos.find((a) => a.ocorrencia === item.ocorrencia) : abertoCompativel(abertos, item.estabelecimento, primeiraMensagemAt, conversation.isGroup);
      const quando = encaixarHoras(
        { solicitacao: item.hora_solicitacao, outras: [item.hora_pedido_autorizacao, item.hora_liberacao, item.hora_chegada, item.hora_fotos, item.hora_termino, item.hora_encerramento, item.hora_cancelamento] },
        chamadoPrevio?.solicitadoEm, primeiraMensagemAt, new Date(), messages,
      );
      const resumoOperacional = montarResumoOperacional(item);
      const dados: Prisma.AtendimentoUncheckedUpdateInput = {
        category: categoriaOficial(item.categoria, item.placa),
        summary: resumoOperacional ?? item.resumo,
        ...(operadorValido(item.operador_pr7, conversation.groupName) ? { operadorPR7: nomeDoHelpDesk(item.operador_pr7)!.slice(0, 80) } : {}),
        ...(item.tecnico ? { agenteNome: item.tecnico.slice(0, 120) } : {}),
        ...(item.relato ? { resultado: item.relato.slice(0, 2000) } : {}),
        ...(quando(item.hora_pedido_autorizacao) ? { autorizacaoPedidaEm: quando(item.hora_pedido_autorizacao) } : {}),
        ...(quando(item.hora_liberacao) ? { liberadoEm: quando(item.hora_liberacao) } : {}),
        ...(quando(item.hora_chegada) ? { chegadaEm: quando(item.hora_chegada) } : {}),
        ...(quando(item.hora_termino) ? { concluidoEm: quando(item.hora_termino) } : {}),
        status: item.status,
        resultado: item.resultado,
        ocorrencia: item.ocorrencia || null,
        ...(idPR7Valido(item.id_pr7) ? { idPR7: item.id_pr7!.replace(/\D/g, '') } : {}),
        // Número grande é ocorrência do cliente (ex: ORSEGUPS 33760663), não ID do PR7
        ...(!idPR7Valido(item.id_pr7) && item.id_pr7 && !item.ocorrencia ? { ocorrencia: item.id_pr7.trim().slice(0, 40) } : {}),
      };

      // ID PR7 ou ocorrência distinguem um chamado do outro dentro do mesmo grupo.
      // Sem eles, cai no chamado aberto mais recente (conversa 1-a-1 costuma ser assim).
      const idPR7 = idPR7Valido(item.id_pr7) ? item.id_pr7!.replace(/\D/g, '') : null;
      // Sem ID e sem ocorrência: em conversa 1-a-1 é o chamado aberto. Em GRUPO só é o
      // aberto quando há um único, do mesmo estabelecimento e pedido recente — senão é
      // outra ocorrência (ORSEGUPS: o "deslocar L329" do dia 16 caiu no chamado da Clamed
      // do dia 15 e o "liberado" do Boticário encerrou a Clamed).
      const identificado = Boolean(idPR7 || item.ocorrencia) || !conversation.isGroup;
      let existente = idPR7
        ? conversation.atendimentos.find((a) => a.idPR7 === idPR7) ?? (item.ocorrencia ? conversation.atendimentos.find((a) => a.ocorrencia === item.ocorrencia) : undefined)
        : item.ocorrencia
          ? conversation.atendimentos.find((a) => a.ocorrencia === item.ocorrencia)
          : abertoCompativel(abertos, item.estabelecimento, primeiraMensagemAt, conversation.isGroup);
      // O mesmo ID PR7 pode já existir fora desta conversa (cadastrado pelo retorno no grupo do
      // prestador): nunca duplica — assume o chamado e liga a esta conversa
      if (!existente && idPR7) {
        const outro = await this.prisma.atendimento.findFirst({ where: { idPR7 }, orderBy: { createdAt: 'desc' } });
        if (outro) {
          existente = outro;
          if (!outro.conversationId) dados.conversationId = conversationId;
        }
      }

      // Chamado já encerrado (pela central, pela revisão ou pelo cliente): a IA nunca reabre nem reescreve
      if (existente && ['CONCLUIDO', 'CANCELADO', 'NAO_ATENDIDO'].includes(existente.status)) {
        this.logger.log(`Chamado ${existente.id} já encerrado (${existente.status}) — mensagens novas não alteram o registro`);
        continue;
      }

      // Local: nº da ocorrência costuma ser o código da conta, que já tem endereço
      // cadastrado (mais confiável que a cidade citada na conversa).
      const conta = await contaConfirmada(this.prisma, item.ocorrencia, item.estabelecimento);
      const uf = (conta?.estado ?? item.uf ?? '').toUpperCase();
      const cidade = conta?.cidade ?? item.cidade?.trim();
      if (conta) dados.contaId = conta.id;
      if (item.vertical) dados.vertical = item.vertical;
      if (item.placa) dados.placa = item.placa.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
      // Coerência: chamado com placa e sem conta de imóvel é Veicular — "Ronda" é serviço Patrimonial
      if (item.placa && !conta) {
        dados.vertical = 'VEICULAR';
        if (/ronda|preserva|manuten/i.test(String(dados.category))) dados.category = 'Análise de Tecnologia Rastreável';
      }
      // Modo revisão (CLASSIFICACAO_REVISAO_MANUAL=true): a IA não encerra nada. Todo chamado
      // fica EM_ANDAMENTO e o status que ela sugeriu vai em detalhes.statusSugeridoIA para a equipe decidir.
      // Cliente liberou o técnico após o retorno: encerramento confirmado pelo próprio cliente,
      // vale mesmo com a revisão manual ligada (regra da operação)
      // Só encerra pelo "liberado"/"cancelou" do cliente quando a mensagem identifica o
      // chamado (ID/ocorrência) ou é um chamado novo deste mesmo lote. Chamado antigo
      // alcançado sem identificação fica para a revisão do Help Desk.
      const podeEncerrar = identificado || !existente;
      if (!podeEncerrar && (item.hora_encerramento || item.hora_cancelamento)) {
        this.logger.warn(`"${item.hora_encerramento ? 'liberado' : 'cancelado'}" sem ID/ocorrência em "${conversation.groupName}" — chamado ${existente!.id} não encerrado automaticamente`);
      }
      const liberadoPeloCliente = podeEncerrar ? quando(item.hora_encerramento) : undefined;
      // Cliente cancelou: decisão do próprio cliente, também vale com a revisão manual ligada
      const canceladoPeloCliente = podeEncerrar && !liberadoPeloCliente ? quando(item.hora_cancelamento) : undefined;
      if (canceladoPeloCliente) {
        const pedido = quando(item.hora_solicitacao) ?? existente?.solicitadoEm ?? primeiraMensagemAt;
        const minutos = Math.max(0, Math.round((+canceladoPeloCliente - +pedido) / 60000));
        item.status = 'CANCELADO';
        Object.assign(dados, {
          status: 'CANCELADO', motivoNaoAtendimento: 'CANCELADO_CLIENTE', encerradoPor: 'cliente cancelou (IA)', encerradoEm: canceladoPeloCliente,
          detalheNaoAtendimento: detalheCancelamento({
            minutos, horaCancelamento: item.hora_cancelamento, motivo: item.motivo_cancelamento,
            prazo: item.prazo_informado, horaPrazo: item.hora_pedido_autorizacao, cancelou: canceladoPeloCliente, prazoEm: quando(item.hora_pedido_autorizacao),
          }),
        });
      }
      if (liberadoPeloCliente) {
        item.status = 'CONCLUIDO';
        dados.status = 'CONCLUIDO';
        dados.concluidoEm = liberadoPeloCliente;
        dados.encerradoPor = 'cliente liberou (IA)';
        dados.encerradoEm = liberadoPeloCliente;
      }
      if (process.env.CLASSIFICACAO_REVISAO_MANUAL === 'true' && !liberadoPeloCliente && !canceladoPeloCliente) {
        const sugerido = item.status;
        const sugestao = item.motivo_nao_atendimento ? `${sugerido} (${item.motivo_nao_atendimento})` : sugerido;
        item.status = 'EM_ANDAMENTO';
        item.motivo_nao_atendimento = undefined;
        const anteriores = (existente?.detalhes ?? {}) as Record<string, unknown>;
        dados.status = 'EM_ANDAMENTO';
        dados.detalhes = { ...anteriores, statusSugeridoIA: sugestao, aguardandoRevisao: true } as Prisma.InputJsonValue;
      }
      // Linha do tempo aproximada pelas mensagens (a IA roda em lotes, então o
      // horário é o da última mensagem do lote em que a mudança apareceu)
      // Horários informados na conversa têm prioridade; sem eles, aproxima pelo lote de mensagens
      if (!existente) dados.solicitadoEm = quando(item.hora_solicitacao) ?? primeiraMensagemAt;
      else if (quando(item.hora_solicitacao) && !existente.solicitadoEm) dados.solicitadoEm = quando(item.hora_solicitacao);
      if (item.status === 'EM_ANDAMENTO' && !existente?.acionadoEm) dados.acionadoEm = quando(item.hora_liberacao) ?? lastMessageAt;
      if (item.status === 'CONCLUIDO' && !existente?.concluidoEm && !dados.concluidoEm) dados.concluidoEm = lastMessageAt;
      // Responsável no local: nome e telefone podem vir em mensagens diferentes
      if (item.responsavel_local) dados.responsavelLocalNome = item.responsavel_local.slice(0, 120);
      const telResp = item.responsavel_telefone?.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      if (telResp && /^\d{10,11}$/.test(telResp)) dados.responsavelLocalTelefone = telResp;
      if (item.status === 'CANCELADO' || item.status === 'NAO_ATENDIDO') {
        dados.motivoNaoAtendimento = item.motivo_nao_atendimento ?? (item.status === 'CANCELADO' ? 'CANCELADO_CLIENTE' : 'OUTRO');
        if (!existente?.encerradoEm && !dados.encerradoEm) { dados.encerradoPor = 'IA'; dados.encerradoEm = lastMessageAt; }
      }
      if (cidade || CENTRO_UF[uf]) {
        // Parte do que já foi montado acima (ex.: sugestão da IA no modo revisão)
        const anteriores = (dados.detalhes ?? existente?.detalhes ?? {}) as Record<string, unknown>;
        dados.detalhes = { ...anteriores, ...(cidade ? { cidade } : {}), ...(CENTRO_UF[uf] ? { estado: uf } : {}) } as Prisma.InputJsonValue;
      }

      // Chamado NOVO em grupo precisa de algo que identifique o pedido: ID, ocorrência,
      // estabelecimento, placa ou a print/foto que o cliente manda ao pedir. Sem nada disso
      // é conversa solta ("positivo central" / "OK" virou o PR7-H-000099).
      if (!existente && conversation.isGroup) {
        const fotoDoCliente = messages.some((m) => m.direction === 'ENTRANTE' && m.content.startsWith('[Foto]'));
        if (!idPR7 && !item.ocorrencia && !item.estabelecimento?.trim() && !item.placa && !fotoDoCliente) {
          this.logger.log(`"${(item.resumo ?? '').slice(0, 60)}" em ${conversation.groupName} sem identificação do pedido — não abre chamado`);
          continue;
        }
      }

      const salvo = existente
        ? await this.prisma.atendimento.update({ where: { id: existente.id }, data: dados })
        : await this.prisma.atendimento.create({
            data: {
              ...(dados as Prisma.AtendimentoUncheckedCreateInput), conversationId, clientId: conversation.clientId, empresaId: empresaIdDoGrupo,
              // Chamado sem ID PR7 na conversa ganha o nosso identificador
              ...(dados.idPR7 ? {} : { idInterno: await proximoIdInterno(this.prisma) }),
            },
          });
      // Fotos mandadas antes da IA classificar ficam ligadas a este chamado
      if (!existente) await this.midias.vincularSoltas(conversationId, salvo.id, new Date(primeiraMensagemAt.getTime() - 60000));
      // O retorno no grupo do prestador pode ter cadastrado o mesmo chamado: une os dois
      await this.mesclarPorIdPR7(idPR7 ?? (dados.idPR7 as string | undefined), salvo.id);

      // Monitoramento trata só o veicular (regra da operação): chamado patrimonial
      // não abre evento na fila — é acompanhado na tela de Atendimentos.
      // E dentro do veicular, só os eventos de telemetria da central (painel violado,
      // bateria, bloqueio, cerca). Roubo e furto são ocorrência de atendimento: o
      // chamado já foi criado acima e não vira tratativa de evento.
      const tipoEvento = item.evento?.trim() || String(dados.category ?? 'Evento');
      const eventoMonitoramento = tipoEventoVeicular(`${tipoEvento} ${item.resumo}`);
      if (!existente && eventoMonitoramento && ((dados.vertical as Vertical) ?? conversation.atendimentos[0]?.vertical) === 'VEICULAR') {
        await this.prisma.evento.create({
          data: {
            idInterno: await proximoIdEvento(this.prisma, primeiraMensagemAt),
            origem: 'WHATSAPP', vertical: 'VEICULAR', tipo: eventoMonitoramento,
            prioridade: prioridadePorTexto(`${tipoEvento} ${item.resumo}`), descricao: item.resumo,
            clienteNome: conversation.groupName ?? null, placa: (dados.placa as string) ?? null,
            cidade: cidade ?? null, uf: CENTRO_UF[uf] ? uf : null, ocorrencia: item.ocorrencia || null, idPR7,
            recebidoEm: primeiraMensagemAt, atendimentoId: salvo.id,
            tratativas: { create: { tipo: 'SISTEMA', texto: `Recebido pelo WhatsApp (${conversation.groupName ?? 'conversa'}) e classificado pela IA`, usuario: 'IA' } },
          },
        }).catch((err) => this.logger.error(`Evento do monitoramento não criado: ${err.message}`));
      }
      if (!existente) {
        this.logger.log(
          `Novo chamado ${identificador(salvo)} (ocorrência ${dados.ocorrencia ?? 'sem número'}) em ` +
            `${conversation.groupName ?? conversationId}`,
        );
      }

      // Cliente liberou ou cancelou: fecha também o evento do Monitoramento
      if (liberadoPeloCliente || canceladoPeloCliente) {
        const ev = await this.prisma.evento.findUnique({ where: { atendimentoId: salvo.id } });
        if (ev && ev.status !== 'ENCERRADO') {
          await this.prisma.evento.update({
            where: { id: ev.id },
            data: {
              status: 'ENCERRADO', desfecho: liberadoPeloCliente ? 'ATENDIMENTO_REALIZADO' : 'CANCELADO_CLIENTE',
              encerradoPor: liberadoPeloCliente ? 'cliente liberou (IA)' : 'cliente cancelou (IA)', encerradoEm: liberadoPeloCliente ?? canceladoPeloCliente,
              tratativas: { create: { tipo: 'STATUS', usuario: 'IA', texto: liberadoPeloCliente
                ? `Cliente liberou o técnico de vistoria às ${item.hora_encerramento} — atendimento encerrado`
                : String(dados.detalheNaoAtendimento) } },
            },
          });
        }
      }

      ultimoId = salvo.id;
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'PROCESSADA', lastClassifiedAt: lastMessageAt },
    });
    // Foto do pedido e laudo do prestador entram no chamado certo (nº da ocorrência ou horário)
    await this.midias.vincularPelaJanela(conversationId);

    await this.recordUsage(conversationId, ultimoId, response.usage, incremental);
  }

  /**
   * Lê as prints de pedido que ainda não foram lidas (uma chamada de visão por imagem,
   * guardada em Midia.leitura para nunca repetir). Ligar com LER_PRINT_PEDIDO=true.
   */
  private async lerPrintsDoPedido(messages: { id: string; content: string }[], conversationId: string) {
    const mapa = new Map<string, string>();
    if (process.env.LER_PRINT_PEDIDO !== 'true' || !messages.length) return mapa;
    const midias = await this.prisma.midia.findMany({
      where: { messageId: { in: messages.map((m) => m.id) }, tipo: 'FOTO', status: 'SALVA' },
      select: { id: true, messageId: true, mimeType: true, leitura: true, atendimentoId: true },
    });
    for (const midia of midias) {
      if (!midia.messageId) continue;
      let dados = midia.leitura as PrintDoPedido | null;
      if (!dados && ehImagemSuportada(midia.mimeType)) {
        const arquivo = await this.midias.arquivoBase64(midia.id);
        if (!arquivo) continue;
        try {
          const { dados: lido, usage } = await lerPrintDoPedido(this.anthropic, this.model, arquivo.base64, midia.mimeType);
          dados = lido;
          await this.prisma.midia.update({ where: { id: midia.id }, data: { leitura: (lido ?? {}) as Prisma.InputJsonValue, lidaEm: new Date() } });
          await this.prisma.classificationRun.create({
            data: {
              conversationId, model: this.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: 0,
              costUsd: costUsd(this.model, { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: 0 }),
              incremental: true,
            },
          }).catch(() => undefined);
          if (lido?.ocorrencia) this.logger.log(`Print do pedido lida: ocorrência ${lido.ocorrencia}${lido.estabelecimento ? ' — ' + lido.estabelecimento : ''}`);
        } catch (err) {
          this.logger.warn(`Não consegui ler a print ${midia.id}: ${(err as Error).message}`);
          continue;
        }
      }
      const descricao = dados ? descreverPrint(dados) : '';
      if (descricao) mapa.set(midia.messageId, descricao);
    }
    return mapa;
  }

  /**
   * Evento da central de rastreamento vira item da fila do Monitoramento (veicular).
   * Sem IA e sem duplicar: a mensagem original é a chave.
   */
  private async registrarEventoTelemetria(ev: EventoTelemetria, m: { id: string; sentAt: Date }, grupo?: string | null) {
    // Só os eventos que o Monitoramento trata. Roubo/furto que venha nesse formato é
    // ocorrência de atendimento veicular: segue para a classificação, não para a fila.
    const tipo = tipoEventoVeicular(ev.descricao);
    if (!tipo) {
      this.logger.log(`"${ev.descricao.slice(0, 60)}" não é evento de monitoramento — segue como atendimento veicular`);
      return null;
    }
    const jaTem = await this.prisma.evento.findFirst({ where: { origem: 'WHATSAPP', vertical: 'VEICULAR', tipo, placa: ev.placa ?? null, ocorridoEm: ev.ocorridoEm ?? null } });
    if (jaTem) return jaTem.id;
    const descricao = [
      `${ev.descricao}${ev.placa ? ' — placa ' + ev.placa : ''}`,
      ev.cliente ? `Cliente: ${ev.cliente}` : null,
      ev.localizacao ? `Local: ${ev.localizacao}` : null,
    ].filter(Boolean).join('\n');
    const e = await this.prisma.evento.create({
      data: {
        idInterno: await proximoIdEvento(this.prisma, m.sentAt),
        origem: 'WHATSAPP', vertical: 'VEICULAR', tipo, prioridade: prioridadePorTexto(ev.descricao),
        descricao, clienteNome: ev.cliente ?? grupo ?? null, placa: ev.placa ?? null,
        cidade: ev.cidade ?? null, uf: ev.uf ?? null, ocorridoEm: ev.ocorridoEm ?? null, recebidoEm: m.sentAt,
        tratativas: { create: { tipo: 'SISTEMA', texto: `Evento recebido da central no grupo "${grupo ?? 'WhatsApp'}"`, usuario: 'sistema' } },
      },
    });
    this.logger.log(`Evento de monitoramento: ${tipo}${ev.placa ? ' (' + ev.placa + ')' : ''} — ${ev.cliente ?? grupo ?? ''}`);
    return e.id;
  }

  /**
   * Mesmo ID PR7 em dois registros (o retorno do prestador cadastrou antes de a IA
   * ler o grupo do cliente): fica o do grupo do cliente, com as fotos e os dados que
   * só o retorno tinha. Nunca some informação.
   */
  private async mesclarPorIdPR7(idPR7: string | null | undefined, manterId: string) {
    if (!idPR7) return;
    const irmaos = await this.prisma.atendimento.findMany({ where: { idPR7, id: { not: manterId } }, include: { evento: true, midias: { select: { id: true } } } });
    if (!irmaos.length) return;
    const manter = await this.prisma.atendimento.findUnique({ where: { id: manterId } });
    if (!manter) return;
    for (const dup of irmaos) {
      // O que fica é o ligado à conversa do cliente; se o duplicado for esse, troca os papéis
      if (!manter.conversationId && dup.conversationId) continue;
      const completar: Prisma.AtendimentoUncheckedUpdateInput = {};
      for (const campo of ['agenteNome', 'operadorPR7', 'codigoValidacao', 'sap', 'ocorrencia', 'contaId', 'empresaId', 'responsavelLocalNome', 'responsavelLocalTelefone', 'resultado', 'chegadaEm', 'concluidoEm', 'acionadoEm'] as const) {
        const atual = (manter as Record<string, unknown>)[campo];
        const outro = (dup as Record<string, unknown>)[campo];
        if ((atual === null || atual === undefined) && outro !== null && outro !== undefined) (completar as Record<string, unknown>)[campo] = outro;
      }
      const detalhes = { ...((manter.detalhes ?? {}) as Record<string, unknown>) };
      const dupDetalhes = (dup.detalhes ?? {}) as Record<string, unknown>;
      if (!detalhes.retornoPrestador && dupDetalhes.retornoPrestador) detalhes.retornoPrestador = dupDetalhes.retornoPrestador;
      completar.detalhes = detalhes as Prisma.InputJsonValue;
      await this.prisma.atendimento.update({ where: { id: manterId }, data: completar });
      if (dup.midias.length) await this.prisma.midia.updateMany({ where: { atendimentoId: dup.id }, data: { atendimentoId: manterId } });
      if (dup.evento) {
        await this.prisma.eventoTratativa.deleteMany({ where: { eventoId: dup.evento.id } });
        await this.prisma.evento.delete({ where: { id: dup.evento.id } });
      }
      await this.prisma.atendimento.delete({ where: { id: dup.id } });
      this.logger.warn(`Chamado duplicado do ID PR7 ${idPR7} removido (${dup.id}) — dados mantidos em ${manterId}`);
    }
  }

  /**
   * Formulário de retorno do prestador (lido sem IA).
   * - Liga ao chamado pelo ID PR7; sem ID, pela conta entre os abertos dos últimos 30 dias.
   * - Não achou e o formulário está completo: cadastra o chamado a partir do retorno.
   * - Completo: preenche os dados (agente, horários, relato) e deixa pronto para a central encerrar.
   * - Incompleto: marca NÃO ATENDIDO com motivo pendente — o painel exige o motivo em pop-up.
   */
  private async registrarFormularioRetorno(form: FormularioRetorno, grupo: string, quando: Date, remetente: string | null | undefined, conversationIdDoForm: string, empresaId?: string | null, grupoDoCliente = false): Promise<string | null> {
    const c = { ...form.campos };
    // Número que não tem cara de ID do PR7 (ocorrência do cliente, sobra de leitura)
    // não pode virar ID do acionamento — vira nº de ocorrência quando não houver conta.
    if (c.id && !idPR7Valido(c.id)) {
      this.logger.warn(`Retorno em "${grupo}" com ID "${c.id}" fora do padrão do PR7 — tratado como ocorrência`);
      if (!c.conta) c.conta = c.id;
      delete c.id;
    }
    const ref = [c.id && `ID ${c.id}`, c.conta && `conta ${c.conta}`, c.validacao && `validação ${c.validacao}`, c.sap && `SAP ${c.sap}`].filter(Boolean).join(' / ');
    const util = (v?: string) => (v && !/^(-+|sem|n[aã]o possui|n[aã]o informado|n[aã]o foi informado|n\/?inf|sem informa)/i.test(v.trim()) ? v.trim() : undefined);
    const validacao = util(c.validacao), sap = util(c.sap);
    // "Conta: Não possui" é resposta válida, mas não é número de conta: não busca nem grava.
    // Formato da Eliane traz a ocorrência do cliente separada ("*ocorrência*33793207").
    c.conta = util(c.conta) ?? (util(c.ocorrencia) as string);
    if (!c.conta) delete c.conta;
    const horaPedido = horaDoFormulario(c.horaSolicitada, quando, c.data);

    // 1) ID PR7 é único: vínculo direto
    let alvo = c.id ? await this.prisma.atendimento.findFirst({ where: { idPR7: c.id }, orderBy: { createdAt: 'desc' }, include: { evento: true } }) : null;

    // 2) Sem ID: nº de conta se repete entre empresas — só liga se cliente, horário e
    //    validação/SAP (quando existirem) conferirem, e se sobrar exatamente UM candidato
    if (!alvo && c.conta) {
      const candidatos = await this.prisma.atendimento.findMany({
        where: {
          createdAt: { gt: new Date(Date.now() - 30 * 864e5) }, status: { in: ['NOVO', 'EM_ANDAMENTO'] },
          // Duas condições OR precisam ficar dentro de AND — no mesmo objeto a segunda
          // apagaria a primeira e a conta seria ignorada (trazia todos os chamados abertos).
          AND: [
            { OR: [{ ocorrencia: c.conta }, { conta: { codigo: c.conta } }] },
            ...(empresaId ? [{ OR: [{ empresaId }, { empresaId: null }] }] : []),
          ],
        },
        include: { evento: true },
      });
      const conferem = candidatos.filter((a) =>
        // Formulário com ID próprio (ex: 36892) não é o chamado que já tem outro ID (36881/36909
        // da mesma conta): o ID do PR7 é único por acionamento
        (!c.id || !a.idPR7 || a.idPR7 === c.id) &&
        (!validacao || !a.codigoValidacao || a.codigoValidacao === validacao) &&
        (!sap || !a.sap || a.sap === sap) &&
        (!horaPedido || !a.solicitadoEm || Math.abs(+a.solicitadoEm - +horaPedido) <= 3 * 3600e3),
      );
      if (conferem.length === 1) alvo = conferem[0];
      else if (conferem.length > 1) {
        this.logger.warn(`Retorno (${ref}) em "${grupo}" confere com ${conferem.length} chamados — não ligado automaticamente, para não errar`);
        return null;
      }
    }

    // Repasse (ex: operador manda "ID: 36878" no grupo de prestadores): só registra que foi repassado
    if (!form.ehRetorno) {
      if (alvo) {
        if (!alvo.acionadoEm) await this.prisma.atendimento.update({ where: { id: alvo.id }, data: { acionadoEm: quando } });
        if (alvo.evento && alvo.evento.status !== 'ENCERRADO') {
          await this.prisma.eventoTratativa.create({ data: { eventoId: alvo.evento.id, tipo: 'ACIONAMENTO', texto: `Chamado repassado ao grupo "${grupo}" (${ref})`, usuario: 'sistema' } });
          if (['NOVO', 'EM_TRATATIVA'].includes(alvo.evento.status)) await this.prisma.evento.update({ where: { id: alvo.evento.id }, data: { status: 'ENCAMINHADO' } });
        }
        this.logger.log(`Repasse do chamado ${alvo.id} (${ref}) registrado em "${grupo}"`);
      }
      return alvo?.id ?? null;
    }

    if (!alvo && !form.completo) {
      this.logger.warn(`Formulário de retorno incompleto e sem chamado correspondente (${ref}) em "${grupo}" — faltando: ${form.faltando.join(', ')}`);
      return null;
    }

    // Nº de conta se repete entre empresas: só usa a conta cadastrada se o estabelecimento também bater
    const conta = await contaConfirmada(this.prisma, c.conta, c.estabelecimento);
    if (!alvo) {
      // Retorno de um acionamento que não passou pelo sistema: cadastra a partir do formulário
      const nome = c.estabelecimento || conta?.estabelecimento || 'Cliente não identificado';
      const cliente = conta ? { id: conta.clientId } : await this.prisma.client.upsert({ where: { phone: `import:${nome}` }, create: { phone: `import:${nome}`, name: nome }, update: {} });
      const criado = await this.prisma.atendimento.create({
        data: {
          clientId: cliente.id, contaId: conta?.id, idPR7: c.id || null, ocorrencia: c.conta || null,
          ...(c.id ? {} : { idInterno: await proximoIdInterno(this.prisma) }),
          codigoValidacao: validacao ?? null, sap: sap ?? null,
          vertical: c.placa ? 'VEICULAR' : 'PATRIMONIAL', category: categoriaOficial(c.servico, c.placa),
          summary: c.relato?.slice(0, 500), status: 'EM_ANDAMENTO',
          // Sem "Hr. solicitada" (ronda programada): o pedido não pode ficar depois da chegada —
          // usa a chegada; só sem nenhuma das duas usa a hora em que o retorno foi postado
          solicitadoEm: horaDoFormulario(c.horaSolicitada, quando, c.data) ?? horaDoFormulario(c.horaChegada, quando, c.data) ?? quando,
          empresaId: empresaId ?? null,
          // Postado no grupo do cliente: o chamado pertence a esta conversa
          ...(grupoDoCliente ? { conversationId: conversationIdDoForm } : {}),
        },
      });
      alvo = { ...criado, evento: null };
      // Evento só para o veicular — o Monitoramento não trata patrimonial
      if (criado.vertical === 'VEICULAR') await this.prisma.evento.create({
        data: {
          idInterno: await proximoIdEvento(this.prisma, quando),
          origem: 'WHATSAPP', vertical: criado.vertical, tipo: (c.servico || 'Retorno de prestador').slice(0, 80), prioridade: 'BAIXA', status: 'ENCAMINHADO',
          descricao: c.relato, clienteNome: c.estabelecimento || null, cidade: conta?.cidade ?? c.cidade ?? null, uf: conta?.estado ?? null,
          ocorrencia: c.conta || null, idPR7: c.id || null, recebidoEm: quando, atendimentoId: criado.id,
          tratativas: { create: { tipo: 'SISTEMA', texto: `Chamado cadastrado a partir do retorno no grupo "${grupo}" (sem pedido correspondente no sistema)`, usuario: 'sistema' } },
        },
      });
      alvo = await this.prisma.atendimento.findUnique({ where: { id: criado.id }, include: { evento: true } });
    }

    const extra = (alvo!.detalhes ?? {}) as Record<string, unknown>;
    const chegada = horaDoFormulario(c.horaChegada, quando, c.data);
    const termino = horaDoFormulario(c.horaTermino, quando, c.data);
    // "Contato no local": nome e telefone do responsável ("Sr. João - (11) 91234-5678");
    // sem o campo, procura no relato ("Responsável Fabiana informa...", "Denise responsável 13991218452")
    const contato = c.contatoLocal ? separarContato(c.contatoLocal) : responsavelNoRelato(c.relato);
    const dados: Prisma.AtendimentoUncheckedUpdateInput = {
      ...(contato?.nome ? { responsavelLocalNome: contato.nome } : c.contatoLocal && !contato?.telefone ? { responsavelLocalNome: c.contatoLocal.slice(0, 120) } : {}),
      ...(contato?.telefone ? { responsavelLocalTelefone: contato.telefone } : {}),
      ...(c.id && !alvo!.idPR7 ? { idPR7: c.id } : {}),
      ...(conta && !alvo!.contaId ? { contaId: conta.id } : {}),
      ...(c.agente ? { agenteNome: c.agente } : {}),
      ...(validacao && !alvo!.codigoValidacao ? { codigoValidacao: validacao } : {}),
      ...(sap && !alvo!.sap ? { sap } : {}),
      ...(horaPedido && !alvo!.solicitadoEm ? { solicitadoEm: horaPedido } : {}),
      ...(operadorValido(c.operadorPR7) ? { operadorPR7: nomeDoHelpDesk(c.operadorPR7)!.slice(0, 80) } : operadorValido(c.assinatura) ? { operadorPR7: nomeDoHelpDesk(c.assinatura)!.slice(0, 80) } : {}),
      ...(c.ocorrencia && !/n[aã]o possui|^sem/i.test(c.ocorrencia) ? { ocorrencia: c.ocorrencia } : {}),
      ...(empresaId && !alvo!.empresaId ? { empresaId } : {}),
      ...(c.relato ? { resultado: c.relato.slice(0, 2000) } : {}),
      ...(!alvo!.acionadoEm ? { acionadoEm: quando } : {}),
      ...(chegada ? { chegadaEm: chegada } : {}),
      ...(termino ? { concluidoEm: termino } : {}),
      detalhes: {
        ...extra,
        // Contato no local e demais campos do formulário: uso interno (não vão para relatório de cliente)
        retornoPrestador: { ...c, ...form.extras, recebidoEm: quando.toISOString(), grupo, remetente: remetente ?? null },
        ...(c.validacao ? { codigoValidacao: c.validacao } : {}),
        ...(form.completo ? { statusSugeridoIA: 'CONCLUIDO', aguardandoRevisao: true, pendenteMotivo: false } : { pendenteMotivo: true, camposFaltando: form.faltando }),
        ...(c.estabelecimento ? { estabelecimento: c.estabelecimento } : {}),
        ...(form.recomendadosFaltando.length ? { pendenciasRetorno: form.recomendadosFaltando } : { pendenciasRetorno: [] }),
      } as Prisma.InputJsonValue,
    };
    const encerrado = ['CONCLUIDO', 'CANCELADO'].includes(alvo!.status) || (alvo!.status === 'NAO_ATENDIDO' && alvo!.encerradoPor !== 'retorno incompleto');
    if (form.completo) {
      if (alvo!.status === 'NOVO') dados.status = 'EM_ANDAMENTO';
      // Correção do retorno (ex: reenviada no Suporte): o "não atendido" automático deixa de valer
      if (alvo!.status === 'NAO_ATENDIDO' && alvo!.encerradoPor === 'retorno incompleto') {
        Object.assign(dados, { status: 'EM_ANDAMENTO', motivoNaoAtendimento: null, detalheNaoAtendimento: null, encerradoPor: null, encerradoEm: null });
        (dados.detalhes as Record<string, unknown>).camposFaltando = [];
      }
    } else if (encerrado) {
      // Chamado já encerrado pela central: retorno incompleto só acrescenta dados, nunca muda o status
      (dados.detalhes as Record<string, unknown>).pendenteMotivo = false;
    } else {
      // Regra da operação: retorno sem todas as informações = não atendido, motivo obrigatório no painel
      Object.assign(dados, { status: 'NAO_ATENDIDO', motivoNaoAtendimento: null, encerradoPor: 'retorno incompleto', encerradoEm: quando });
    }
    await this.prisma.atendimento.update({ where: { id: alvo!.id }, data: dados });
    await this.mesclarPorIdPR7(c.id ?? alvo!.idPR7, alvo!.id);
    // Fotos que o mesmo prestador mandou antes do formulário (até 3 h) vão para este chamado
    // Fotos mandadas junto do retorno: 20 min antes ou depois do formulário, mesmo remetente
    const fotos = await this.midias.vincularSoltas(conversationIdDoForm, alvo!.id, new Date(quando.getTime() - 20 * 60000), remetente, new Date(quando.getTime() + 20 * 60000));
    if (fotos) this.logger.log(`${fotos} mídia(s) do retorno ligadas ao chamado ${alvo!.id}`);

    if (alvo!.evento && alvo!.evento.status !== 'ENCERRADO') {
      await this.prisma.eventoTratativa.create({
        data: {
          eventoId: alvo!.evento.id, tipo: 'ACIONAMENTO', usuario: 'sistema',
          texto: form.completo
            ? `Retorno completo no grupo "${grupo}" (${ref})${c.agente ? ' · agente ' + c.agente : ''}: ${c.relato ?? ''}`.slice(0, 1000)
            : `Retorno INCOMPLETO no grupo "${grupo}" (${ref}) — faltando: ${form.faltando.join(', ')}. Chamado marcado como não atendido; informe o motivo.`,
        },
      });
      await this.prisma.evento.update({ where: { id: alvo!.evento.id }, data: { status: form.completo ? 'ENCAMINHADO' : 'AGUARDANDO' } });
    }
    this.logger.log(`Formulário de retorno ${form.completo ? 'completo' : 'INCOMPLETO'} ligado ao chamado ${alvo!.id} (${ref})`);
    return alvo!.id;
  }

  /**
   * Retorno vindo do grupo de prestador: acha o chamado original pelo ID PR7 (ou pela
   * conta, entre os abertos dos últimos 30 dias), anota na tratativa do evento e marca
   * o acionamento. Não muda o status final (quem encerra é a central).
   */
  private async vincularRetornoPrestador(
    item: { id_pr7?: string; ocorrencia?: string; resumo: string; status: AtendimentoStatus },
    grupo: string,
    quando: Date,
  ): Promise<string | null> {
    const idPR7 = idPR7Valido(item.id_pr7) ? item.id_pr7!.replace(/\D/g, '') : null;
    const desde = new Date(Date.now() - 30 * 864e5);
    const alvo =
      (idPR7 && (await this.prisma.atendimento.findFirst({ where: { idPR7 }, orderBy: { createdAt: 'desc' }, include: { evento: true } }))) ||
      (item.ocorrencia &&
        (await this.prisma.atendimento.findFirst({
          where: {
            createdAt: { gt: desde }, status: { in: ['NOVO', 'EM_ANDAMENTO'] },
            OR: [{ ocorrencia: item.ocorrencia }, { conta: { codigo: item.ocorrencia } }],
          },
          orderBy: { createdAt: 'desc' },
          include: { evento: true },
        }))) ||
      null;

    const ref = [idPR7 && `ID ${idPR7}`, item.ocorrencia && `conta ${item.ocorrencia}`].filter(Boolean).join(' / ') || 'sem ID/conta';
    if (!alvo) {
      this.logger.warn(`Retorno de prestador sem vínculo (${ref}) em "${grupo}" — nenhum chamado encontrado`);
      return null;
    }

    const extra = (alvo.detalhes ?? {}) as Record<string, unknown>;
    await this.prisma.atendimento.update({
      where: { id: alvo.id },
      data: {
        ...(idPR7 && !alvo.idPR7 ? { idPR7 } : {}),
        ...(!alvo.acionadoEm ? { acionadoEm: quando } : {}),
        ...(alvo.status === 'NOVO' ? { status: 'EM_ANDAMENTO' } : {}),
        detalhes: { ...extra, ultimoRetornoPrestador: item.resumo, statusSugeridoPeloRetorno: item.status } as Prisma.InputJsonValue,
      },
    });
    if (alvo.evento) {
      await this.prisma.eventoTratativa.create({
        data: { eventoId: alvo.evento.id, tipo: 'ACIONAMENTO', texto: `Retorno no grupo de prestador "${grupo}" (${ref}): ${item.resumo}`, usuario: 'IA' },
      });
      if (['NOVO', 'EM_TRATATIVA', 'AGUARDANDO'].includes(alvo.evento.status)) {
        await this.prisma.evento.update({ where: { id: alvo.evento.id }, data: { status: 'ENCAMINHADO' } });
      }
    }
    this.logger.log(`Retorno de prestador ligado ao chamado ${alvo.id} (${ref})`);
    return alvo.id;
  }

  private async recordUsage(
    conversationId: string,
    atendimentoId: string | null,
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null },
    incremental: boolean,
  ) {
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

    const cost = costUsd(this.model, { inputTokens, outputTokens, cacheReadTokens });

    await this.prisma.classificationRun.create({
      data: {
        conversationId,
        atendimentoId,
        model: this.model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        costUsd: cost,
        incremental,
      },
    });

    this.logger.log(
      `Classificação ${incremental ? 'incremental' : 'completa'} da conversa ${conversationId}: ` +
        `${inputTokens} in / ${outputTokens} out — US$ ${cost.toFixed(6)}`,
    );
  }
}
