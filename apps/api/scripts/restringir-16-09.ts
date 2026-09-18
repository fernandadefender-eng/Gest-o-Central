/**
 * Restrições confirmadas pela operação em 16/09/2026:
 * - Hebert Bertolazze (Joinville/SC, 47 9236-6012)
 * - Lucas Gomes (Joinville/SC) — atuou no mesmo atendimento
 * Nenhum dos dois tem cadastro de prestador/agente: entram na lista de bloqueio
 * (barra sugestão, acionamento e importação, mesmo sem cadastro).
 * Guardamos só nome, telefone, região e motivo — nada de documentos ou dados bancários.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MOTIVO = 'Restrição da operação — não pode ser acionado';
const QUEM = 'operação (confirmado em 16/09/2026)';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function bloquear(nomeCompleto: string, telefone: string | null, regiao: string) {
  const nomeBusca = semAcento(nomeCompleto);
  const jaTem = await prisma.restrito.findFirst({ where: { OR: [{ nomeBusca }, ...(telefone ? [{ telefone }] : [])] } });
  if (jaTem) {
    await prisma.restrito.update({ where: { id: jaTem.id }, data: { ativo: true, motivo: MOTIVO, regiao, telefone: telefone ?? jaTem.telefone } });
    console.log(`atualizado: ${nomeCompleto}`);
    return;
  }
  await prisma.restrito.create({
    data: { nomeCompleto, nomeBusca, telefone, regiao, motivo: MOTIVO, origem: 'WhatsApp da operação', criadoPor: QUEM },
  });
  console.log(`restrito: ${nomeCompleto}${telefone ? ' · ' + telefone : ''} · ${regiao}`);
}

async function main() {
  await bloquear('Hebert Bertolazze', '4792366012', 'Joinville/SC');
  await bloquear('Lucas Gomes', null, 'Joinville/SC');

  // Se algum dia forem cadastrados com esse nome, o cadastro também fica restrito
  for (const nome of ['Hebert Bertolazze', 'Lucas Gomes']) {
    const p = await prisma.provider.findFirst({ where: { name: { equals: nome, mode: 'insensitive' } } });
    if (p) {
      await prisma.provider.update({ where: { id: p.id }, data: { status: 'RESTRITO', motivoRestricao: MOTIVO, restritoEm: new Date(), restritoPor: QUEM } });
      console.log(`prestador cadastrado também restrito: ${nome}`);
    }
  }

  const lista = await prisma.restrito.findMany({ where: { ativo: true }, orderBy: { criadoEm: 'desc' }, select: { nomeCompleto: true, telefone: true, regiao: true, motivo: true } });
  console.log(`\n--- lista de bloqueio (${lista.length}) ---`);
  for (const r of lista) console.log(`${r.nomeCompleto}${r.telefone ? ' · ' + r.telefone : ''}${r.regiao ? ' · ' + r.regiao : ''} — ${r.motivo ?? ''}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
