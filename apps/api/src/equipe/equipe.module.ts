import { FORA_DA_EQUIPE } from './nomes-help-desk';
import { Controller, Get, Injectable, Module, NotFoundException, Query, Req } from '@nestjs/common';
import { Prisma, Vertical } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';

class FiltroEquipeDto {
  @IsOptional() @IsEnum(Vertical) vertical?: Vertical;
  @IsOptional() @IsDateString() de?: string;
  @IsOptional() @IsDateString() ate?: string;
  @IsOptional() @IsString() @Length(1, 120) nome?: string;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const MIN = (a: string, b: string) => Prisma.raw(`extract(epoch from (a."${b}" - a."${a}")) / 60`);
// Intervalos fora destes limites são erro de digitação na origem e não entram na média
const VALIDO = (a: string, b: string, maxHoras: number) =>
  Prisma.raw(`a."${a}" IS NOT NULL AND a."${b}" IS NOT NULL AND a."${b}" >= a."${a}" AND a."${b}" - a."${a}" < interval '${maxHoras} hours'`);

/**
 * Desempenho por operador PR7 (quem registrou/conduziu o chamado).
 * - Resposta: pedido → prestador no local (operador + prestador; única medida do histórico da planilha)
 * - Acionamento: pedido → prestador acionado (tempo do operador; só em chamados registrados pelo sistema)
 * - Chegada: acionado → prestador no local (tempo do prestador)
 * - No local: chegada → conclusão
 * - Não atendidos: CANCELADO + NAO_ATENDIDO, por motivo
 * Sem IA: só consultas no banco, custo zero.
 */
@Injectable()
class EquipeService {
  constructor(private readonly prisma: PrismaService) {}

  private filtro(f: FiltroEquipeDto, u: UsuarioLogado) {
    const v = verticaisPermitidas(u, f.vertical);
    const c: Prisma.Sql[] = [
      v.length ? Prisma.sql`a.vertical::text IN (${Prisma.join(v)})` : Prisma.sql`FALSE`,
      Prisma.sql`coalesce(a."operadorPR7", '') <> ''`,
    ];
    if (f.de) c.push(Prisma.sql`a."createdAt" >= ${new Date(f.de)}`);
    if (f.ate) c.push(Prisma.sql`a."createdAt" < ${new Date(f.ate)}`);
    return Prisma.join(c, ' AND ');
  }

  private metricas() {
    return Prisma.sql`
      count(*) total,
      count(*) FILTER (WHERE a.status = 'CONCLUIDO') concluidos,
      count(*) FILTER (WHERE a.status IN ('CANCELADO','NAO_ATENDIDO')) nao_atendidos,
      count(*) FILTER (WHERE a.status IN ('NOVO','EM_ANDAMENTO')) abertos,
      count(*) FILTER (WHERE a."motivoNaoAtendimento" = 'NEGATIVA_PRESTADOR') negativas,
      count(*) FILTER (WHERE a."motivoNaoAtendimento" = 'DEMORA_ATENDIMENTO') demoras,
      count(*) FILTER (WHERE a."motivoNaoAtendimento" = 'CANCELADO_CLIENTE') cancelados_cliente,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('solicitadoEm', 'acionadoEm')}) FILTER (WHERE ${VALIDO('solicitadoEm', 'acionadoEm', 24)}) acionamento_med,
      avg(${MIN('solicitadoEm', 'acionadoEm')}) FILTER (WHERE ${VALIDO('solicitadoEm', 'acionadoEm', 24)}) acionamento_media,
      count(*) FILTER (WHERE ${VALIDO('solicitadoEm', 'acionadoEm', 24)}) com_acionamento,
      count(*) FILTER (WHERE ${VALIDO('solicitadoEm', 'acionadoEm', 24)} AND a."acionadoEm" - a."solicitadoEm" > interval '30 minutes') acionamento_lento,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('solicitadoEm', 'chegadaEm')}) FILTER (WHERE ${VALIDO('solicitadoEm', 'chegadaEm', 24)}) resposta_med,
      count(*) FILTER (WHERE ${VALIDO('solicitadoEm', 'chegadaEm', 24)}) com_resposta,
      count(*) FILTER (WHERE ${VALIDO('solicitadoEm', 'chegadaEm', 24)} AND a."chegadaEm" - a."solicitadoEm" > interval '60 minutes') resposta_lenta,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('acionadoEm', 'chegadaEm')}) FILTER (WHERE ${VALIDO('acionadoEm', 'chegadaEm', 24)}) chegada_med,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('chegadaEm', 'concluidoEm')}) FILTER (WHERE ${VALIDO('chegadaEm', 'concluidoEm', 48)}) local_med,
      count(DISTINCT date_trunc('day', a."createdAt")) dias_ativos,
      count(DISTINCT a."clientId") clientes,
      min(a."createdAt") primeiro, max(a."createdAt") ultimo`;
  }

