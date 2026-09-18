import { Body, Controller, Get, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { EventoPrioridade, Prisma, SacStatus, SacTipo } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado } from '../auth/permissoes';
import { Comprovante, Reclamacao } from './sac';
import { identificadorSac, proximoNumeroSac } from '../atendimentos/identificador';

const limpar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

export class NovoSacDto {
  @IsEnum(SacTipo) tipo!: SacTipo;
  @Transform(limpar) @IsString() @MaxLength(160) assunto!: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(2000) descricao?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(120) solicitante?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') || undefined : value)) @IsString() @MaxLength(13) telefone?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(120) regiao?: string;
  @IsOptional() @IsEnum(EventoPrioridade) prioridade?: EventoPrioridade;
}

export class TratativaSacDto {
  @IsOptional() @IsEnum(SacStatus) status?: SacStatus;
  @IsOptional() @IsEnum(EventoPrioridade) prioridade?: EventoPrioridade;
  @IsOptional() @IsIn(['NOTA', 'CONTATO', 'COMPROVANTE', 'SISTEMA']) tipo?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(1000) texto?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(1000) solucao?: string;
}

/**
 * SAC: canal do prestador com a operação. Reclamação de prestador (pagamento ou
 * atendimento em atraso) não vira chamado de cliente — entra aqui, com prioridade,
 * e é encerrada quando a supervisão posta o comprovante.
 */
@Injectable()
export class SacService {
  private readonly logger = new Logger('SAC');
  constructor(private readonly prisma: PrismaService) {}

  private anotar(sacId: string, tipo: string, texto: string, usuario: string) {
    return this.prisma.sacTratativa.create({ data: { sacId, tipo, texto: texto.slice(0, 1000), usuario } });
  }

