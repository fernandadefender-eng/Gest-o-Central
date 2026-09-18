import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { SomenteAdmin, UsuarioLogado } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';

/**
 * Aba Fechamentos (18/09/2026): o **valor do cliente** (faturamento) fica só aqui, e o
 * acesso é **exclusivo do ADMINISTRADOR** (a supervisão não vê — ela faz a avaliação
 * operacional dos atendimentos antes; o fechamento financeiro é do ADM).
 *
 * Regra da operação: "tudo que for valor de cliente → Fechamentos; valor de apoio →
 * nos atendimentos". Por isso aqui só se mexe em `valorCliente`.
 */
@Injectable()
export class FechamentosService {
  constructor(private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  private periodo(de?: string, ate?: string) {
    const ate2 = ate ? new Date(ate + 'T23:59:59Z') : new Date();
    const de2 = de ? new Date(de + 'T00:00:00Z') : new Date(Date.UTC(ate2.getUTCFullYear(), ate2.getUTCMonth(), 1));
    return { de2, ate2 };
  }
  private where(de2: Date, ate2: Date): Prisma.AtendimentoWhereInput {
    return { status: 'CONCLUIDO', OR: [{ solicitadoEm: { gte: de2, lte: ate2 } }, { solicitadoEm: null, createdAt: { gte: de2, lte: ate2 } }] };
  }

  /** Resumo por cliente (empresa) no período: faturamento e o que falta valorar. */
  async porCliente(de?: string, ate?: string) {
    const { de2, ate2 } = this.periodo(de, ate);
    const ats = await this.prisma.atendimento.findMany({
      where: this.where(de2, ate2),
      select: { valorCliente: true, empresaId: true, empresa: { select: { nomeFantasia: true, razaoSocial: true } }, client: { select: { name: true } }, detalhes: true },
    });
    const grupos = new Map<string, { empresaId: string | null; nome: string; atendimentos: number; comValor: number; semValor: number; faturamento: number; faturado: number }>();
    for (const a of ats) {
      const nome = a.empresa?.nomeFantasia || a.empresa?.razaoSocial || a.client?.name || 'Sem cliente';
      const chave = a.empresaId ?? 'sem-empresa:' + nome;
      const g = grupos.get(chave) ?? { empresaId: a.empresaId ?? null, nome, atendimentos: 0, comValor: 0, semValor: 0, faturamento: 0, faturado: 0 };
      g.atendimentos++;
      if (a.valorCliente != null) { g.comValor++; g.faturamento += Number(a.valorCliente); } else g.semValor++;
      if ((a.detalhes as Record<string, unknown> | null)?.faturado) g.faturado++;
      grupos.set(chave, g);
    }
    const clientes = [...grupos.values()].sort((a, b) => b.faturamento - a.faturamento);
    return {
      periodo: { de: de2.toISOString().slice(0, 10), ate: ate2.toISOString().slice(0, 10) },
      totalFaturamento: clientes.reduce((s, c) => s + c.faturamento, 0),
      totalAtendimentos: clientes.reduce((s, c) => s + c.atendimentos, 0),
      semValor: clientes.reduce((s, c) => s + c.semValor, 0),
      clientes,
    };
  }

  /** Detalhe de um cliente: os atendimentos com o valor do cliente. */
  async detalheCliente(empresaId: string, de?: string, ate?: string) {
    const { de2, ate2 } = this.periodo(de, ate);
    const semEmpresa = empresaId === 'sem-empresa';
    const ats = await this.prisma.atendimento.findMany({
      where: { ...this.where(de2, ate2), ...(semEmpresa ? { empresaId: null } : { empresaId }) },
      select: {
        id: true, idPR7: true, idInterno: true, category: true, vertical: true, solicitadoEm: true, createdAt: true,
        valorCliente: true, placa: true, detalhes: true, client: { select: { name: true } },
        conta: { select: { estabelecimento: true } },
      },
      orderBy: [{ solicitadoEm: 'asc' }, { createdAt: 'asc' }],
      take: 1000,
    });
    return ats.map((a) => ({
      id: a.id, ref: a.idPR7 ?? a.idInterno ?? a.id.slice(0, 8),
      data: a.solicitadoEm ?? a.createdAt, category: a.category, vertical: a.vertical, placa: a.placa,
      local: a.conta?.estabelecimento || a.client?.name || null,
      valorCliente: a.valorCliente != null ? Number(a.valorCliente) : null,
      faturado: !!(a.detalhes as Record<string, unknown> | null)?.faturado,
    }));
  }

  /** Define o valor do cliente de um atendimento (só ADM, e só aqui). */
  async definirValor(id: string, valor: number | null, u: UsuarioLogado) {
    const a = await this.prisma.atendimento.findUnique({ where: { id }, select: { valorCliente: true, detalhes: true } });
    if (!a) throw new NotFoundException('Atendimento não encontrado');
    if (valor != null && (!(valor >= 0) || valor > 1_000_000)) throw new BadRequestException('Valor inválido');
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    await this.prisma.atendimento.update({
      where: { id },
      data: {
        valorCliente: valor == null ? null : new Prisma.Decimal(valor.toFixed(2)),
        detalhes: { ...det, valorClienteManual: { por: u.email, em: new Date().toISOString(), antes: a.valorCliente?.toString() ?? null } } as Prisma.InputJsonValue,
      },
    });
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Fechamento: valor do cliente do atendimento ${id.slice(0, 8)} = R$ ${valor ?? '—'} (antes R$ ${a.valorCliente ?? '—'})` });
    return { ok: true };
  }

  /** Fecha o período de um cliente: marca os atendimentos como faturados (auditado). */
  async fechar(empresaId: string, de: string | undefined, ate: string | undefined, u: UsuarioLogado) {
    const { de2, ate2 } = this.periodo(de, ate);
    const semEmpresa = empresaId === 'sem-empresa';
    const ats = await this.prisma.atendimento.findMany({
      where: { ...this.where(de2, ate2), ...(semEmpresa ? { empresaId: null } : { empresaId }), valorCliente: { not: null } },
      select: { id: true, detalhes: true },
    });
    if (!ats.length) throw new BadRequestException('Nenhum atendimento com valor de cliente para fechar neste período');
    const marca = { em: new Date().toISOString(), por: u.email, periodo: `${de2.toISOString().slice(0, 10)}..${ate2.toISOString().slice(0, 10)}` };
    for (const a of ats) {
      const det = (a.detalhes ?? {}) as Record<string, unknown>;
      await this.prisma.atendimento.update({ where: { id: a.id }, data: { detalhes: { ...det, faturado: marca } as Prisma.InputJsonValue } });
    }
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Fechamento fechado: ${ats.length} atendimentos faturados (empresa ${empresaId}, ${marca.periodo})` });
    return { ok: true, faturados: ats.length };
  }
}

type Req = { user: UsuarioLogado };

/** Só ADMINISTRADOR — a supervisão não tem acesso ao faturamento do cliente. */
@SomenteAdmin()
@Controller('fechamentos')
class FechamentosController {
  constructor(private readonly s: FechamentosService) {}

  @Get() porCliente(@Query('de') de: string, @Query('ate') ate: string) { return this.s.porCliente(de, ate); }
  @Get('cliente/:empresaId') detalhe(@Param('empresaId') empresaId: string, @Query('de') de: string, @Query('ate') ate: string) { return this.s.detalheCliente(empresaId, de, ate); }
  @Patch('atendimento/:id') valor(@Param('id', ParseUUIDPipe) id: string, @Body() b: { valor?: number | null }, @Req() r: Req) { return this.s.definirValor(id, b?.valor === undefined ? null : b.valor, r.user); }
  @Post('cliente/:empresaId/fechar') fechar(@Param('empresaId') empresaId: string, @Body() b: { de?: string; ate?: string }, @Req() r: Req) { return this.s.fechar(empresaId, b?.de, b?.ate, r.user); }
}

@Module({ imports: [PrismaModule], controllers: [FechamentosController], providers: [FechamentosService] })
export class FechamentosModule {}