  private linha(r: Record<string, unknown>) {
    const total = Number(r.total);
    const pct = (x: unknown) => (total ? (Number(x) / total) * 100 : 0);
    return {
      total, concluidos: Number(r.concluidos), naoAtendidos: Number(r.nao_atendidos), abertos: Number(r.abertos),
      negativas: Number(r.negativas), demoras: Number(r.demoras), canceladosCliente: Number(r.cancelados_cliente),
      taxaConclusao: pct(r.concluidos), taxaNaoAtendimento: pct(r.nao_atendidos),
      acionamentoMedianaMin: n(r.acionamento_med), acionamentoMediaMin: n(r.acionamento_media),
      comAcionamento: Number(r.com_acionamento),
      pctAcionamentoLento: Number(r.com_acionamento) ? (Number(r.acionamento_lento) / Number(r.com_acionamento)) * 100 : null,
      chegadaMedianaMin: n(r.chegada_med), localMedianaMin: n(r.local_med),
      respostaMedianaMin: n(r.resposta_med), comResposta: Number(r.com_resposta),
      pctRespostaLenta: Number(r.com_resposta) ? (Number(r.resposta_lenta) / Number(r.com_resposta)) * 100 : null,
      diasAtivos: Number(r.dias_ativos), clientes: Number(r.clientes),
      mediaPorDia: Number(r.dias_ativos) ? total / Number(r.dias_ativos) : 0,
      primeiro: r.primeiro, ultimo: r.ultimo,
    };
  }