  async lista(status?: SacStatus) {
    const ordem = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 } as const;
    const itens = await this.prisma.chamadoSac.findMany({
      where: status ? { status } : {},
      orderBy: { abertoEm: 'desc' },
      take: 300,
      include: { _count: { select: { tratativas: true } } },
    });
    const comCodigo = itens.map((s) => ({ ...s, codigo: identificadorSac(s.numero) }));
    const abertos = comCodigo.filter((s) => s.status !== 'RESOLVIDO').sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade] || +a.abertoEm - +b.abertoEm);
    return { agora: new Date().toISOString(), abertos, resolvidos: comCodigo.filter((s) => s.status === 'RESOLVIDO').slice(0, 50) };
  }

  async detalhe(id: string) {
    const s = await this.prisma.chamadoSac.findUnique({ where: { id }, include: { tratativas: { orderBy: { criadoEm: 'asc' } } } });
    if (!s) throw new NotFoundException('Chamado de SAC não encontrado');
    const atendimentos = s.idsCitados.length
      ? await this.prisma.atendimento.findMany({
          where: { idPR7: { in: s.idsCitados } },
          select: { id: true, idPR7: true, status: true, category: true, solicitadoEm: true, agenteNome: true, client: { select: { name: true } } },
        })
      : [];
    return { ...s, codigo: identificadorSac(s.numero), atendimentos };
  }

  async criar(dto: NovoSacDto, u: UsuarioLogado) {
    const numero = await proximoNumeroSac(this.prisma);
    const s = await this.prisma.chamadoSac.create({
      data: { ...dto, numero, prioridade: dto.prioridade ?? 'MEDIA', status: 'ABERTO' },
    });
    await this.anotar(s.id, 'SISTEMA', `Chamado ${identificadorSac(numero)} aberto manualmente`, u.email);
    return { ...s, codigo: identificadorSac(s.numero) };
  }

  async tratar(id: string, dto: TratativaSacDto, u: UsuarioLogado) {
    const s = await this.prisma.chamadoSac.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Chamado de SAC não encontrado');
    const data: Prisma.ChamadoSacUncheckedUpdateInput = {};
    if (dto.status && dto.status !== s.status) {
      data.status = dto.status;
      if (dto.status === 'RESOLVIDO') { data.resolvidoEm = new Date(); data.resolvidoPor = u.email; }
      else { data.resolvidoEm = null; data.resolvidoPor = null; }
    }
    if (dto.prioridade) data.prioridade = dto.prioridade;
    if (dto.solucao) data.solucao = dto.solucao;
    if (Object.keys(data).length) await this.prisma.chamadoSac.update({ where: { id }, data });
    const texto = dto.texto ?? (dto.status ? `Status: ${dto.status}${dto.solucao ? ' — ' + dto.solucao : ''}` : null);
    if (texto) await this.anotar(id, dto.tipo ?? 'NOTA', texto, u.email);
    return this.detalhe(id);
  }

  // ---------- Entradas automáticas (WhatsApp) ----------

  /** Reclamação lida no grupo do prestador vira ticket com prioridade. */
  async abrirPeloWhatsApp(r: Reclamacao, dados: { texto: string; grupo?: string | null; remetente?: string | null; messageId: string; quando: Date }) {
    const existente = await this.prisma.chamadoSac.findUnique({ where: { messageId: dados.messageId } });
    if (existente) return existente;
    const numero = await proximoNumeroSac(this.prisma);
    const s = await this.prisma.chamadoSac.create({
      data: {
        numero, tipo: r.tipo, assunto: r.assunto, descricao: dados.texto.slice(0, 2000),
        // Prestador cobrando atraso é prioridade: fica no topo da fila do SAC
        prioridade: r.tipo === 'PAGAMENTO_ATRASO' || r.tipo === 'ATENDIMENTO_ATRASO' ? 'ALTA' : 'MEDIA',
        solicitante: dados.remetente ?? null, grupo: dados.grupo ?? null, remetente: dados.remetente ?? null,
        idsCitados: r.idsCitados, messageId: dados.messageId, abertoEm: dados.quando, status: 'ABERTO',
        tratativas: { create: { tipo: 'SISTEMA', texto: `Reclamação recebida no grupo "${dados.grupo ?? 'WhatsApp'}"`, usuario: 'sistema' } },
      },
    });
    this.logger.log(`${identificadorSac(numero)} aberto (${r.tipo}) de ${dados.remetente ?? 'prestador'} — ${r.idsCitados.join(', ') || 'sem ID'}`);
    return s;
  }

  /**
   * Comprovante postado pela supervisão: resolve o SAC do prestador (pelo nome ou
   * pelos IDs citados). Sem SAC aberto, só registra o pagamento no histórico.
   */
  async registrarComprovante(c: Comprovante, dados: { grupo?: string | null; quando: Date; messageId: string }) {
    const primeiroNome = c.nome.split(/\s+/)[0];
    const abertos = await this.prisma.chamadoSac.findMany({
      where: {
        status: { not: 'RESOLVIDO' },
        OR: [
          { solicitante: { contains: primeiroNome, mode: 'insensitive' } },
          ...(c.ids.length ? [{ idsCitados: { hasSome: c.ids } }] : []),
        ],
      },
    });
    for (const s of abertos) {
      await this.prisma.chamadoSac.update({
        where: { id: s.id },
        data: { status: 'RESOLVIDO', resolvidoEm: dados.quando, resolvidoPor: 'comprovante no WhatsApp', solucao: `Comprovante de pagamento enviado${c.ids.length ? ' (IDs ' + c.ids.join(', ') + ')' : ''}` },
      });
      await this.anotar(s.id, 'COMPROVANTE', `Comprovante de ${c.nome}${c.regiao ? ' / ' + c.regiao : ''} postado em "${dados.grupo ?? 'WhatsApp'}"${c.ids.length ? ' — IDs ' + c.ids.join(', ') : ''}`, 'sistema');
      this.logger.log(`SAC ${s.id} resolvido pelo comprovante de ${c.nome}`);
    }
    return abertos.length;
  }
}

@Protegido('sac')
@Controller('sac')
export class SacController {
  constructor(private readonly sac: SacService) {}

  @Get()
  lista(@Query('status') status?: string) {
    return this.sac.lista(status && status in SacStatus ? (status as SacStatus) : undefined);
  }

  @Get(':id')
  detalhe(@Param('id', ParseUUIDPipe) id: string) {
    return this.sac.detalhe(id);
  }

  @Post()
  criar(@Body() dto: NovoSacDto, @Req() req: { user: UsuarioLogado }) {
    return this.sac.criar(dto, req.user);
  }

  @Patch(':id')
  tratar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TratativaSacDto, @Req() req: { user: UsuarioLogado }) {
    return this.sac.tratar(id, dto, req.user);
  }
}

@Module({ imports: [PrismaModule], controllers: [SacController], providers: [SacService], exports: [SacService] })
export class SacModule {}
