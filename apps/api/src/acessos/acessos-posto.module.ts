import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';

/**
 * Registro de acesso físico aos postos (18/09/2026): chave física ou cadeado de senha.
 * Preenchido CONFORME os atendimentos nos postos. Guarda o histórico de trocas — pode
 * acontecer de outra empresa atender e trocar a senha, e isso fica registrado.
 * O segredo é sensível: só a operação (permissão `prestadores`) e o ADM veem; tudo auditado.
 */
const TIPOS = ['CHAVE_FISICA', 'SENHA', 'AMBOS', 'NENHUM', 'DESCONHECIDO'] as const;
type Tipo = (typeof TIPOS)[number];

@Injectable()
export class AcessosPostoService {
  constructor(private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  /** Lista/pesquisa postos com acesso registrado (busca por nome/cidade/cliente). */
  async lista(q?: string) {
    const termo = (q ?? '').trim();
    const where: Prisma.AcessoPostoWhereInput = termo
      ? { OR: [{ posto: { contains: termo, mode: 'insensitive' } }, { cidade: { contains: termo, mode: 'insensitive' } }, { cliente: { contains: termo, mode: 'insensitive' } }] }
      : {};
    const itens = await this.prisma.acessoPosto.findMany({ where, orderBy: { atualizadoEm: 'desc' }, take: 300 });
    // Não manda o segredo na lista — só um indicador de que existe
    return itens.map((a) => ({
      id: a.id, posto: a.posto, cidade: a.cidade, uf: a.uf, cliente: a.cliente, tipo: a.tipo,
      temSegredo: !!a.segredo, observacao: a.observacao, atualizadoPor: a.atualizadoPor, atualizadoEm: a.atualizadoEm,
      trocas: Array.isArray(a.historico) ? a.historico.length : 0,
    }));
  }

  /** Detalhe COM o segredo (registra na auditoria quem consultou). */
  async detalhe(id: string, u: UsuarioLogado) {
    const a = await this.prisma.acessoPosto.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Posto não encontrado');
    if (a.segredo) this.auditoria.registrar('SEGURANCA', { usuario: u.email, detalhe: `Acesso do posto "${a.posto}" (segredo do cadeado) consultado` });
    return a;
  }

  async salvar(dto: Record<string, unknown>, u: UsuarioLogado, id?: string) {
    const tipo = String(dto.tipo ?? 'DESCONHECIDO').toUpperCase() as Tipo;
    if (!TIPOS.includes(tipo)) throw new BadRequestException('Tipo de acesso inválido');
    const posto = String(dto.posto ?? '').replace(/\s+/g, ' ').trim();
    const txt = (v: unknown, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
    const segredo = tipo === 'SENHA' || tipo === 'AMBOS' ? txt(dto.segredo, 60) : null;

    const atual = id ? await this.prisma.acessoPosto.findUnique({ where: { id } }) : null;
    if (id && !atual) throw new NotFoundException('Posto não encontrado');
    if (!id && !posto) throw new BadRequestException('Informe o nome do posto');

    // Monta a entrada de histórico quando muda o tipo ou a senha (troca)
    const historico = Array.isArray(atual?.historico) ? [...(atual!.historico as unknown[])] : [];
    const mudouTipo = atual && atual.tipo !== tipo;
    const mudouSegredo = atual && (atual.segredo ?? '') !== (segredo ?? '');
    if (!atual || mudouTipo || mudouSegredo) {
      historico.push({
        em: new Date().toISOString(), por: u.email, tipo,
        segredoTrocado: mudouSegredo || (!atual && !!segredo),
        motivo: txt(dto.motivo, 200) ?? (atual ? 'atualização no atendimento' : 'registro inicial'),
        outraEmpresa: dto.outraEmpresa === true, // outra empresa atendeu e trocou
      });
    }
    const data = {
      posto: posto || atual!.posto, cidade: txt(dto.cidade, 80), uf: txt(dto.uf, 2)?.toUpperCase() ?? null,
      cliente: txt(dto.cliente, 120), tipo, segredo, observacao: txt(dto.observacao, 500),
      contaId: dto.contaId ? String(dto.contaId) : atual?.contaId ?? null,
      historico: historico as Prisma.InputJsonValue, atualizadoPor: u.email,
    };
    const r = id
      ? await this.prisma.acessoPosto.update({ where: { id }, data })
      : await this.prisma.acessoPosto.create({ data: data as Prisma.AcessoPostoUncheckedCreateInput });
    this.auditoria.registrar('SEGURANCA', {
      usuario: u.email,
      detalhe: `Acesso do posto "${r.posto}" ${id ? 'atualizado' : 'registrado'}: tipo ${tipo}${mudouSegredo ? ' · SENHA TROCADA' : ''}${dto.outraEmpresa === true ? ' (outra empresa)' : ''}`,
    });
    return { id: r.id, ok: true };
  }
}

type Req = { user: UsuarioLogado };

// Operação (permissão prestadores) e ADM: são quem precisa do acesso para atender o posto
@Protegido('prestadores')
@Controller('acessos-posto')
class AcessosPostoController {
  constructor(private readonly s: AcessosPostoService) {}

  @Get() lista(@Query('q') q: string) { return this.s.lista(q); }
  @Get(':id') detalhe(@Param('id', ParseUUIDPipe) id: string, @Req() r: Req) { return this.s.detalhe(id, r.user); }
  @Post() criar(@Body() dto: Record<string, unknown>, @Req() r: Req) { return this.s.salvar(dto, r.user); }
  @Patch(':id') editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>, @Req() r: Req) { return this.s.salvar(dto, r.user, id); }
}

@Module({ imports: [PrismaModule], controllers: [AcessosPostoController], providers: [AcessosPostoService] })
export class AcessosPostoModule {}