  async ranking(f: FiltroEquipeDto, u: UsuarioLogado) {
    const where = this.filtro(f, u);
    const [linhas, [equipe]] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT a."operadorPR7" nome, ${this.metricas()} FROM "Atendimento" a WHERE ${where}
        GROUP BY 1 ORDER BY count(*) DESC`),
      this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT ${this.metricas()} FROM "Atendimento" a WHERE ${where}`),
    ]);
    const time = this.linha(equipe ?? {});
    // "Por dia" da equipe soma todo mundo; para comparar pessoa com pessoa usa a mediana individual
    // Quem saiu da equipe não entra na comparação (mediana) nem no ranking
    const saiu = (nome: unknown) => String(nome) in FORA_DA_EQUIPE;
    const volumes = linhas.filter((r) => !saiu(r.nome)).map((r) => this.linha(r)).filter((m) => m.total >= 20).map((m) => m.mediaPorDia).sort((a, b) => a - b);
    const volumeTipico = volumes.length ? volumes[Math.floor(volumes.length / 2)] : null;
    const operadores = linhas.map((r) => {
      const m = this.linha(r);
      const nomeIncompleto = String(r.nome).trim().split(/\s+/).length < 2;
      if (saiu(r.nome)) return { nome: String(r.nome), ...m, nomeIncompleto, foraDaEquipe: true, alertas: [], feedback: [] };
      return { nome: String(r.nome), ...m, nomeIncompleto, foraDaEquipe: false, alertas: this.alertas(m, time), feedback: feedbackAtendimento(m, time, nomeIncompleto, volumeTipico) };
    });
    // Equipe atual primeiro (com posição); quem saiu vai para o fim, só como histórico
    return { equipe: time, operadores: [...operadores.filter((o) => !o.foraDaEquipe), ...operadores.filter((o) => o.foraDaEquipe)] };
  }

  /** Destaques e alertas comparando o operador com a média da equipe no mesmo período. */
  private alertas(m: ReturnType<EquipeService['linha']>, t: ReturnType<EquipeService['linha']>) {
    const a: { tipo: 'bom' | 'atencao' | 'critico'; texto: string }[] = [];
    if (m.total < 20) return [{ tipo: 'atencao' as const, texto: 'Poucos atendimentos no período para comparar' }];
    const rel = (x: number | null, y: number | null) => (x !== null && y !== null && y > 0 ? x / y : null);
    // Acionamento quando há dados suficientes; senão, tempo de resposta (pedido → chegada)
    const usaAcion = m.comAcionamento >= 10 && t.comAcionamento >= 30 && (m.acionamentoMedianaMin ?? 0) > 0 && (t.acionamentoMedianaMin ?? 0) > 0;
    const tempo = usaAcion ? rel(m.acionamentoMedianaMin, t.acionamentoMedianaMin) : rel(m.respostaMedianaMin, t.respostaMedianaMin);
    const oque = usaAcion ? 'Aciona o prestador' : 'Tempo de resposta';
    if (tempo !== null && tempo >= 1.4) a.push({ tipo: 'critico', texto: `${oque} ${Math.round((tempo - 1) * 100)}% mais lento que a equipe` });
    else if (tempo !== null && tempo >= 1.15) a.push({ tipo: 'atencao', texto: `${oque} ${Math.round((tempo - 1) * 100)}% acima da equipe` });
    else if (tempo !== null && tempo <= 0.85) a.push({ tipo: 'bom', texto: `${oque} ${Math.round((1 - tempo) * 100)}% mais rápido que a equipe` });
    const nao = rel(m.taxaNaoAtendimento, t.taxaNaoAtendimento);
    if (m.naoAtendidos >= 3 && nao !== null && nao >= 1.5) a.push({ tipo: 'critico', texto: `Não atendimento ${m.taxaNaoAtendimento.toFixed(1)}% (equipe ${t.taxaNaoAtendimento.toFixed(1)}%)` });
    if (m.demoras >= 2) a.push({ tipo: 'atencao', texto: `${m.demoras} chamados perdidos por demora` });
    if (m.negativas >= 3) a.push({ tipo: 'atencao', texto: `${m.negativas} negativas de prestador — rever a escolha de quem acionar` });
    if (m.pctRespostaLenta !== null && t.pctRespostaLenta !== null && m.comResposta >= 20 && m.pctRespostaLenta > t.pctRespostaLenta + 8) {
      a.push({ tipo: 'atencao', texto: `${m.pctRespostaLenta.toFixed(0)}% das chegadas passaram de 1 hora (equipe ${t.pctRespostaLenta.toFixed(0)}%)` });
    }
    if (m.mediaPorDia >= t.mediaPorDia * 1.3) a.push({ tipo: 'bom', texto: `Volume alto: ${m.mediaPorDia.toFixed(1)} atendimentos/dia` });
    if (!a.length) a.push({ tipo: 'bom', texto: 'Dentro da média da equipe' });
    return a;
  }

  async perfil(f: FiltroEquipeDto, u: UsuarioLogado) {
    if (!f.nome) throw new NotFoundException('Informe o operador');
    const where = Prisma.sql`${this.filtro(f, u)} AND a."operadorPR7" = ${f.nome}`;
    const q = <T>(sql: Prisma.Sql) => this.prisma.$queryRaw<T[]>(sql);
    const [resumo, mensal, turnos, motivos, servicos, cidades, prestadores, ranking] = await Promise.all([
      q<Record<string, unknown>>(Prisma.sql`SELECT ${this.metricas()} FROM "Atendimento" a WHERE ${where}`),
      q<Record<string, unknown>>(Prisma.sql`
        SELECT to_char(date_trunc('month', a."createdAt"), 'YYYY-MM') mes, count(*) total,
               count(*) FILTER (WHERE a.status IN ('CANCELADO','NAO_ATENDIDO')) nao_atendidos,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('solicitadoEm', 'chegadaEm')}) FILTER (WHERE ${VALIDO('solicitadoEm', 'chegadaEm', 24)}) resposta_med
        FROM "Atendimento" a WHERE ${where} GROUP BY 1 ORDER BY 1`),
      // Turno pelo horário do pedido (hora de parede, como veio da origem)
      q<Record<string, unknown>>(Prisma.sql`
        SELECT extract(hour FROM a."solicitadoEm")::int hora, count(*) total,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('solicitadoEm', 'chegadaEm')}) FILTER (WHERE ${VALIDO('solicitadoEm', 'chegadaEm', 24)}) resposta_med
        FROM "Atendimento" a WHERE ${where} AND a."solicitadoEm" IS NOT NULL GROUP BY 1 ORDER BY 1`),
      q<Record<string, unknown>>(Prisma.sql`
        SELECT a."motivoNaoAtendimento"::text motivo, count(*) q FROM "Atendimento" a
        WHERE ${where} AND a."motivoNaoAtendimento" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
      q<Record<string, unknown>>(Prisma.sql`SELECT coalesce(a.category,'—') nome, count(*) q FROM "Atendimento" a WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
      q<Record<string, unknown>>(Prisma.sql`
        SELECT min(coalesce(ct.cidade, a.detalhes->>'cidade')) nome, upper(coalesce(ct.estado, a.detalhes->>'estado')) uf, count(*) q
        FROM "Atendimento" a LEFT JOIN "Conta" ct ON ct.id = a."contaId" WHERE ${where}
        GROUP BY lower(coalesce(ct.cidade, a.detalhes->>'cidade')), 2 ORDER BY 3 DESC LIMIT 6`),
      q<Record<string, unknown>>(Prisma.sql`
        SELECT p.name nome, count(*) q, percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('acionadoEm', 'chegadaEm')}) FILTER (WHERE ${VALIDO('acionadoEm', 'chegadaEm', 24)}) chegada_med
        FROM "Atendimento" a JOIN "Provider" p ON p.id = a."providerId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
      this.ranking(f, u),
    ]);
    const op = ranking.operadores.find((o) => o.nome === f.nome);
    if (!op) throw new NotFoundException('Help Desk sem atendimentos no período');
    const posicao = (campo: 'total' | 'respostaMedianaMin' | 'taxaNaoAtendimento', menorMelhor: boolean) => {
      const validos = ranking.operadores.filter((o) => o.total >= 20 && o[campo] !== null);
      const ordenados = [...validos].sort((x, y) => (menorMelhor ? 1 : -1) * ((x[campo] as number) - (y[campo] as number)));
      const i = ordenados.findIndex((o) => o.nome === f.nome);
      return i < 0 ? null : { posicao: i + 1, de: ordenados.length };
    };
    const cont = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, q: Number(r.q), chegada_med: n(r.chegada_med) }));
    const tr = turnos.map((t) => ({ hora: Number(t.hora), total: Number(t.total), respostaMedianaMin: n(t.resposta_med) }));
    const turnoLento = tr.filter((x) => x.total >= 10 && x.respostaMedianaMin !== null).sort((a, b) => b.respostaMedianaMin! - a.respostaMedianaMin!)[0];
    const feedback = [...op.feedback];
    if (turnoLento && ranking.equipe.respostaMedianaMin && turnoLento.respostaMedianaMin! > ranking.equipe.respostaMedianaMin * 1.4) {
      feedback.splice(Math.max(0, feedback.length - 1), 0, {
        tipo: 'melhorar' as const,
        texto: `Por volta das ${turnoLento.hora}h a resposta fica mais lenta (${Math.round(turnoLento.respostaMedianaMin!)} min). Vale deixar prestadores dessa faixa de horário já confirmados antes.`,
      });
    }
    return {
      nome: f.nome,
      feedback,
      resumo: this.linha(resumo[0] ?? {}),
      equipe: ranking.equipe,
      alertas: op.alertas,
      nomeIncompleto: op.nomeIncompleto,
      posicoes: {
        volume: posicao('total', false),
        resposta: posicao('respostaMedianaMin', true),
        naoAtendimento: posicao('taxaNaoAtendimento', true),
      },
      mensal: mensal.map((m) => ({ mes: m.mes, total: Number(m.total), naoAtendidos: Number(m.nao_atendidos), respostaMedianaMin: n(m.resposta_med) })),
      turnos: turnos.map((t) => ({ hora: Number(t.hora), total: Number(t.total), respostaMedianaMin: n(t.resposta_med) })),
      motivos: cont(motivos), servicos: cont(servicos), cidades: cont(cidades), prestadores: cont(prestadores),
    };
  }
}

/**
 * Monitoramento: quem assumiu cada evento. Assumir rápido é o que mais pesa — o
 * evento de telemetria (painel violado, bateria) perde valor a cada minuto.
 */
async function desempenhoMonitoramento(prisma: PrismaService, de?: string, ate?: string) {
  const c: Prisma.Sql[] = [Prisma.sql`e.vertical = 'VEICULAR'`];
  if (de) c.push(Prisma.sql`e."recebidoEm" >= ${new Date(de)}`);
  if (ate) c.push(Prisma.sql`e."recebidoEm" < ${new Date(ate)}`);
  const where = Prisma.join(c, ' AND ');
  const metricas = Prisma.sql`
    count(*) total,
    count(*) FILTER (WHERE e.status = 'ENCERRADO') encerrados,
    count(*) FILTER (WHERE e.status = 'ENCERRADO' AND e.desfecho IS NULL) sem_desfecho,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (e."assumidoEm" - e."recebidoEm")) / 60)
      FILTER (WHERE e."assumidoEm" >= e."recebidoEm") assumir_med,
    count(*) FILTER (WHERE e."assumidoEm" - e."recebidoEm" > interval '5 minutes') assumir_lento,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (e."encerradoEm" - e."assumidoEm")) / 60)
      FILTER (WHERE e."encerradoEm" >= e."assumidoEm") tratar_med,
    sum((SELECT count(*) FROM "EventoTratativa" t WHERE t."eventoId" = e.id AND t.tipo <> 'SISTEMA')) anotacoes`;
  const [linhas, [time], [fila]] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT coalesce(min(u.nome), e."assumidoPor") nome, e."assumidoPor" email, ${metricas}
        FROM "Evento" e LEFT JOIN "AdminUser" u ON u.email = e."assumidoPor"
       WHERE ${where} AND e."assumidoPor" IS NOT NULL GROUP BY e."assumidoPor" ORDER BY count(*) DESC`),
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT ${metricas} FROM "Evento" e WHERE ${where} AND e."assumidoPor" IS NOT NULL`),
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT count(*) total, count(*) FILTER (WHERE e."assumidoPor" IS NULL) sem_dono,
             count(*) FILTER (WHERE e.status = 'NOVO') aguardando FROM "Evento" e WHERE ${where}`),
  ]);
  const linha = (r: Record<string, unknown> = {}) => {
    const total = Number(r.total ?? 0);
    return {
      total, encerrados: Number(r.encerrados ?? 0), semDesfecho: Number(r.sem_desfecho ?? 0),
      assumirMedianaMin: n(r.assumir_med), pctAssumirLento: total ? (Number(r.assumir_lento ?? 0) / total) * 100 : null,
      tratarMedianaMin: n(r.tratar_med), anotacoes: Number(r.anotacoes ?? 0),
      anotacoesPorEvento: total ? Number(r.anotacoes ?? 0) / total : 0,
    };
  };
  const equipe = linha(time);
  return {
    equipe,
    fila: { total: Number(fila?.total ?? 0), semDono: Number(fila?.sem_dono ?? 0), aguardando: Number(fila?.aguardando ?? 0) },
    operadores: linhas.map((r) => {
      const m = linha(r);
      return { nome: String(r.nome), email: String(r.email), ...m, feedback: feedbackMonitoramento(m, equipe) };
    }),
  };
}

