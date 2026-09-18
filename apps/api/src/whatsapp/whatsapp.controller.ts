import { Body, Controller, ForbiddenException, Get, HttpCode, Ip, Logger, Post, Query } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WhatsappService } from './whatsapp.service';
import { ZApiWebhookDto } from './dto/zapi-webhook.dto';
import { segredoConfere, segredoObrigatorio } from '../seguranca/seguranca';
import { AuditoriaService } from '../seguranca/seguranca.module';

@Controller('webhooks/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger('Webhook');

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Aberto no navegador (ou testado pela Z-API com GET): confirma que está no ar, sem nenhum dado
  @Get()
  status() {
    return { ok: true, servico: 'webhook PR7 ativo' };
  }

  // Recebe o corpo cru (tipo genérico = o ValidationPipe global não interfere) e valida aqui:
  // chamada de teste da Z-API ou evento em formato diferente responde 200 e é só registrada.
  // Responder erro fazia a Z-API considerar o endereço inválido e não entregar nada.
  @Post()
  @HttpCode(200)
  async handle(@Body() corpo: Record<string, unknown>, @Ip() ip: string, @Query('token') token?: string) {
    // Sem WEBHOOK_TOKEN no .env a API nem sobe — antes, token ausente dos dois lados passava.
    // Na troca do token, WEBHOOK_TOKEN_ANTERIOR segue aceito até a Z-API passar a usar o
    // novo (nenhuma mensagem é recusada no meio da troca); depois é removido do .env.
    const anterior = process.env.WEBHOOK_TOKEN_ANTERIOR?.trim();
    const novo = segredoConfere(token, segredoObrigatorio('WEBHOOK_TOKEN'));
    const peloAnterior = !novo && !!anterior && anterior.length >= 24 && segredoConfere(token, anterior);
    // Sinal para concluir a troca: enquanto aparecer, a Z-API ainda usa o token antigo
    if (peloAnterior) this.logger.warn('Webhook entregue com o token ANTERIOR — a Z-API ainda não passou para o novo');
    const confere = novo || peloAnterior;
    if (!confere) {
      this.auditoria.registrar('WEBHOOK_RECUSADO', { ip, detalhe: token ? 'token incorreto' : 'sem token' });
      throw new ForbiddenException('Token de webhook inválido');
    }

    const dto = plainToInstance(ZApiWebhookDto, corpo ?? {});
    const erros = await validate(dto, { whitelist: true });
    if (erros.length) {
      // Só nomes de campos e tipo do evento, nunca o conteúdo
      const tipo = typeof corpo?.type === 'string' ? corpo.type : '?';
      this.logger.warn(`Evento ignorado (type=${tipo}): campos fora do esperado ${erros.map((e) => e.property).join(', ')} · recebidos: ${Object.keys(corpo ?? {}).slice(0, 25).join(',')}`);
      return { ok: true, ignorado: true };
    }
    return this.whatsappService.handleIncoming(dto);
  }
}
