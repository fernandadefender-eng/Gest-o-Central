import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { EventoDesfecho, EventoPrioridade, EventoStatus, Prisma, Vertical } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AtendimentosModule } from '../atendimentos/atendimentos.module';
import { AtendimentosService } from '../atendimentos/atendimentos.service';
import { Protegido, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';
import { carregarBloqueio } from '../geo/bloqueio';

const limpar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

import { EVENTOS_VEICULARES, prioridadePorTexto } from './prioridade';
import { proximoIdEvento, proximoIdInterno } from '../atendimentos/identificador';
import { tipoGrupoPeloNome } from '../classification/classification.service';

class NovoEventoDto {
  @IsEnum(Vertical) vertical!: Vertical;
  @Transform(limpar) @IsString() @IsIn([...EVENTOS_VEICULARES], { message: 'Evento fora da lista do Monitoramento (roubo/furto é atendimento veicular)' }) tipo!: string;
  @IsOptional() @IsEnum(EventoPrioridade) prioridade?: EventoPrioridade;
  // Relato curto do que aconteceu — obrigatório no registro manual
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString({ message: 'Escreva um pequeno relato do evento' }) @Length(5, 1000, { message: 'Escreva um pequeno relato do evento' }) descricao!: string;
  // Quando o evento ocorreu (horário da central / do cliente), não quando foi digitado
  @IsDateString({}, { message: 'Informe a data e a hora em que o evento ocorreu' }) ocorridoEm!: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(160) clienteNome?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : value)) @IsString() @Length(7, 7) placa?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(80) cidade?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @IsString() @Length(2, 2) uf?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(40) ocorrencia?: string;
}

class TratativaDto {
  @IsIn(['NOTA', 'CONTATO_CLIENTE']) tipo!: 'NOTA' | 'CONTATO_CLIENTE';
  @Transform(limpar) @IsString() @Length(2, 1000) texto!: string;
}

class StatusDto {
  @IsIn(['EM_TRATATIVA', 'AGUARDANDO']) status!: 'EM_TRATATIVA' | 'AGUARDANDO';
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(500) motivo?: string;
}

class AcionarDto {
  @IsUUID() prestadorId!: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(500) observacao?: string;
}

class EncerrarDto {
  @IsEnum(EventoDesfecho) desfecho!: EventoDesfecho;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(1000) texto?: string;
}

const NOME_DESFECHO: Record<EventoDesfecho, string> = {
  ATENDIMENTO_REALIZADO: 'Atendimento realizado', SEM_PRESTADOR: 'Sem prestador disponível', FALSO_ALARME: 'Falso alarme', RESOLVIDO_REMOTO: 'Resolvido remotamente',
  SEM_CONTATO: 'Sem contato', CANCELADO_CLIENTE: 'Cancelado pelo cliente', DUPLICADO: 'Duplicado',
};

