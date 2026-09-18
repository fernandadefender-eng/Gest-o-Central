/**
 * Recupera chamados cujo formulário de retorno ("ID: 36893 / Conta / Hr. de chegada…")
 * chegou pelo WhatsApp mas não virou registro.
 *
 * Causa (corrigida em 17/09/2026): a busca pela conta tinha dois OR no mesmo objeto e
 * trazia todos os chamados abertos da empresa ("confere com 121 chamados") — o sistema
 * desistia para não errar e o chamado nunca era cadastrado.
 *
 * Usa exatamente o mesmo caminho do sistema (registrarFormularioRetorno). Grupos sem
 * tipo definido não abrem chamado (regra): são só listados para a operação definir.
 *
 *   npx ts-node -T scripts/recuperar-formularios.ts [--aplicar]
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClassificationService } from '../src/classification/classification.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { lerFormularioRetorno } from '../src/whatsapp/formulario-retorno';

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const classificacao = app.get(ClassificationService) as unknown as {
    registrarFormularioRetorno: (form: unknown, grupo: string, quando: Date, remetente: string | null, conversationId: string, empresaId: string | null, grupoDoCliente: boolean) => Promise<string | null>;
  };

  const msgs = await prisma.message.findMany({
    where: { content: { contains: 'ID', mode: 'insensitive' } },
    orderBy: { sentAt: 'asc' },
    select: { id: true, content: true, sentAt: true, senderName: true, conversationId: true, conversation: { select: { groupName: true, tipoGrupo: true, empresaId: true } } },
  });

  const semTipo = new Map<string, Set<string>>();
  let recuperados = 0, jaExistiam = 0, incompletos = 0;
  for (const m of msgs) {
    const form = lerFormularioRetorno(m.content);
    const id = form?.campos.id;
    if (!form || !id || !form.ehRetorno) continue;
    if (await prisma.atendimento.findFirst({ where: { idPR7: id }, select: { id: true } })) { jaExistiam++; continue; }
    const grupo = m.conversation.groupName ?? 'conversa';
    const tipo = m.conversation.tipoGrupo;
    if (!tipo) {
      if (!semTipo.has(grupo)) semTipo.set(grupo, new Set());
      semTipo.get(grupo)!.add(id);
      continue;
    }
    console.log(`${id} · ${grupo} (${tipo}) · ${m.sentAt.toISOString().slice(0, 16)} · ${form.completo ? 'completo' : 'faltando: ' + form.faltando.join(', ')}`);
    if (!form.completo) { incompletos++; continue; }
    if (!aplicar) continue;
    const r = await classificacao.registrarFormularioRetorno(form, grupo, m.sentAt, m.senderName, m.conversationId, m.conversation.empresaId, tipo === 'CLIENTE');
    if (r) recuperados++;
  }

  console.log(`\nrecuperados: ${recuperados} · já existiam: ${jaExistiam} · incompletos (não cadastra sozinho): ${incompletos}`);
  if (semTipo.size) {
    console.log('\nGrupos SEM TIPO definido (regra: não abrem chamado) — definir em Monitoramento → Grupos:');
    for (const [g, ids] of semTipo) console.log(`  "${g}" — IDs ${[...ids].join(', ')}`);
  }
  if (!aplicar) console.log('\n(simulação — rode com --aplicar para efetivar)');
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
