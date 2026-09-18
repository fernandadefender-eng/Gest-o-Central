import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AtendimentoStatus, MotivoNaoAtendimento } from '@prisma/client';

const limpar = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.replace(/[ \t]+/g, ' ').trim();
  return v === '' ? null : v;
};
const digitos = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return v === '' ? null : v;
};
/** Campo de data que também aceita "" (limpar o horário) */
const dataOuNulo = ({ value }: { value: unknown }) => (value === '' || value === null ? null : value);

/**
 * Edição do chamado direto no painel (linha expandida em Atendimentos).
 * Todo campo é opcional: só chega o que a operação mudou. Enviar "" limpa o campo.
 */
export class EdicaoAtendimentoDto {
  @IsOptional() @IsEnum(AtendimentoStatus) status?: AtendimentoStatus;
  // Valor ao prestador ajustado à mão (local difícil etc.): só quem tem "valores"; nunca é recalculado
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) valorPrestador?: number | null;

  // Motivo só faz sentido quando não foi concluído; null limpa
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEnum(MotivoNaoAtendimento) motivo?: MotivoNaoAtendimento | null;

  @IsOptional() @Transform(limpar) @IsString() @MaxLength(500) detalheNaoAtendimento?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(80) category?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(40) ocorrencia?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(20) idPR7?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(40) codigoValidacao?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(40) sap?: string | null;

  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) || null : value))
  @IsString() @MaxLength(7) placa?: string | null;

  @IsOptional() @Transform(limpar) @IsString() @MaxLength(80) operadorPR7?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(120) agenteNome?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(120) responsavelLocalNome?: string | null;

  @IsOptional() @Transform(digitos) @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{10,11}$/, { message: 'Telefone do responsável deve ter DDD + número' })
  responsavelLocalTelefone?: string | null;

  @IsOptional() @Transform(limpar) @IsString() @MaxLength(4000) summary?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(2000) resultado?: string | null;
  @IsOptional() @Transform(limpar) @IsString() @MaxLength(2000) observacaoInterna?: string | null;

  @IsOptional() @Transform(dataOuNulo) @ValidateIf((_, v) => v !== null) @IsISO8601() solicitadoEm?: string | null;
  @IsOptional() @Transform(dataOuNulo) @ValidateIf((_, v) => v !== null) @IsISO8601() autorizacaoPedidaEm?: string | null;
  @IsOptional() @Transform(dataOuNulo) @ValidateIf((_, v) => v !== null) @IsISO8601() liberadoEm?: string | null;
  @IsOptional() @Transform(dataOuNulo) @ValidateIf((_, v) => v !== null) @IsISO8601() acionadoEm?: string | null;
  @IsOptional() @Transform(dataOuNulo) @ValidateIf((_, v) => v !== null) @IsISO8601() chegadaEm?: string | null;
  @IsOptional() @Transform(dataOuNulo) @ValidateIf((_, v) => v !== null) @IsISO8601() concluidoEm?: string | null;

  @IsOptional() @IsIn(['PATRIMONIAL', 'VEICULAR']) vertical?: 'PATRIMONIAL' | 'VEICULAR';
}