@Injectable()
export class MonitoramentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly atendimentos: AtendimentosService,
  ) {}

  private async buscar(id: string, u: UsuarioLogado) {
    const e = await this.prisma.evento.findFirst({ where: { id, vertical: { in: this.verticaisDoMonitoramento(u) } } });
    if (!e) throw new NotFoundException('Evento não encontrado');
    return e;
  }

  private anotar(eventoId: string, tipo: string, texto: string, usuario: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.eventoTratativa.create({ data: { eventoId, tipo, texto, usuario } });
  }

  /**
   * Monitoramento trata SOMENTE eventos veiculares (regra da operação): o
   * patrimonial é acompanhado pela tela de Atendimentos, não entra na fila.
   */
  private verticaisDoMonitoramento(u: UsuarioLogado, vertical?: Vertical): Vertical[] {
    return verticaisPermitidas(u, vertical).filter((v) => v === 'VEICULAR');
  }

  /** Fila da central: abertos por prioridade e antiguidade + encerrados recentes. */
  async fila(u: UsuarioLogado, vertical?: Vertical) {
    const v = this.verticaisDoMonitoramento(u, vertical);
    const ordemPrioridade = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };
    const [abertos, encerrados] = await Promise.all([
      this.prisma.evento.findMany({
        where: { vertical: { in: v }, status: { not: 'ENCERRADO' } },
        orderBy: { recebidoEm: 'asc' },
        take: 300,
        include: { _count: { select: { tratativas: true } }, atendimento: { select: { id: true, provider: { select: { name: true } } } } },
      }),
      this.prisma.evento.findMany({
        where: { vertical: { in: v }, status: 'ENCERRADO', encerradoEm: { gt: new Date(Date.now() - 12 * 3600e3) } },
        orderBy: { encerradoEm: 'desc' },
        take: 30,
      }),
    ]);
    abertos.sort((a, b) => ordemPrioridade[a.prioridade] - ordemPrioridade[b.prioridade] || +a.recebidoEm - +b.recebidoEm);
    return { agora: new Date().toISOString(), abertos, encerrados };
  }

  async detalhe(id: string, u: UsuarioLogado) {
    await this.buscar(id, u);
    const e = await this.prisma.evento.findUnique({
      where: { id },
      include: {
        tratativas: { orderBy: { criadoEm: 'asc' } },
        atendimento: {
          select: {
            id: true, status: true, summary: true, placa: true, acionadoEm: true, chegadaEm: true, concluidoEm: true, idPR7: true, idInterno: true, agenteNome: true,
            resultado: true, responsavelLocalNome: true, responsavelLocalTelefone: true,
            empresa: { select: { razaoSocial: true, nomeFantasia: true } },
            midias: { where: { status: 'SALVA' }, orderBy: { recebidaEm: 'asc' }, select: { id: true, tipo: true, legenda: true, mimeType: true, recebidaEm: true } },
            provider: { select: { id: true, name: true, phone: true } },
            conta: { select: { codigo: true, estabelecimento: true, endereco: true, cidade: true, estado: true } },
            conversation: { select: { groupName: true, messages: { orderBy: { sentAt: 'desc' }, take: 15, select: { content: true, senderName: true, direction: true, sentAt: true } } } },
          },
        },
      },
    });
    const uf = e!.uf ?? e!.atendimento?.conta?.estado;
    const cidade = e!.cidade ?? e!.atendimento?.conta?.cidade;
    const quemAtende = uf ? { ...(await this.atendimentos.sugerirPrestadores(cidade ?? undefined, uf)), cidade, uf } : null;
    return { ...e, quemAtende };
  }

  async criar(dto: NovoEventoDto, u: UsuarioLogado) {
    if (dto.vertical !== 'VEICULAR') throw new BadRequestException('O Monitoramento trata somente eventos veiculares');
    if (!verticaisPermitidas(u).includes(dto.vertical)) throw new BadRequestException('Vertical não liberada para o seu usuário');
    const ocorridoEm = new Date(dto.ocorridoEm);
    if (+ocorridoEm > Date.now() + 5 * 60000) throw new BadRequestException('O horário do evento está no futuro');
    if (+ocorridoEm < Date.now() - 30 * 864e5) throw new BadRequestException('O horário do evento tem mais de 30 dias — confira a data');
    const e = await this.prisma.evento.create({
      data: {
        ...dto, ocorridoEm, origem: 'MANUAL', idInterno: await proximoIdEvento(this.prisma, ocorridoEm),
        prioridade: dto.prioridade ?? prioridadePorTexto(`${dto.tipo} ${dto.descricao ?? ''}`),
      },
    });
    await this.anotar(e.id, 'SISTEMA', 'Evento registrado manualmente', u.email);
    return e;
  }

  async assumir(id: string, u: UsuarioLogado) {
    const e = await this.buscar(id, u);
    if (e.status === 'ENCERRADO') throw new BadRequestException('Evento já encerrado');
    const troca = e.assumidoPor && e.assumidoPor !== u.email;
    const r = await this.prisma.evento.update({
      where: { id },
      data: { assumidoPor: u.email, assumidoEm: new Date(), ...(e.status === 'NOVO' ? { status: 'EM_TRATATIVA' } : {}) },
    });
    await this.anotar(id, 'STATUS', troca ? `Assumido por ${u.nome} (antes com ${e.assumidoPor})` : `Assumido por ${u.nome}`, u.email);
    return r;
  }

  async tratativa(id: string, dto: TratativaDto, u: UsuarioLogado) {
    const e = await this.buscar(id, u);
    if (e.status === 'ENCERRADO') throw new BadRequestException('Evento já encerrado');
    if (!e.assumidoPor) await this.assumir(id, u);
    return this.anotar(id, dto.tipo, dto.texto, u.email);
  }

  async mudarStatus(id: string, dto: StatusDto, u: UsuarioLogado) {
    const e = await this.buscar(id, u);
    if (e.status === 'ENCERRADO') throw new BadRequestException('Evento já encerrado');
    const r = await this.prisma.evento.update({ where: { id }, data: { status: dto.status, ...(e.assumidoPor ? {} : { assumidoPor: u.email, assumidoEm: new Date() }) } });
    await this.anotar(id, 'STATUS', `${dto.status === 'AGUARDANDO' ? 'Aguardando retorno' : 'Em tratativa'}${dto.motivo ? ': ' + dto.motivo : ''}`, u.email);
    return r;
  }

  /** Aciona o prestador: cria (ou atualiza) o atendimento ligado ao evento e marca o acionamento. */
  async acionar(id: string, dto: AcionarDto, u: UsuarioLogado) {
    const e = await this.buscar(id, u);
    if (e.status === 'ENCERRADO') throw new BadRequestException('Evento já encerrado');
    const prest = await this.prisma.provider.findUnique({ where: { id: dto.prestadorId } });
    if (!prest) throw new NotFoundException('Prestador não encontrado');
    if (prest.status === 'RESTRITO') throw new BadRequestException('Prestador RESTRITO — não pode ser acionado');
    if ((await carregarBloqueio(this.prisma)).verificar(prest.name, prest.phone)) throw new BadRequestException('Prestador está na lista de RESTRITOS');

    const agora = new Date();
    return this.prisma.$transaction(async (tx) => {
      let atendimentoId = e.atendimentoId;
      if (atendimentoId) {
        await tx.atendimento.update({ where: { id: atendimentoId }, data: { providerId: prest.id, acionadoEm: agora, status: 'EM_ANDAMENTO' } });
      } else {
        const nome = e.clienteNome || 'Cliente não identificado';
        const cliente = await tx.client.upsert({ where: { phone: `import:${nome}` }, create: { phone: `import:${nome}`, name: nome }, update: {} });
        const a = await tx.atendimento.create({
          data: {
            idInterno: await proximoIdInterno(this.prisma),
            clientId: cliente.id, vertical: e.vertical, category: e.tipo, summary: e.descricao, status: 'EM_ANDAMENTO',
            ocorrencia: e.ocorrencia, placa: e.placa, providerId: prest.id, operadorPR7: u.nome,
            solicitadoEm: e.ocorridoEm ?? e.recebidoEm, acionadoEm: agora,
            detalhes: { cidade: e.cidade, estado: e.uf, origem: 'monitoramento' } as Prisma.InputJsonValue,
          },
        });
        atendimentoId = a.id;
      }
      await tx.evento.update({
        where: { id }, data: { status: 'ENCAMINHADO', atendimentoId, ...(e.assumidoPor ? {} : { assumidoPor: u.email, assumidoEm: agora }) },
      });
      await this.anotar(id, 'ACIONAMENTO', `Prestador acionado: ${prest.name}${dto.observacao ? ' — ' + dto.observacao : ''}`, u.email, tx);
      return { ok: true, atendimentoId };
    });
  }

  async encerrar(id: string, dto: EncerrarDto, u: UsuarioLogado) {
    const e = await this.buscar(id, u);
    if (e.status === 'ENCERRADO') throw new BadRequestException('Evento já encerrado');
    const agora = new Date();
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.evento.update({
        where: { id },
        data: { status: 'ENCERRADO', desfecho: dto.desfecho, encerradoPor: u.email, encerradoEm: agora, ...(e.assumidoPor ? {} : { assumidoPor: u.email, assumidoEm: agora }) },
      });
      await this.anotar(id, 'STATUS', `Encerrado: ${NOME_DESFECHO[dto.desfecho]}${dto.texto ? ' — ' + dto.texto : ''}`, u.email, tx);
      // Reflete no atendimento ligado (decisão humana: vale mesmo com a revisão manual da IA ligada)
      if (e.atendimentoId) {
        const mapa: Partial<Record<EventoDesfecho, Prisma.AtendimentoUpdateInput>> = {
          ATENDIMENTO_REALIZADO: { status: 'CONCLUIDO', concluidoEm: agora },
          FALSO_ALARME: { status: 'NAO_ATENDIDO', motivoNaoAtendimento: 'FALSO_ALARME' },
          SEM_PRESTADOR: { status: 'NAO_ATENDIDO', motivoNaoAtendimento: 'SEM_PRESTADOR_REGIAO' },
          RESOLVIDO_REMOTO: { status: 'CONCLUIDO', concluidoEm: agora, resultado: 'Resolvido remotamente pela central' },
          SEM_CONTATO: { status: 'NAO_ATENDIDO', motivoNaoAtendimento: 'OUTRO', detalheNaoAtendimento: 'Sem contato' },
          CANCELADO_CLIENTE: { status: 'CANCELADO', motivoNaoAtendimento: 'CANCELADO_CLIENTE', detalheNaoAtendimento: `Cliente cancelou ${Math.max(0, Math.round((+agora - +(e.ocorridoEm ?? e.recebidoEm)) / 60000))} min após a solicitação` },
          DUPLICADO: { status: 'NAO_ATENDIDO', motivoNaoAtendimento: 'DUPLICADO' },
        };
        await tx.atendimento.update({
          where: { id: e.atendimentoId },
          data: { ...mapa[dto.desfecho], encerradoPor: u.email, encerradoEm: agora, ...(dto.texto ? { resultado: dto.texto } : {}) },
        });
      }
      return r;
    });
  }
}

