/**
 * Reorganiza as fotos já ligadas em grupos com vários chamados (ORSEGUPS, SEGURPRO...).
 *
 * Até 18/09/2026, ao nascer um chamado o sistema pegava TODAS as fotos soltas do grupo,
 * e a foto que chegava ia para o chamado aberto mais recente — em grupo com ocorrências
 * em paralelo, fotos de uma ocorrência iam para outra (ex: ID 36897 com fotos do
 * O Boticário e de Ipatinga). Aqui cada foto é reavaliada com a regra certa:
 *   1) legenda com o nº da ocorrência/ID de um chamado → vai para ele;
 *   2) legenda citando ocorrência que não é de nenhum chamado do grupo → fica solta;
 *   3) senão, só liga se houver UM chamado na janela do horário da foto;
 *   4) ambíguo → fica solta, e o Help Desk liga pela ficha ("Fotos soltas do grupo").
 *
 * Padrão: só os passos 1 e 2 (com prova na legenda). --janela liga também o passo 3.
 *
 * Grupo com um chamado só não é mexido. Fotos ligadas pelo retorno do prestador
 * (mesmo remetente do formulário) seguem a mesma regra.
 *
 *   npx ts-node -T scripts/reorganizar-fotos.ts            (simulação)
 *   npx ts-node -T scripts/reorganizar-fotos.ts --aplicar
 */
import { PrismaClient } from '@prisma/client';
import { janelaDoChamado } from '../src/midias/midias.module';

const prisma = new PrismaClient();

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const conversas = await prisma.conversation.findMany({
    where: { atendimentos: { some: {} } },
    select: { id: true, groupName: true, atendimentos: { select: { id: true, idPR7: true, idInterno: true, ocorrencia: true, solicitadoEm: true, createdAt: true, chegadaEm: true, concluidoEm: true, encerradoEm: true, conta: { select: { codigo: true } } } } },
  });

  let mantidas = 0, movidas = 0, soltas = 0, ligadasAgora = 0;
  const porChamado = new Map<string, { saem: number; entram: number }>();
  const nomeDe = (id: string | null, lista: { id: string; idPR7: string | null; idInterno: string | null }[]) => {
    if (!id) return 'solta';
    const a = lista.find((x) => x.id === id);
    return a ? (a.idPR7 ?? a.idInterno ?? a.id.slice(0, 8)) : id.slice(0, 8);
  };

  for (const c of conversas) {
    if (c.atendimentos.length < 2) continue;
    const midias = await prisma.midia.findMany({
      where: { conversationId: c.id },
      select: { id: true, atendimentoId: true, recebidaEm: true, legenda: true, message: { select: { content: true } } },
      orderBy: { recebidaEm: 'asc' },
    });
    const mudancas: string[] = [];
    for (const m of midias) {
      const t = +m.recebidaEm;
      const texto = `${m.legenda ?? ''} ${m.message?.content ?? ''}`;
      const numeros = [...texto.matchAll(/#?(\d{4,10})/g)].map((n) => n[1]);
      const pelaOcorrencia = numeros.length
        ? c.atendimentos.filter((a) => (a.ocorrencia && numeros.includes(a.ocorrencia)) || (a.idPR7 && numeros.includes(a.idPR7)) || (a.conta?.codigo && numeros.includes(a.conta.codigo)))
        : [];
      const citaOutra = /ocorr[eê]ncia\s*#?\s*\d{5,}/i.test(texto) && numeros.length > 0 && !pelaOcorrencia.length;
      const dentro = (a: (typeof c.atendimentos)[number]) => { const j = janelaDoChamado(a); return t >= j.inicio && t <= j.fim; };
      const naJanela = c.atendimentos.filter(dentro);
      const atual = c.atendimentos.find((a) => a.id === m.atendimentoId);
      // Prova pelo horário: a foto está FORA da janela do chamado em que está (ex: foto do
      // dia 17 na ronda do dia 15) → sai dele; vai para o único chamado cuja janela a contém.
      // Só age com PROVA na legenda: nº da ocorrência/ID de um chamado do grupo, ou citação
      // de ocorrência que não é de nenhum chamado daqui. Sem prova, deixa como está — a
      // janela de horário não é confiável nos registros antigos (horários errados) e o
      // Help Desk confere pela ficha. (--janela usa também a regra do horário.)
      const usarJanela = process.argv.includes('--janela');
      const foraDoAtual = atual ? !dentro(atual) : false;
      const decisao = pelaOcorrencia.length === 1 ? pelaOcorrencia[0].id
        : citaOutra ? null
        : foraDoAtual ? (naJanela.length === 1 ? naJanela[0].id : null)
        : !atual && usarJanela ? (naJanela.length === 1 ? naJanela[0].id : null)
        : m.atendimentoId;

      if (decisao === m.atendimentoId) { mantidas++; continue; }
      if (m.atendimentoId && decisao) movidas++;
      else if (m.atendimentoId && !decisao) soltas++;
      else ligadasAgora++;
      if (m.atendimentoId) { const x = porChamado.get(m.atendimentoId) ?? { saem: 0, entram: 0 }; x.saem++; porChamado.set(m.atendimentoId, x); }
      if (decisao) { const x = porChamado.get(decisao) ?? { saem: 0, entram: 0 }; x.entram++; porChamado.set(decisao, x); }
      const motivo = pelaOcorrencia.length === 1 ? 'nº na legenda' : citaOutra ? 'cita outra ocorrência'
        : `fora do horário do chamado · ${naJanela.length === 1 ? 'único chamado no horário' : naJanela.length ? naJanela.length + ' chamados no horário' : 'nenhum chamado no horário'}`;
      mudancas.push(`   ${m.recebidaEm.toISOString().slice(5, 16).replace('T', ' ')} ${nomeDe(m.atendimentoId, c.atendimentos)} → ${nomeDe(decisao, c.atendimentos)} (${motivo})`);
      if (aplicar) await prisma.midia.update({ where: { id: m.id }, data: { atendimentoId: decisao } });
    }
    if (mudancas.length) {
      console.log(`\n${c.groupName} — ${c.atendimentos.length} chamados, ${midias.length} mídias, ${mudancas.length} mudanças`);
      for (const l of mudancas.slice(0, process.argv.includes("--tudo") ? 9999 : 40)) console.log(l);
      if (mudancas.length > 40) console.log(`   ... e mais ${mudancas.length - 40}`);
    }
  }
  console.log(`\nmantidas: ${mantidas} · trocam de chamado: ${movidas} · ficam soltas (ambíguas): ${soltas} · soltas que agora ligam: ${ligadasAgora}`);
  if (!aplicar) console.log('(simulação — rode com --aplicar para efetivar)');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
