/**
 * Classifica agora as conversas com mensagem nova ainda não processada.
 *
 *   npx ts-node -T scripts/processar-pendentes.ts [--limite 20]
 *
 * Serve quando a fila ficou para trás (reinício da API, Redis fora, rajada de
 * mensagens). Usa o mesmo serviço da fila, então as regras são idênticas.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClassificationService } from '../src/classification/classification.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const i = process.argv.indexOf('--limite');
  const limite = i > 0 ? Number(process.argv[i + 1]) || 20 : 20;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const classificacao = app.get(ClassificationService);

  const pendentes = await prisma.$queryRawUnsafe<{ id: string; groupName: string | null; novas: number }[]>(`
    select c.id, c."groupName", count(m.id)::int novas
      from "Conversation" c join "Message" m on m."conversationId" = c.id
     where m."sentAt" > coalesce(c."lastClassifiedAt", '1970-01-01') and c."isGroup"
     group by 1,2 order by max(m."sentAt") desc limit ${limite}`);

  console.log(`conversas com mensagem pendente: ${pendentes.length}`);
  for (const c of pendentes) {
    process.stdout.write(`  ${(c.groupName ?? c.id).slice(0, 34)} (${c.novas} msgs)... `);
    try {
      await classificacao.classifyConversation(c.id);
      console.log('ok');
    } catch (err) {
      console.log(`falhou: ${(err as Error).message}`);
    }
  }

  const depois = await prisma.$queryRawUnsafe<{ total: number }[]>(`
    select count(*)::int total from "Conversation" c join "Message" m on m."conversationId" = c.id
     where m."sentAt" > coalesce(c."lastClassifiedAt", '1970-01-01') and c."isGroup"`);
  console.log(`mensagens ainda pendentes: ${depois[0]?.total ?? 0}`);
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
