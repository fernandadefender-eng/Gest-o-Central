import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AuditoriaService } from './seguranca/seguranca.module';
import { cabecalhosDeSeguranca, limitePorIp, segredoObrigatorio, somenteWebhookPeloTunel } from './seguranca/seguranca';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Falha na hora se faltar segredo, em vez de descobrir no primeiro acesso
  segredoObrigatorio('JWT_SECRET', 32);
  segredoObrigatorio('WEBHOOK_TOKEN');

  app.disable('x-powered-by');
  const auditoria = app.get(AuditoriaService);
  app.use(limitePorIp((ip) => auditoria.registrar('LIMITE_EXCEDIDO', { ip })));
  // Túnel público do webhook: nada além do webhook responde para fora
  app.use(somenteWebhookPeloTunel((ip, caminho) => auditoria.registrar('WEBHOOK_RECUSADO', { ip, detalhe: `acesso externo bloqueado: ${caminho.slice(0, 120)}` })));
  app.use(cabecalhosDeSeguranca);
  // Webhook recusado por formato (400) passaria em silêncio e a mensagem se perderia
  app.use((req: { path: string }, res: { statusCode: number; on(e: string, f: () => void): void }, next: () => void) => {
    if (req.path === '/webhooks/whatsapp') {
      res.on('finish', () => { if (res.statusCode >= 400) console.warn(`[Webhook] resposta ${res.statusCode} — conferir formato do payload da Z-API`); });
    }
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (erros) => {
      // Webhook da Z-API fora do formato esperado: registra QUAIS campos falharam (nunca o conteúdo)
      if (erros[0]?.target?.constructor?.name === 'ZApiWebhookDto') {
        console.log(`[Webhook] payload recusado na validação: ${erros.map((e) => `${e.property}(${Object.keys(e.constraints ?? {}).join('/')})`).join(', ')}`);
      }
      return new BadRequestException(erros.flatMap((e) => Object.values(e.constraints ?? {})));
    },
  }));

  // O painel é servido pela própria API (mesma origem), então CORS fica fechado.
  // Para liberar outro domínio: CORS_ORIGINS="https://painel.exemplo.com,https://outro.com"
  const origens = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  if (origens?.length) app.enableCors({ origin: origens });

  // Painel servido por http (e não aberto como arquivo): o OpenStreetMap bloqueia
  // mapas carregados de file://, pois exige a origem da página.
  // no-cache: o navegador sempre confere se há versão nova do painel (senão fica
  // mostrando textos antigos depois de uma atualização)
  app.useStaticAssets(join(__dirname, '..', '..', '..', 'admin'), {
    prefix: '/painel',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  });

  // 127.0.0.1 por padrão: só este computador acessa. O webhook do WhatsApp chega
  // pelo túnel (cloudflared), que também roda local. HOST=0.0.0.0 abre para a rede.
  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  console.log(`API rodando em http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
}

bootstrap();
