import { IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

// Webhook "Ao receber" da Z-API. Campos não usados são descartados pelo
// ValidationPipe (whitelist). Confirmar contra o primeiro payload real.
export class ZApiWebhookDto {
  // Em conversa 1-a-1: telefone do contato. Em grupo: id do grupo ("1203...-group").
  @IsString()
  phone: string;

  // Nome do contato ou do grupo
  @IsOptional()
  @IsString()
  chatName?: string;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  // Em grupo: telefone de quem enviou a mensagem (diferente do id do grupo)
  @IsOptional()
  @IsString()
  participantPhone?: string;

  // Nome de quem enviou
  @IsOptional()
  @IsString()
  senderName?: string;

  @IsBoolean()
  fromMe: boolean;

  @IsNumber()
  momment: number;

  @IsOptional()
  @IsString()
  messageId?: string;

  // Tipo do evento (ex: ReceivedCallback)
  @IsOptional()
  @IsString()
  type?: string;

  // Status do WhatsApp, canais e listas de transmissão: fora da operação
  @IsOptional()
  @IsBoolean()
  isStatusReply?: boolean;

  @IsOptional()
  @IsBoolean()
  isNewsletter?: boolean;

  @IsOptional()
  @IsBoolean()
  broadcast?: boolean;

  @IsOptional()
  @IsBoolean()
  isEdit?: boolean;

  // Conteúdo: só um destes vem preenchido por mensagem
  @IsOptional() @IsObject() text?: { message?: string };
  @IsOptional() @IsObject() image?: { caption?: string; imageUrl?: string; mimeType?: string };
  @IsOptional() @IsObject() video?: { caption?: string; videoUrl?: string; mimeType?: string };
  @IsOptional() @IsObject() document?: { caption?: string; fileName?: string; title?: string; documentUrl?: string; mimeType?: string };
  @IsOptional() @IsObject() audio?: { audioUrl?: string; seconds?: number; mimeType?: string };
  @IsOptional() @IsObject() location?: { latitude?: number; longitude?: number; address?: string; name?: string };
  @IsOptional() @IsObject() contact?: { displayName?: string; phones?: string[] };
  @IsOptional() @IsObject() sticker?: Record<string, unknown>;
  @IsOptional() @IsObject() reaction?: Record<string, unknown>;

  // Evento de sistema do grupo (entrou/saiu/mudou nome) — sem conteúdo útil
  @IsOptional() @IsString() notification?: string;

  // Mensagem apagada/editada: a Z-API aponta para a mensagem original
  @IsOptional() @IsString() referenceMessageId?: string;
  @IsOptional() @IsString() editMessageId?: string;
  @IsOptional() @IsBoolean() isDeleted?: boolean;
  @IsOptional() @IsBoolean() waitingMessage?: boolean;
}