type Feedback = { tipo: 'forte' | 'melhorar'; texto: string };

/**
 * Feedback de desenvolvimento para cada Help Desk.
 *
 * A equipe é parecida entre si, então um corte fixo ("15% pior") deixaria todo mundo
 * com "dentro da média". Em vez disso, cada pessoa é comparada com a equipe em cada
 * ponto que depende dela e recebe:
 *  - "pode melhorar": os 2 pontos em que está mais atrás, com a meta em número;
 *  - "ponto forte": o ponto em que está mais à frente.
 * Regras fixas, sem IA — o mesmo dado gera sempre o mesmo feedback.
 */
export function feedbackAtendimento(
  m: { total: number; respostaMedianaMin: number | null; acionamentoMedianaMin: number | null; comAcionamento: number; pctRespostaLenta: number | null; comResposta: number;
       taxaNaoAtendimento: number; naoAtendidos: number; negativas: number; demoras: number; abertos: number; taxaConclusao: number; mediaPorDia: number },
  t: { respostaMedianaMin: number | null; acionamentoMedianaMin: number | null; pctRespostaLenta: number | null; taxaNaoAtendimento: number; taxaConclusao: number },
  nomeIncompleto = false,
  volumeTipicoPorDia: number | null = null,
): Feedback[] {
  const r = (x: number) => Math.round(x);
  if (m.total < 20) return [{ tipo: 'melhorar', texto: 'Ainda são poucos atendimentos no período para uma avaliação justa — o feedback fica mais preciso com mais chamados.' }];

  // gravidade > 0 = atrás da equipe (quanto maior, mais prioritário); < 0 = à frente
  const itens: { gravidade: number; melhorar: string; forte?: string }[] = [];

  if (m.acionamentoMedianaMin !== null && t.acionamentoMedianaMin && m.comAcionamento >= 5) {
    const g = m.acionamentoMedianaMin / t.acionamentoMedianaMin - 1;
    itens.push({
      gravidade: g * 1.2,
      melhorar: `Acionar o prestador mais cedo: hoje leva ${r(m.acionamentoMedianaMin)} min do pedido ao acionamento (equipe ${r(t.acionamentoMedianaMin)} min). Deixar à mão a lista dos prestadores de cada região ajuda a ganhar esses minutos.`,
      forte: `Aciona o prestador rápido: ${r(m.acionamentoMedianaMin)} min do pedido ao acionamento (equipe ${r(t.acionamentoMedianaMin)} min).`,
    });
  }
  if (m.respostaMedianaMin !== null && t.respostaMedianaMin) {
    const g = m.respostaMedianaMin / t.respostaMedianaMin - 1;
    itens.push({
      gravidade: g,
      melhorar: `Baixar o tempo até o prestador chegar: ${r(m.respostaMedianaMin)} min (equipe ${r(t.respostaMedianaMin)} min). Meta: ${r(Math.min(m.respostaMedianaMin - 1, t.respostaMedianaMin))} min — acionar o prestador mais próximo já no primeiro contato.`,
      forte: `Resposta rápida: o prestador chega em ${r(m.respostaMedianaMin)} min (equipe ${r(t.respostaMedianaMin)} min).`,
    });
  }
  if (m.pctRespostaLenta !== null && t.pctRespostaLenta !== null && m.comResposta >= 20 && t.pctRespostaLenta > 0) {
    const g = (m.pctRespostaLenta - t.pctRespostaLenta) / Math.max(t.pctRespostaLenta, 5);
    itens.push({
      gravidade: g,
      melhorar: `${r(m.pctRespostaLenta)}% das chegadas passaram de 1 hora (equipe ${r(t.pctRespostaLenta)}%). Quando o prestador passar de 40 min sem chegar, cobrar a posição ou acionar um segundo.`,
      forte: `Poucos atrasos: só ${r(m.pctRespostaLenta)}% das chegadas passaram de 1 hora (equipe ${r(t.pctRespostaLenta)}%).`,
    });
  }
  if (volumeTipicoPorDia) {
    const g = (volumeTipicoPorDia - m.mediaPorDia) / volumeTipicoPorDia;
    itens.push({
      gravidade: g * 0.6, // volume depende também da escala; pesa menos
      melhorar: `Volume de ${m.mediaPorDia.toFixed(1)} atendimentos por dia trabalhado (o típico da equipe é ${volumeTipicoPorDia.toFixed(1)}). Registrar cada chamado no sistema na hora ajuda a não perder nenhum.`,
      forte: `Volume alto: ${m.mediaPorDia.toFixed(1)} atendimentos por dia trabalhado (típico da equipe ${volumeTipicoPorDia.toFixed(1)}).`,
    });
  }
  // Sinais fortes: sempre viram ação quando existem
  if (m.naoAtendidos >= 3 && m.taxaNaoAtendimento > t.taxaNaoAtendimento * 1.5) {
    itens.push({ gravidade: 2, melhorar: `Não atendimento de ${m.taxaNaoAtendimento.toFixed(1)}% (equipe ${t.taxaNaoAtendimento.toFixed(1)}%). Antes de encerrar como não atendido, tentar um segundo prestador.` });
  }
  if (m.demoras >= 2) itens.push({ gravidade: 1.5, melhorar: `${m.demoras} chamados perdidos porque o cliente desistiu pela demora. Avisar o cliente do tempo estimado segura o chamado.` });
  if (m.negativas >= 3) itens.push({ gravidade: 1.2, melhorar: `${m.negativas} negativas de prestador. Priorizar quem costuma aceitar na região evita perder tempo.` });
  if (m.abertos >= 1) {
    itens.push({ gravidade: 0.3 + Math.min(m.abertos, 20) / 20, melhorar: `${m.abertos} chamado(s) ainda em aberto. Fechar com o retorno do prestador no mesmo dia deixa o fechamento e o pagamento em dia.` });
  }
  if (nomeIncompleto) itens.push({ gravidade: 0.8, melhorar: 'Registrar o nome completo no campo Help Desk — com nome incompleto os números ficam divididos em mais de uma pessoa.' });

  const ordem = [...itens].sort((a, b) => b.gravidade - a.gravidade);
  const atras = ordem.filter((i) => i.gravidade > 0.03).slice(0, 2);
  const melhorar: Feedback[] = atras.map((i) => ({ tipo: 'melhorar', texto: i.melhorar }));
  if (!melhorar.length && ordem.length) {
    // Tudo no nível da equipe ou acima: sugere o ponto menos forte como próximo degrau
    melhorar.push({ tipo: 'melhorar', texto: `Pequeno ajuste para ir além: ${ordem[0].melhorar.charAt(0).toLowerCase()}${ordem[0].melhorar.slice(1)}` });
  }
  const melhorPonto = [...itens].filter((i) => i.forte && i.gravidade < -0.03).sort((a, b) => a.gravidade - b.gravidade)[0];
  const forte: Feedback = melhorPonto
    ? { tipo: 'forte', texto: melhorPonto.forte! }
    : m.naoAtendidos <= 1 && m.total >= 50
      ? { tipo: 'forte', texto: 'Quase nenhum chamado fica sem atendimento — ótima persistência.' }
      : { tipo: 'forte', texto: `Mantém a operação andando: ${m.total} atendimentos no período.` };
  return [...melhorar, forte];
}

