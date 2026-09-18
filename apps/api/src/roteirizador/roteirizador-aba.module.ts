import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';

/**
 * Aba Roteirizador (18/09/2026): gere os atendimentos do acompanhamento velado, feitos
 * pelo Tom / Clayton Amorim, e os gastos do veículo (abastecimento e despesas).
 * Quando o Tom não atende, o dia pode registrar outro motorista.
 *
 * Despesas ficam em detalhes.despesas (jsonb) — nada de tabela nova. Também soma os
 * gastos que já vinham no atendimento veicular (combustível, pedágio, alimentação).
 */
const TIPOS_DESPESA = ['ABASTECIMENTO', 'PEDAGIO', 'MANUTENCAO', 'ALIMENTACAO', 'ESTACIONAMENTO', 'OUTRO'] as const;
type TipoDespesa = (typeof TIPOS_DESPESA)[number];
type Despesa = { tipo: TipoDespesa; valor: number; litros?: number; odometro?: number; data: string; obs?: string; por: string; em: string };

@Injectable()
export class RoteirizadorService {
  constructor(private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  /** IDs dos prestadores do roteirizador (Tom e Clayton Amorim, com as duplicidades). */
  private async motoristas(): Promise<string[]> {
    const ps = await this.prisma.provider.findMany({ where: { OR: [{ name: { startsWith: 'Tom', mode: 'insensitive' } }, { name: { contains: 'Clayton', mode: 'insensitive' } }, { name: { contains: 'Amorim', mode: 'insensitive' } }] }, select: { id: true } });
    return ps.map((p) => p.id);
  }

  private despesasDe(det: Record<string, unknown>): Despesa[] {
    const lista = Array.isArray(det.despesas) ? (det.despesas as Despesa[]) : [];
    // Gastos que já vinham do atendimento veicular entram como despesa "de origem" (só leitura)
    const origem: Despesa[] = [];
    const add = (tipo: TipoDespesa, v: unknown, obs: string) => { const n = Number(v); if (n > 0) origem.push({ tipo, valor: n, data: String(det.dataDespesaOrigem ?? ''), obs, por: 'planilha/retorno', em: '' }); };
    if (!lista.length) {
      add('ABASTECIMENTO', det.combustivel, 'do retorno');
      add('PEDAGIO', det.pedagio, 'do retorno');
      add('ALIMENTACAO', det.alimentacao, 'do retorno');
      add('OUTRO', det.custosAdicionais, 'custos adicionais do retorno');
    }
    return [...lista, ...origem];
  }

  async lista(de?: string, ate?: string, quem?: UsuarioLogado) {
    void quem;
    const ate2 = ate ? new Date(ate + 'T23:59:59Z') : new Date();
    const de2 = de ? new Date(de + 'T00:00:00Z') : new Date(Date.now() - 30 * 864e5);
    const ids = await this.motoristas();
    const ats = await this.prisma.atendimento.findMany({
      where: {
        AND: [
          { OR: [{ providerId: { in: ids } }, { category: 'Roteirizador' } ] },
          { OR: [{ solicitadoEm: { gte: de2, lte: ate2 } }, { solicitadoEm: null, createdAt: { gte: de2, lte: ate2 } }] },
        ],
      },
      select: {
        id: true, idPR7: true, idInterno: true, category: true, status: true, vertical: true,
        solicitadoEm: true, createdAt: true, agenteNome: true, placa: true, detalhes: true,
        provider: { select: { name: true } }, client: { select: { name: true } }, empresa: { select: { nomeFantasia: true } },
      },
      orderBy: [{ solicitadoEm: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const itens = ats.map((a) => {
      const det = (a.detalhes ?? {}) as Record<string, unknown>;
      const despesas = this.despesasDe(det);
      const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
      const litros = despesas.filter((d) => d.tipo === 'ABASTECIMENTO').reduce((s, d) => s + (Number(d.litros) || 0), 0);
      return {
        id: a.id, ref: a.idPR7 ?? a.idInterno ?? a.id.slice(0, 8),
        data: a.solicitadoEm ?? a.createdAt, category: a.category, status: a.status,
        motorista: (det.motorista as string) || a.agenteNome || a.provider?.name || 'Tom',
        cliente: a.empresa?.nomeFantasia || a.client?.name || null, placa: a.placa,
        paradas: Array.isArray(det.paradas) ? det.paradas.length : 0,
        despesas, totalDespesas, litros,
      };
    });
    // Resumo por tipo no período
    const porTipo: Record<string, { valor: number; litros?: number; qtd: number }> = {};
    for (const it of itens) for (const d of it.despesas) {
      const t = (porTipo[d.tipo] ??= { valor: 0, litros: 0, qtd: 0 });
      t.valor += d.valor; t.qtd += 1; if (d.litros) t.litros = (t.litros ?? 0) + Number(d.litros);
    }
    const totalGeral = itens.reduce((s, it) => s + it.totalDespesas, 0);
    return {
      periodo: { de: de2.toISOString().slice(0, 10), ate: ate2.toISOString().slice(0, 10) },
      resumo: { atendimentos: itens.length, totalGeral, porTipo, litros: porTipo.ABASTECIMENTO?.litros ?? 0 },
      tiposDespesa: TIPOS_DESPESA, itens,
    };
  }

  private async carregar(id: string) {
    const a = await this.prisma.atendimento.findUnique({ where: { id }, select: { id: true, detalhes: true, agenteNome: true } });
    if (!a) throw new NotFoundException('Atendimento não encontrado');
    return a;
  }

  async adicionarDespesa(id: string, dto: Record<string, unknown>, u: UsuarioLogado) {
    const tipo = String(dto.tipo ?? '').toUpperCase() as TipoDespesa;
    if (!TIPOS_DESPESA.includes(tipo)) throw new BadRequestException('Tipo de despesa inválido');
    const valor = Number(dto.valor);
    if (!(valor > 0) || valor > 100000) throw new BadRequestException('Valor inválido');
    const a = await this.carregar(id);
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    const despesas = (Array.isArray(det.despesas) ? det.despesas : []) as Despesa[];
    const nova: Despesa = {
      tipo, valor: Math.round(valor * 100) / 100,
      litros: dto.litros != null && Number(dto.litros) > 0 ? Math.round(Number(dto.litros) * 100) / 100 : undefined,
      odometro: dto.odometro != null && Number(dto.odometro) > 0 ? Math.round(Number(dto.odometro)) : undefined,
      data: dto.data ? String(dto.data).slice(0, 10) : new Date().toISOString().slice(0, 10),
      obs: dto.obs ? String(dto.obs).slice(0, 300) : undefined,
      por: u.email, em: new Date().toISOString(),
    };
    despesas.push(nova);
    await this.prisma.atendimento.update({ where: { id }, data: { detalhes: { ...det, despesas } as Prisma.InputJsonValue } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Roteirizador: despesa ${tipo} R$ ${nova.valor} no atendimento ${id.slice(0, 8)}` });
    return { ok: true, despesas };
  }

  async removerDespesa(id: string, indice: number, u: UsuarioLogado) {
    const a = await this.carregar(id);
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    const despesas = (Array.isArray(det.despesas) ? det.despesas : []) as Despesa[];
    if (indice < 0 || indice >= despesas.length) throw new BadRequestException('Despesa não encontrada');
    const [rem] = despesas.splice(indice, 1);
    await this.prisma.atendimento.update({ where: { id }, data: { detalhes: { ...det, despesas } as Prisma.InputJsonValue } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Roteirizador: despesa ${rem?.tipo} R$ ${rem?.valor} removida do atendimento ${id.slice(0, 8)}` });
    return { ok: true, despesas };
  }

  /** Motorista do dia: por padrão Tom; registra outro nome quando ele não atende. */
  async definirMotorista(id: string, motorista: string, u: UsuarioLogado) {
    const nome = (motorista ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!nome) throw new BadRequestException('Informe o nome do motorista');
    const a = await this.carregar(id);
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    await this.prisma.atendimento.update({ where: { id }, data: { detalhes: { ...det, motorista: nome } as Prisma.InputJsonValue, agenteNome: nome } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Roteirizador: motorista do atendimento ${id.slice(0, 8)} definido como "${nome}"` });
    return { ok: true, motorista: nome };
  }
}

type Req = { user: UsuarioLogado };

@Protegido('roteirizador')
@Controller('roteirizador')
class RoteirizadorController {
  constructor(private readonly s: RoteirizadorService) {}

  @Get() lista(@Query('de') de: string, @Query('ate') ate: string, @Req() r: Req) { return this.s.lista(de, ate, r.user); }
  @Post(':id/despesa') addDespesa(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>, @Req() r: Req) { return this.s.adicionarDespesa(id, dto, r.user); }
  @Post(':id/despesa/:indice/remover') rmDespesa(@Param('id', ParseUUIDPipe) id: string, @Param('indice') indice: string, @Req() r: Req) { return this.s.removerDespesa(id, Number(indice), r.user); }
  @Patch(':id/motorista') motorista(@Param('id', ParseUUIDPipe) id: string, @Body() b: { motorista?: string }, @Req() r: Req) { return this.s.definirMotorista(id, b?.motorista ?? '', r.user); }
}

@Module({ imports: [PrismaModule], controllers: [RoteirizadorController], providers: [RoteirizadorService] })
export class RoteirizadorAbaModule {}
