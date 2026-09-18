import { ValoresAutomaticosService } from './valores-automaticos';
import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { resolve } from 'path';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { fechamentoDoPeriodo, prazoDePagamento, Regime, REGIMES, rotuloDoPeriodo } from './fechamento';

export const PASTA_COMPROVANTES = resolve(__dirname, '..', '..', '..', '..', '..', 'storage', 'comprovantes');

/**
 * Pagamentos aos prestadores. O comprovante postado no grupo é a prova do
 * pagamento; o que está concluído e sem comprovante é o que a operação ainda deve.
 */
@Injectable()
export class PagamentosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Visão geral: quanto já foi pago, por mês e por regime, e o que está em aberto. */
  async resumo(u: UsuarioLogado) {
    const verticais = verticaisPermitidas(u);
    const [total, porRegime, mensal, aberto] = await Promise.all([
      this.prisma.pagamento.aggregate({ _sum: { valor: true }, _count: true }),
      this.prisma.pagamento.groupBy({ by: ['regime'], _sum: { valor: true }, _count: true }),
      this.prisma.$queryRawUnsafe<{ mes: string; qtd: number; valor: number }[]>(
        `select to_char(date_trunc('month', "pagoEm"), 'YYYY-MM') mes, count(*)::int qtd, coalesce(sum(valor),0)::float valor
           from "Pagamento" where "pagoEm" is not null group by 1 order by 1 desc limit 24`,
      ),
      this.prisma.atendimento.aggregate({
        where: { status: 'CONCLUIDO', pagoEm: null, vertical: { in: verticais } },
        _sum: { valorPrestador: true }, _count: true,
      }),
    ]);
    return {
      agora: new Date().toISOString(),
      pago: { quantidade: total._count, valor: Number(total._sum.valor ?? 0) },
      emAberto: { quantidade: aberto._count, valor: Number(aberto._sum.valorPrestador ?? 0) },
      porRegime: porRegime.map((r) => ({ regime: r.regime ?? 'NÃO INFORMADO', quantidade: r._count, valor: Number(r._sum.valor ?? 0) })),
      mensal: mensal.reverse(),
      fechamentos: REGIMES.map((regime) => {
        const agora = new Date();
        return {
          regime,
          periodo: rotuloDoPeriodo(regime, agora),
          fecha: fechamentoDoPeriodo(regime, agora).toISOString(),
          pagarAte: prazoDePagamento(regime, agora).toISOString(),
        };
      }),
    };
  }

  /** Comprovantes registrados (busca por prestador, região, cliente ou ID citado). */
  async lista(busca?: string, de?: string, ate?: string) {
    const b = busca?.trim();
    const where: Prisma.PagamentoWhereInput = {
      ...(b ? {
        OR: [
          { prestadorNome: { contains: b, mode: 'insensitive' } },
          { regiao: { contains: b, mode: 'insensitive' } },
          { cliente: { contains: b, mode: 'insensitive' } },
          { itens: { some: { idPR7: b.replace(/\D/g, '') || '—' } } },
        ],
      } : {}),
      ...(de || ate ? { pagoEm: { ...(de ? { gte: new Date(de) } : {}), ...(ate ? { lte: new Date(ate) } : {}) } } : {}),
    };
    const itens = await this.prisma.pagamento.findMany({
      where, orderBy: { pagoEm: 'desc' }, take: 300,
      select: {
        id: true, prestadorNome: true, regiao: true, cidade: true, cliente: true, valor: true, regime: true,
        pagoEm: true, recebidoEm: true, arquivo: true, providerId: true,
        _count: { select: { itens: true } },
        itens: { select: { idPR7: true, atendimentoId: true }, take: 10 },
      },
    });
    return { agora: new Date().toISOString(), itens };
  }

  /**
   * O que ainda não foi pago: atendimento concluído sem comprovante, agrupado por
   * prestador, com o período e o prazo (5 dias úteis após o fechamento).
   */
  async pendentes(u: UsuarioLogado, regimePadrao: Regime = 'QUINZENAL') {
    const atendimentos = await this.prisma.atendimento.findMany({
      where: { status: 'CONCLUIDO', pagoEm: null, vertical: { in: verticaisPermitidas(u) } },
      orderBy: { concluidoEm: 'desc' },
      take: 2000,
      select: {
        id: true, idPR7: true, category: true, concluidoEm: true, solicitadoEm: true, valorPrestador: true, agenteNome: true,
        formaPagamento: true,
        // O regime é do prestador (coluna "Pagamento" da planilha)
        provider: { select: { id: true, name: true, regimePagamento: true } },
        conta: { select: { estabelecimento: true, cidade: true, estado: true } },
        client: { select: { name: true } },
      },
    });
    const grupos = new Map<string, { prestador: string; providerId: string | null; regime: Regime; periodo: string; pagarAte: string; quantidade: number; valor: number; atendimentos: typeof atendimentos }>();
    const comoRegime = (t?: string | null): Regime | null => {
      const x = (t ?? '').toUpperCase();
      return (REGIMES as string[]).includes(x) ? (x as Regime) : null;
    };
    for (const a of atendimentos) {
      const quando = a.concluidoEm ?? a.solicitadoEm ?? new Date();
      // Cada prestador fecha no regime dele; sem regime cadastrado, usa o do filtro
      const regime = comoRegime(a.provider?.regimePagamento) ?? comoRegime(a.formaPagamento) ?? regimePadrao;
      const periodo = rotuloDoPeriodo(regime, quando);
      const prestador = a.provider?.name ?? a.agenteNome ?? 'Sem prestador definido';
      const chave = `${prestador}|${periodo}`;
      const g = grupos.get(chave) ?? {
        prestador, providerId: a.provider?.id ?? null, regime, periodo,
        pagarAte: prazoDePagamento(regime, quando).toISOString(), quantidade: 0, valor: 0, atendimentos: [],
      };
      g.quantidade++;
      g.valor += Number(a.valorPrestador ?? 0);
      g.atendimentos.push(a);
      grupos.set(chave, g);
    }
    const agora = Date.now();
    const comAtraso = [...grupos.values()].map((g) => {
      const dias = Math.floor((agora - +new Date(g.pagarAte)) / 864e5);
      return { ...g, diasAtraso: dias > 0 ? dias : 0, atrasado: dias > 0 };
    });
    const itens = comAtraso.sort((x, y) => Number(y.atrasado) - Number(x.atrasado) || y.diasAtraso - x.diasAtraso || y.valor - x.valor);
    const atrasados = itens.filter((g) => g.atrasado);
    return {
      agora: new Date().toISOString(), regimePadrao,
      total: { quantidade: atendimentos.length, valor: itens.reduce((s, g) => s + g.valor, 0) },
      // O que já passou do prazo (5 dias úteis após o fechamento)
      emAtraso: {
        grupos: atrasados.length,
        quantidade: atrasados.reduce((s, g) => s + g.quantidade, 0),
        valor: atrasados.reduce((s, g) => s + g.valor, 0),
        maiorAtraso: atrasados.reduce((max, g) => Math.max(max, g.diasAtraso), 0),
      },
      itens,
    };
  }

  async detalhe(id: string) {
    const p = await this.prisma.pagamento.findUnique({
      where: { id },
      include: {
        itens: {
          select: {
            idPR7: true, valor: true,
            atendimento: {
              select: {
                id: true, category: true, status: true, solicitadoEm: true, concluidoEm: true, agenteNome: true, valorPrestador: true,
                client: { select: { name: true } }, conta: { select: { estabelecimento: true, cidade: true, estado: true } },
              },
            },
          },
        },
        provider: { select: { id: true, name: true, phone: true, cidadeBase: true, estadoBase: true } },
      },
    });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    return p;
  }
}