export function feedbackMonitoramento(
  m: { total: number; semDesfecho: number; assumirMedianaMin: number | null; tratarMedianaMin: number | null; anotacoesPorEvento: number; encerrados: number },
  t: { tratarMedianaMin: number | null; anotacoesPorEvento: number },
): Feedback[] {
  const melhorar: Feedback[] = [], fortes: Feedback[] = [];
  if (m.total < 5) return [{ tipo: 'melhorar', texto: 'Poucos eventos tratados no período para avaliar — o feedback aparece com mais eventos.' }];
  if (m.assumirMedianaMin !== null && m.assumirMedianaMin > 5) {
    melhorar.push({ tipo: 'melhorar', texto: `Assumir o evento mais cedo: leva ${Math.round(m.assumirMedianaMin)} min. Painel violado ou bateria precisa ser assumido em até 5 min.` });
  } else if (m.assumirMedianaMin !== null) {
    fortes.push({ tipo: 'forte', texto: `Assume rápido: ${Math.round(m.assumirMedianaMin)} min.` });
  }
  if (m.semDesfecho > 0) melhorar.push({ tipo: 'melhorar', texto: `${m.semDesfecho} evento(s) encerrado(s) sem desfecho. Registrar o desfecho mostra ao cliente o que foi feito.` });
  if (m.anotacoesPorEvento < 1) {
    melhorar.push({ tipo: 'melhorar', texto: 'Anotar a tratativa (contato com o cliente, acionamento) em cada evento — hoje há menos de uma anotação por evento.' });
  } else if (m.anotacoesPorEvento >= Math.max(2, t.anotacoesPorEvento)) {
    fortes.push({ tipo: 'forte', texto: 'Tratativas bem documentadas.' });
  }
  if (m.tratarMedianaMin !== null && t.tratarMedianaMin && m.tratarMedianaMin > t.tratarMedianaMin * 1.4) {
    melhorar.push({ tipo: 'melhorar', texto: `Encerrar o evento assim que resolvido: ${Math.round(m.tratarMedianaMin)} min contra ${Math.round(t.tratarMedianaMin)} min da equipe.` });
  }
  if (!melhorar.length) melhorar.push({ tipo: 'melhorar', texto: 'Tratativa dentro do esperado. Próximo passo: ajudar quem está chegando no monitoramento.' });
  if (!fortes.length) fortes.push({ tipo: 'forte', texto: `${m.encerrados} eventos encerrados no período.` });
  return [...melhorar.slice(0, 3), fortes[0]];
}

@Protegido('equipe')
@Controller('equipe')
class EquipeController {
  constructor(private readonly equipe: EquipeService, private readonly prisma: PrismaService) {}

  @Get('operadores')
  ranking(@Query() f: FiltroEquipeDto, @Req() req: { user: UsuarioLogado }) {
    return this.equipe.ranking(f, req.user);
  }

  @Get('monitoramento')
  monitoramento(@Query() f: FiltroEquipeDto) {
    return desempenhoMonitoramento(this.prisma, f.de, f.ate);
  }

  @Get('perfil')
  perfil(@Query() f: FiltroEquipeDto, @Req() req: { user: UsuarioLogado }) {
    return this.equipe.perfil(f, req.user);
  }
}

@Module({ controllers: [EquipeController], providers: [EquipeService] })
export class EquipeModule {}
