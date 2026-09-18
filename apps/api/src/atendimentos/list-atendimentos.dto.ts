import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AtendimentoStatus, Vertical } from '@prisma/client';

export class ListAtendimentosDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsEnum(AtendimentoStatus)
  status?: AtendimentoStatus;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(Vertical)
  vertical?: Vertical;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Texto procurado (ID, cliente, estabelecimento, técnico, operador...) */
  @IsOptional() @IsString() @MaxLength(80)
  busca?: string;

  /** Onde procurar; "tudo" varre todos os campos da lista */
  @IsOptional()
  @IsIn(['tudo', 'id', 'cliente', 'estabelecimento', 'tecnico', 'operador', 'cidade', 'placa'])
  campo?: 'tudo' | 'id' | 'cliente' | 'estabelecimento' | 'tecnico' | 'operador' | 'cidade' | 'placa';
}
