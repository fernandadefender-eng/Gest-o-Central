/**
 * Ajustes de 15/09 (regras confirmadas pela operação):
 * 1. Monitoramento trata SOMENTE eventos veiculares → tira da fila os eventos patrimoniais.
 * 2. Eventos da central ("Descrição do Evento / Painel Violado / ...") entram na fila,
 *    inclusive os que chegaram antes desta regra existir.
 * 3. Grupo de comprovantes/pagamentos é interno e alimenta o SAC.
 * 4. SAC do Alberto Fonseca (Recife, IDs 36259/36467): aberto como atendimento em
 *    atraso, com prioridade, e resolvido pelo comprovante postado às 16:36.
 */
import { PrismaClient } from '@prisma/client';
import { lerEventoTelemetria } from '../src/monitoramento/evento-telemetria';
import { prioridadePorTexto, tipoEventoVeicular } from '../src/monitoramento/prioridade';
import { ehGrupoFinanceiro } from '../src/sac/sac';

const prisma = new PrismaClient();

async function main() {
  // 1) Fila do Monitoramento: só veicular
  const patrimoniais = await prisma.evento.findMany({ where: { vertical: 'PATRIMONIAL' }, select: { id: true, tipo: true, atendimentoId: true } });
  if (patrimoniais.length) {
    const ids = patrimoniais.map((e) => e.id);
    await prisma.eventoTratativa.deleteMany({ where: { eventoId: { in: ids } } });
    await prisma.evento.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`Eventos patrimoniais removidos da fila: ${patrimoniais.length}`);

  // 2) Eventos da central que já estavam no histórico
  const msgs = await prisma.message.findMany({
    where: { content: { contains: 'Descrição do Evento', mode: 'insensitive' } },
    orderBy: { sentAt: 'asc' },
    include: { conversation: { select: { groupName: true } } },
  });
  let criados = 0;
  for (const m of msgs) {
    const ev = lerEventoTelemetria(m.content);
    if (!ev) continue;
    const tipo = tipoEventoVeicular(ev.descricao) ?? ev.descricao.slice(0, 80);
    const jaTem = await prisma.evento.findFirst({ where: { vertical: 'VEICULAR', tipo, placa: ev.placa ?? null, ocorridoEm: ev.ocorridoEm ?? null } });
    if (jaTem) continue;
    const descricao = [`${ev.descricao}${ev.placa ? ' — placa ' + ev.placa : ''}`, ev.cliente ? `Cliente: ${ev.cliente}` : null, ev.localizacao ? `Local: ${ev.localizacao}` : null]
      .filter(Boolean).join('\n');
    await prisma.evento.create({
      data: {
        origem: 'WHATSAPP', vertical: 'VEICULAR', tipo, prioridade: prioridadePorTexto(ev.descricao), descricao,
        clienteNome: ev.cliente ?? m.conversation?.groupName ?? null, placa: ev.placa ?? null, cidade: ev.cidade ?? null, uf: ev.uf ?? null,
        ocorridoEm: ev.ocorridoEm ?? null, recebidoEm: m.sentAt,
        tratativas: { create: { tipo: 'SISTEMA', texto: `Evento recebido da central no grupo "${m.conversation?.groupName ?? 'WhatsApp'}"`, usuario: 'sistema' } },
      },
    });
    criados++;
    console.log(`  + ${tipo} ${ev.placa ?? ''} ${ev.cliente ?? ''} (${ev.ocorridoEm?.toISOString() ?? 'sem data'})`);
  }
  console.log(`Eventos da central cadastrados: ${criados}`);

  // 3) Grupos de comprovante/pagamento são internos (não geram chamado)
  const grupos = await prisma.conversation.findMany({ where: { isGroup: true }, select: { id: true, groupName: true, tipoGrupo: true } });
  for (const g of grupos.filter((g) => ehGrupoFinanceiro(g.groupName) && g.tipoGrupo !== 'INTERNO')) {
    await prisma.conversation.update({ where: { id: g.id }, data: { tipoGrupo: 'INTERNO' } });
    console.log(`Grupo financeiro marcado como interno: ${g.groupName}`);
  }

  // 4) SAC do Alberto Fonseca — reclamação de atendimento em atraso, já resolvida
  const comprovante = await prisma.message.findFirst({ where: { content: { contains: 'Alberto Fonseca', mode: 'insensitive' } }, orderBy: { sentAt: 'asc' }, include: { conversation: { select: { groupName: true } } } });
  const jaExiste = await prisma.chamadoSac.findFirst({ where: { solicitante: { contains: 'Alberto', mode: 'insensitive' } } });
  if (!jaExiste) {
    const quando = comprovante?.sentAt ?? new Date();
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('sac_numero_seq') AS n`;
    const sac = await prisma.chamadoSac.create({
      data: {
        numero: Number(n),
        tipo: 'ATENDIMENTO_ATRASO', assunto: 'Atendimento em atraso — cobrança do prestador', prioridade: 'ALTA',
        descricao: 'Prestador Alberto Fonseca (Recife) informou atendimento em atraso e foi direcionado ao SAC, com prioridade.',
        solicitante: 'Alberto Fonseca', regiao: 'Recife/PE', idsCitados: ['36259', '36467'],
        grupo: comprovante?.conversation?.groupName ?? null, abertoEm: new Date(quando.getTime() - 30 * 60000),
        status: 'RESOLVIDO', resolvidoEm: quando, resolvidoPor: 'comprovante no WhatsApp',
        solucao: 'Comprovante de pagamento enviado pela supervisão (IDs 36259 e 36467).',
        tratativas: {
          create: [
            { tipo: 'SISTEMA', texto: 'Prestador cobrou atendimento em atraso — direcionado ao SAC com prioridade', usuario: 'sistema' },
            { tipo: 'COMPROVANTE', texto: `Comprovante de Alberto Fonseca / Recife / IDs 36259, 36467 postado em "${comprovante?.conversation?.groupName ?? 'WhatsApp'}"`, usuario: 'sistema' },
          ],
        },
      },
    });
    console.log(`SAC do Alberto registrado e resolvido: ${sac.id}`);
  } else console.log('SAC do Alberto já existia');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