class TipoGrupoDto {
  @IsIn(['CLIENTE', 'PRESTADOR', 'INTERNO']) tipo!: 'CLIENTE' | 'PRESTADOR' | 'INTERNO';
}

type ReqU = { user: UsuarioLogado; ip?: string };

/** Grupos do WhatsApp e seu tipo: define se o grupo abre evento (cliente) ou só dá retorno (prestador). */
@Protegido('monitoramento')
@Controller('monitoramento/grupos')
class GruposController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  async listar() {
    const grupos = await this.prisma.conversation.findMany({
      where: { isGroup: true },
      select: { id: true, groupName: true, tipoGrupo: true, updatedAt: true, _count: { select: { messages: true, atendimentos: true } } },
      orderBy: [{ tipoGrupo: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'desc' }],
    });
    return grupos.map((g) => ({ ...g, sugerido: tipoGrupoPeloNome(g.groupName) }));
  }

  @Post(':id')
  async definir(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TipoGrupoDto, @Req() req: ReqU) {
    const g = await this.prisma.conversation.update({ where: { id }, data: { tipoGrupo: dto.tipo }, select: { id: true, groupName: true, tipoGrupo: true } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `grupo "${g.groupName}" definido como ${dto.tipo}` });
    return g;
  }
}

@Protegido('monitoramento')
@Controller('monitoramento/eventos')
class MonitoramentoController {
  constructor(
    private readonly mon: MonitoramentoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  fila(@Req() req: ReqU, @Query('vertical') vertical?: Vertical) {
    return this.mon.fila(req.user, vertical && Object.values(Vertical).includes(vertical) ? vertical : undefined);
  }

  @Post()
  criar(@Body() dto: NovoEventoDto, @Req() req: ReqU) {
    return this.mon.criar(dto, req.user);
  }

  @Get(':id')
  detalhe(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqU) {
    return this.mon.detalhe(id, req.user);
  }

  @Post(':id/assumir')
  assumir(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqU) {
    return this.mon.assumir(id, req.user);
  }

  @Post(':id/tratativa')
  tratativa(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TratativaDto, @Req() req: ReqU) {
    return this.mon.tratativa(id, dto, req.user);
  }

  @Post(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: ReqU) {
    return this.mon.mudarStatus(id, dto, req.user);
  }

  @Post(':id/acionar')
  async acionar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AcionarDto, @Req() req: ReqU) {
    const r = await this.mon.acionar(id, dto, req.user);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `evento ${id}: prestador ${dto.prestadorId} acionado` });
    return r;
  }

  @Post(':id/encerrar')
  async encerrar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EncerrarDto, @Req() req: ReqU) {
    const r = await this.mon.encerrar(id, dto, req.user);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `evento ${id} encerrado: ${dto.desfecho}` });
    return r;
  }
}

@Module({
  imports: [AtendimentosModule],
  controllers: [MonitoramentoController, GruposController],
  providers: [MonitoramentoService],
  exports: [MonitoramentoService],
})
export class MonitoramentoModule {}

export type { EventoStatus };
