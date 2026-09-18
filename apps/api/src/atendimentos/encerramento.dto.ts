import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { MotivoNaoAtendimento } from '@prisma/client';

const limpar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

/** Fechamento do chamado: concluído, cancelado ou não atendido (com motivo obrigatório). */
export class EncerramentoDto {
  @IsIn(['CONCLUIDO', 'CANCELADO', 'NAO_ATENDIDO']) status!: 'CONCLUIDO' | 'CANCELADO' | 'NAO_ATENDIDO';

  @ValidateIf((o) => o.status !== 'CONCLUIDO')
  @IsEnum(MotivoNaoAtendimento, { message: 'Informe o motivo do não atendimento' })
  motivo?: MotivoNaoAtendimento;

  @IsOptional() @Transform(limpar) @IsString() @MaxLength(1000) detalhe?: string;

  // Negativa: qual prestador recusou
  @IsOptional() @IsUUID() recusadoPorId?: string;
}

/** Marca uma etapa da linha do tempo com o horário atual (ou o informado). */
export class MarcoDto {
  @IsIn(['acionado', 'chegada', 'concluido']) marco!: 'acionado' | 'chegada' | 'concluido';
  @IsOptional() @IsString() quando?: string;
}
