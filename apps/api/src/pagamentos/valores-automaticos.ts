import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { calcularValorPrestador } from './precos';
import { ConfigTbg, ehPontoTbg, valorAcordadoTbg } from './tbg';

/**
 * Preenche o valor ao prestador dos chamados concluídos que chegaram sem valor
 * (os do WhatsApp — ninguém escreve o preço no grupo). Regras em ./precos.ts.
 *
 * - Só chamados sem valor e sem ajuste manual (detalhes.valorManual): valor editado
 *   pela operação nunca é recalculado.
 * - A conta fica guardada em detalhes.valorCalculado (regra, memória e o que conferir).
 * - Sem regra (antenista, acompanhamento) ou faltando dado: não grava valor; fica
 *   registrado o que falta.
 */
export async function preencherValores(prisma: PrismaService, desde = new Date(Date.now() - 60 * 864e5)) {
  const alvos = await prisma.atendimento.findMany({
    // Só chamados vindos do WhatsApp: linha da planilha sem valor é histórico e fica como veio
    where: { status: 'CONCLUIDO', valorPrestador: null, conversationId: { not: null }, OR: [{ solicitadoEm: { gte: desde } }, { solicitadoEm: null, createdAt: { gte: desde } }] },
    select: {
      id: true, vertical: true, category: true, providerId: true, chegadaEm: true, concluidoEm: true, solicitadoEm: true, detalhes: true, summary: true,
      client: { select: { name: true } }, empresa: { select: { nomeFantasia: true, razaoSocial: true } },
      conta: { select: { estabelecimento: true } },
      provider: { select: { name: true, apelido: true, phone: true } },
    },
  });
  // Tabela de valores acordados dos apoios TBG (config importada da planilha)
  let cfgTbg: ConfigTbg | null = null;
  try {
    const c = await prisma.configSistema.findUnique({ where: { chave: 'tbg_apoios' } });
    if (c) cfgTbg = JSON.parse(c.valor) as ConfigTbg;
  } catch { cfgTbg = null; }
  let preenchidos = 0, pendentes = 0;
  for (const a of alvos) {
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    if (det.valorManual) continue;
    // Taxa de preservação que o prestador costuma receber (entre R$ 25 e R$ 30)
    let taxa: number | null = null;
    if (a.providerId && /preserva/i.test(a.category ?? '')) {
      const [t] = await prisma.$queryRaw<{ taxa: number | null }[]>`
        SELECT mode() WITHIN GROUP (ORDER BY "valorPrestador")::float taxa FROM "Atendimento"
         WHERE "providerId" = ${a.providerId} AND category ILIKE '%preserva%' AND "valorPrestador" BETWEEN 25 AND 30`;
      taxa = t?.taxa ?? null;
    }
    const cliente = a.empresa?.nomeFantasia || a.empresa?.razaoSocial || a.client?.name;
    let c = calcularValorPrestador({ ...a, clienteNome: cliente, detalhes: det }, taxa);
    // Ponto TBG + apoio com valor acordado: esse valor prevalece sobre o cálculo padrão.
    if (ehPontoTbg(a.conta?.estabelecimento, a.summary, cliente) && a.provider) {
      const tbg = valorAcordadoTbg(cfgTbg, a.provider);
      if (tbg) c = { valor: tbg.valor, regra: 'TBG (valor acordado do apoio)', memoria: `R$ ${tbg.valor} acordado com ${tbg.apoio.nome} para ${tbg.apoio.ponto || 'ponto TBG'}${/enviar|verificar/i.test(tbg.apoio.camisa) ? ' · camiseta branca pendente' : ''}`, conferir: [] };
    }
    const valorCalculado = { valor: c.valor, regra: c.regra, memoria: c.memoria, conferir: c.conferir, em: new Date().toISOString() };
    await prisma.atendimento.update({
      where: { id: a.id },
      data: {
        ...(c.valor !== null ? { valorPrestador: new Prisma.Decimal(c.valor.toFixed(2)) } : {}),
        detalhes: { ...det, valorCalculado } as Prisma.InputJsonValue,
      },
    });
    if (c.valor !== null) preenchidos++; else pendentes++;
  }
  return { preenchidos, pendentes };
}

@Injectable()
export class ValoresAutomaticosService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Valores');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.VALORES_AUTOMATICOS === 'off') return;
    const rodar = () => preencherValores(this.prisma)
      .then((r) => { if (r.preenchidos || r.pendentes) this.logger.log(`Valores: ${r.preenchidos} calculados · ${r.pendentes} sem regra/dado`); })
      .catch((e) => this.logger.error(`Valores: ${(e as Error).message}`));
    setTimeout(rodar, 120_000);
    this.timer = setInterval(rodar, 10 * 60_000);
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
}
