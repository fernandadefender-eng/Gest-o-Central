/**
 * Recupera eventos de monitoramento que ficaram de fora da fila porque o leitor antigo
 * não entendia o formato ("Descrição do Evento:" com dois-pontos, ou "Evento:/Veículo:").
 * Relê TODAS as mensagens, cria só os eventos veiculares que faltam (dedup por
 * tipo+placa+ocorridoEm, igual ao fluxo normal). Só cria — não apaga nada.
 * Uso: npx ts-node -T scripts/recuperar-eventos-perdidos.ts
 */
import { PrismaClient } from '@prisma/client';
import { lerEventoTelemetria } from '../src/monitoramento/evento-telemetria';
import { tipoEventoVeicular } from '../src/monitoramento/prioridade';
import { prioridadePorTexto } from '../src/monitoramento/prioridade';

const prisma = new PrismaClient();

async function proximoIdEvento(quando: Date): Promise<string> {
  const ano = quando.getUTCFullYear();
  const ultimo = await prisma.evento.findFirst({ where: { idInterno: { startsWith: `EV-${ano}-` } }, orderBy: { idInterno: 'desc' }, select: { idInterno: true } });
  const n = ultimo ? Number(ultimo.idInterno!.split('-')[2]) + 1 : 1;
  return `EV-${ano}-${String(n).padStart(6, '0')}`;
}

async function main() {
  const msgs = await prisma.message.findMany({
    where: { content: { contains: 'vento', mode: 'insensitive' } },
    select: { id: true, content: true, sentAt: true, conversation: { select: { groupName: true } } },
    orderBy: { sentAt: 'asc' },
  });
  let lidos = 0, criados = 0, jaExistiam = 0, naoMonit = 0;
  for (const m of msgs) {
    const ev = lerEventoTelemetria(m.content ?? '');
    if (!ev) continue;
    lidos++;
    const tipo = tipoEventoVeicular(ev.descricao);
    if (!tipo) { naoMonit++; continue; } // roubo/furto etc. → atendimento, não evento
    const jaTem = await prisma.evento.findFirst({ where: { origem: 'WHATSAPP', vertical: 'VEICULAR', tipo, placa: ev.placa ?? null, ocorridoEm: ev.ocorridoEm ?? null } });
    if (jaTem) { jaExistiam++; continue; }
    const grupo = m.conversation?.groupName ?? null;
    const descricao = [`${ev.descricao}${ev.placa ? ' — placa ' + ev.placa : ''}`, ev.cliente ? `Cliente: ${ev.cliente}` : null, ev.localizacao ? `Local: ${ev.localizacao}` : null].filter(Boolean).join('\n');
    const e = await prisma.evento.create({
      data: {
        idInterno: await proximoIdEvento(m.sentAt),
        origem: 'WHATSAPP', vertical: 'VEICULAR', tipo, prioridade: prioridadePorTexto(ev.descricao),
        descricao, clienteNome: ev.cliente ?? grupo ?? null, placa: ev.placa ?? null,
        cidade: ev.cidade ?? null, uf: ev.uf ?? null, ocorridoEm: ev.ocorridoEm ?? null, recebidoEm: m.sentAt,
        tratativas: { create: { tipo: 'SISTEMA', texto: `Evento recuperado (leitor corrigido) do grupo "${grupo ?? 'WhatsApp'}"`, usuario: 'sistema' } },
      },
    });
    criados++;
    console.log(`+ ${e.idInterno}: ${tipo} ${ev.placa ?? ''} · ${ev.cliente ?? grupo ?? ''} · ${ev.ocorridoEm?.toISOString().slice(0, 16) ?? 's/data'}`);
  }
  console.log(`\nMensagens de evento lidas: ${lidos} · criados agora: ${criados} · já existiam: ${jaExistiam} · não são de monitoramento (roubo/furto): ${naoMonit}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