@Protegido('pagamentos')
@Controller('pagamentos')
export class PagamentosController {
  constructor(private readonly pagamentos: PagamentosService) {}

  @Get('resumo')
  resumo(@Req() req: { user: UsuarioLogado }) {
    return this.pagamentos.resumo(req.user);
  }

  @Get('pendentes')
  pendentes(@Req() req: { user: UsuarioLogado }, @Query('regime') regime?: string) {
    const r = (REGIMES as string[]).includes(regime ?? '') ? (regime as Regime) : 'QUINZENAL';
    return this.pagamentos.pendentes(req.user, r);
  }

  @Get('comprovante/:id')
  async comprovante(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const p = await this.pagamentos.detalhe(id);
    if (!p.arquivo) throw new NotFoundException('Comprovante sem arquivo');
    const caminho = resolve(PASTA_COMPROVANTES, p.arquivo);
    if (!caminho.startsWith(PASTA_COMPROVANTES) || !existsSync(caminho)) throw new NotFoundException('Arquivo não encontrado');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=600');
    createReadStream(caminho).pipe(res);
  }

  @Get(':id')
  detalhe(@Param('id', ParseUUIDPipe) id: string) {
    return this.pagamentos.detalhe(id);
  }

  @Get()
  lista(@Query('busca') busca?: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.pagamentos.lista(busca, de, ate);
  }
}

@Module({ imports: [PrismaModule], controllers: [PagamentosController], providers: [PagamentosService, ValoresAutomaticosService], exports: [PagamentosService] })
export class PagamentosModule {}
