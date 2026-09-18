import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ProviderStatus, ProviderTipo } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Protegido, temPermissao, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';
import { GeoService } from './geo.service';
import { GeocodificacaoService } from './geocodificacao.service';

class FiltroPrestadoresDto {
  @IsOptional() @IsString() busca?: string;
  @IsOptional() @IsString() @Length(2, 2) uf?: string;
  @IsOptional() @IsEnum(ProviderTipo) tipo?: ProviderTipo;
  @IsOptional() @IsEnum(ProviderStatus) status?: ProviderStatus;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() pendentes?: boolean;
}

const limpar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);
const soDigitos = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value);
const NOME_COMPLETO = /^\S{2,}(\s+\S+)+$/;

class PessoaDto {
  // Regra da operação: sempre nome completo (nome + sobrenome) como nome principal
  @IsOptional() @Transform(limpar) @Matches(NOME_COMPLETO, { message: 'Informe nome e sobrenome' }) nomeCompleto?: string;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 60) apelido?: string;
  @IsOptional() @Transform(soDigitos) @Matches(/^\d{10,11}$/, { message: 'Telefone com DDD (10 ou 11 dígitos)' }) telefone?: string;
  @IsOptional() @IsEmail() email?: string;
}

class MembroDto extends PessoaDto {
  @Transform(limpar) @Matches(NOME_COMPLETO, { message: 'Informe nome e sobrenome' }) declare nomeCompleto: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

class RestricaoDto {
  @IsBoolean() restrito!: boolean;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 300) motivo?: string;
}

class ItemRestritoDto {
  @IsOptional() @IsString() @Length(0, 40) telefone?: string;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 120) nome?: string;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 300) motivo?: string;
}

class ListaRestritosDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ItemRestritoDto) itens!: ItemRestritoDto[];
}

class BloqueioDto {
  @Transform(limpar) @Matches(NOME_COMPLETO, { message: 'Informe nome e sobrenome' }) nomeCompleto!: string;
  @IsOptional() @Transform(soDigitos) @Matches(/^(55)?\d{10,11}$/, { message: 'Telefone com DDD' }) telefone?: string;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 160) regiao?: string;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 300) motivo?: string;
  @IsOptional() @Transform(limpar) @IsString() @Length(0, 120) origem?: string;
}

type ReqUsuario = { user: UsuarioLogado; ip?: string };

@Protegido()
@Controller()
class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Protegido('visao_geral', 'mapa')
  @Get('mapa/pontos')
  pontos(@Req() req: ReqUsuario) {
    // Estabelecimentos são da vertical Patrimonial
    return this.geo.pontos(verticaisPermitidas(req.user).includes('PATRIMONIAL'));
  }

  @Protegido('prestadores')
  @Get('prestadores')
  listar(@Query() filtro: FiltroPrestadoresDto) {
    return this.geo.listarPrestadores(filtro);
  }

  // Precisa vir antes de "prestadores/:id" para não ser lida como id
  @Protegido('prestadores', 'prestadores_editar')
  @Get('prestadores/bloqueio')
  listarBloqueio() {
    return this.geo.listarBloqueio();
  }

  // Ficha abre tanto na tela Prestadores quanto no mapa da Visão geral
  @Protegido('prestadores', 'visao_geral', 'mapa')
  @Get('prestadores/:id')
  detalhe(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario) {
    return this.geo.detalhePrestador(id, temPermissao(req.user, 'valores'));
  }

  @Protegido('prestadores_editar')
  @Patch('prestadores/:id/restricao')
  async restricao(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RestricaoDto, @Req() req: ReqUsuario) {
    const r = await this.geo.restringirPrestador(id, dto.restrito, dto.motivo, req.user.email);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `prestador ${id} ${dto.restrito ? 'RESTRITO' : 'liberado'}${dto.motivo ? ': ' + dto.motivo : ''}` });
    return r;
  }

  @Protegido('prestadores_editar')
  @Patch('prestadores/:id/membros/:membroId/restricao')
  async restricaoMembro(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membroId', ParseUUIDPipe) membroId: string,
    @Body() dto: RestricaoDto,
    @Req() req: ReqUsuario,
  ) {
    const r = await this.geo.restringirMembro(id, membroId, dto.restrito, dto.motivo, req.user.email);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `agente ${membroId} ${dto.restrito ? 'RESTRITO' : 'liberado'}${dto.motivo ? ': ' + dto.motivo : ''}` });
    return r;
  }

  @Protegido('prestadores_editar')
  @Post('prestadores/bloqueio')
  async bloquear(@Body() dto: BloqueioDto, @Req() req: ReqUsuario) {
    const r = await this.geo.bloquear(dto, req.user.email);
    this.auditoria.registrar('CADASTRO_ALTERADO', {
      ip: req.ip, usuario: req.user.email,
      detalhe: `lista de bloqueio: ${dto.nomeCompleto}${dto.motivo ? ' — ' + dto.motivo : ''}; atingidos: ${r.atingidos.map((a) => `${a.tipo} ${a.nome}${a.equipe ? ' (equipe ' + a.equipe + ')' : ''}`).join(', ') || 'nenhum cadastro existente'}`,
    });
    return r;
  }

  @Protegido('prestadores_editar')
  @Post('prestadores/restritos/lista')
  async listaRestritos(@Body() dto: ListaRestritosDto, @Req() req: ReqUsuario) {
    const r = await this.geo.aplicarListaRestritos(dto.itens, req.user.email);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `lista de restritos: ${r.aplicados.length} aplicados, ${r.naoEncontrados.length} não encontrados, ${r.ambiguos.length} ambíguos` });
    return r;
  }

  @Protegido('prestadores_editar')
  @Patch('prestadores/:id')
  async atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PessoaDto, @Req() req: ReqUsuario) {
    const r = await this.geo.atualizarPrestador(id, dto);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `prestador ${id}: ${Object.keys(dto).join(', ')}` });
    return r;
  }

  @Protegido('prestadores_editar')
  @Post('prestadores/:id/membros')
  async novoMembro(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MembroDto, @Req() req: ReqUsuario) {
    const r = await this.geo.salvarMembro(id, null, dto);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `novo agente ${r.id} na equipe ${id}` });
    return r;
  }

  @Protegido('prestadores_editar')
  @Patch('prestadores/:id/membros/:membroId')
  async atualizarMembro(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membroId', ParseUUIDPipe) membroId: string,
    @Body() dto: MembroDto,
    @Req() req: ReqUsuario,
  ) {
    const r = await this.geo.salvarMembro(id, membroId, dto);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `agente ${membroId}: ${Object.keys(dto).join(', ')}` });
    return r;
  }
}

@Module({
  controllers: [GeoController],
  providers: [GeoService, GeocodificacaoService],
})
export class GeoModule {}
