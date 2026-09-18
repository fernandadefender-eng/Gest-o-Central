import { Transform, Type } from 'class-transformer';
import {
  IsEnum, IsIn, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { AtendimentoStatus, Vertical } from '@prisma/client';

const limpar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

class NovaContaDto {
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(60) codigo?: string;
  @Transform(limpar) @IsString() @Length(2, 160) estabelecimento!: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(240) endereco?: string;
  @Transform(limpar) @IsString() @Length(2, 120) cidade!: string;
  @Transform(({ value }) => String(value ?? '').toUpperCase()) @Matches(/^[A-Z]{2}$/) estado!: string;
}

/**
 * Registro manual de ocorrência (formulário "Nova ocorrência").
 * Só o essencial é obrigatório; o resto é opcional e vai em `detalhes`.
 */
export class NovaOcorrenciaDto {
  @IsEnum(Vertical) vertical!: Vertical;

  // Cliente: existente (clienteId) ou novo (clienteNome)
  @ValidateIf((o) => !o.clienteNome) @IsUUID() clienteId?: string;
  @ValidateIf((o) => !o.clienteId) @Transform(limpar) @IsString() @Length(2, 160) clienteNome?: string;

  // Patrimonial: conta existente ou nova
  @IsOptional() @IsUUID() contaId?: string;
  @IsOptional() @ValidateNested() @Type(() => NovaContaDto) novaConta?: NovaContaDto;

  @IsOptional() @Transform(limpar) @IsString() @MaxLength(60) ocorrencia?: string;
  @Transform(limpar) @IsString() @Length(2, 80) tipoServico!: string;
  @Transform(limpar) @IsString() @Length(3, 2000) motivo!: string;
  @IsOptional() @IsEnum(AtendimentoStatus) status?: AtendimentoStatus;

  @IsOptional() @IsUUID() prestadorId?: string;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(120) agenteNome?: string;

  // Local (Veicular informa direto; Patrimonial herda da conta)
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(120) cidade?: string;
  @IsOptional() @Transform(({ value }) => (value ? String(value).toUpperCase() : value)) @Matches(/^[A-Z]{2}$/) estado?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;

  @IsOptional() @Transform(({ value }) => (value ? String(value).toUpperCase().replace(/[^A-Z0-9]/g, '') : value)) @Matches(/^[A-Z0-9]{7}$/, { message: 'Placa inválida' }) placa?: string;

  // Valores: só gravados se o usuário tiver a permissão "valores"
  @IsOptional() @IsNumber() valorPrestador?: number;
  @IsOptional() @IsNumber() valorCliente?: number;

  /**
   * Campos específicos da vertical: checklist da vistoria, horários, veículo,
   * carreta, KM, franquia, descrição dos fatos, gastos... (ver docs/formulario-ocorrencia.md)
   * "observacaoInterna" nunca vai para relatório de cliente.
   */
  @IsOptional() @IsObject() detalhes?: Record<string, unknown>;

  @IsOptional() @IsIn(['WHATSAPP', 'TELEFONE', 'EMAIL', 'SISTEMA_CLIENTE', 'OUTRO']) canal?: string;
}
