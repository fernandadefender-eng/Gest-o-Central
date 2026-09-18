/**
 * Todo acionamento precisa de um identificador.
 *
 * - Chamado que veio com o **ID PR7** (coluna "Id" da planilha ou citado no WhatsApp)
 *   continua sendo identificado por ele — é a chave que liga comprovante e retorno.
 * - Chamado anterior ao sistema, ou que chegou sem ID, recebe um **ID interno**
 *   no formato `PR7-H-000001` (H de histórico), único e estável.
 * - Evento de tratativa (os da central, tipo Cordenonsi) recebe `EV-AAAA-000001`.
 *
 * Antes de numerar, descarta a linha que não é atendimento: veio da aba desalinhada
 * de 2024 e tem hora/data no lugar do nome do cliente.
 *
 *   npx ts-node -T scripts/gerar-ids-internos.ts [--aplicar]
 */
import { PrismaClient } from '@prisma/client';
import { proximoIdInterno } from '../src/atendimentos/identificador';

const prisma = new PrismaClient();
const aplicar = process.argv.includes('--aplicar');

/** "06:00:00", "1899-12-30T05:57:00.000Z", "45292" não são nome de cliente. */
const ehLixo = (nome: string) =>
  /^\d{1,2}:\d{2}(:\d{2})?$/.test(nome.trim()) ||
  /^1899-12-30/.test(nome.trim()) ||
  /^\d{4,6}$/.test(nome.trim()) ||
  nome.trim().length < 3;

async function main() {
  // 1) Linhas que não são atendimento
  const semId = await prisma.atendimento.findMany({
    where: { idPR7: null, idInterno: null },
    select: { id: true, solicitadoEm: true, createdAt: true, conversationId: true, client: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const lixo = semId.filter((a) => !a.conversationId && ehLixo(a.client.name));
  const validos = semId.filter((a) => !lixo.includes(a));
  console.log(`sem identificador: ${semId.length} · descartáveis (linha quebrada da planilha): ${lixo.length} · a numerar: ${validos.length}`);
  for (const a of lixo.slice(0, 5)) console.log(`   descartar: "${a.client.name}" (${a.solicitadoEm?.toISOString().slice(0, 10) ?? 'sem data'})`);

  if (aplicar && lixo.length) {
    await prisma.midia.updateMany({ where: { atendimentoId: { in: lixo.map((a) => a.id) } }, data: { atendimentoId: null } });
    await prisma.pagamentoAtendimento.updateMany({ where: { atendimentoId: { in: lixo.map((a) => a.id) } }, data: { atendimentoId: null } });
    await prisma.eventoTratativa.deleteMany({ where: { evento: { atendimentoId: { in: lixo.map((a) => a.id) } } } });
    await prisma.evento.deleteMany({ where: { atendimentoId: { in: lixo.map((a) => a.id) } } });
    await prisma.atendimento.deleteMany({ where: { id: { in: lixo.map((a) => a.id) } } });
    console.log(`removidos: ${lixo.length}`);
  }

  // 2) ID interno dos atendimentos — da sequência do banco (nunca repete)
  const numerar = aplicar ? validos : [];
  let ultimoGerado = '';
  for (const a of numerar) {
    ultimoGerado = await proximoIdInterno(prisma);
    await prisma.atendimento.update({ where: { id: a.id }, data: { idInterno: ultimoGerado } });
  }
  if (aplicar) console.log(`atendimentos numerados: ${numerar.length}${ultimoGerado ? ` (até ${ultimoGerado})` : ''}`);

  // 3) ID dos eventos de tratativa (Cordenonsi e demais)
  const eventos = await prisma.evento.findMany({ where: { idInterno: null }, select: { id: true, recebidoEm: true }, orderBy: { recebidoEm: 'asc' } });
  console.log(`eventos sem identificador: ${eventos.length}`);
  if (aplicar) {
    const contador = new Map<number, number>();
    for (const e of eventos) {
      const ano = (e.recebidoEm ?? new Date()).getUTCFullYear();
      if (!contador.has(ano)) {
        const ultimoDoAno = await prisma.evento.findFirst({
          where: { idInterno: { startsWith: `EV-${ano}-` } }, orderBy: { idInterno: 'desc' }, select: { idInterno: true },
        });
        contador.set(ano, ultimoDoAno ? Number(ultimoDoAno.idInterno!.split('-')[2]) + 1 : 1);
      }
      const n = contador.get(ano)!;
      contador.set(ano, n + 1);
      await prisma.evento.update({ where: { id: e.id }, data: { idInterno: `EV-${ano}-${String(n).padStart(6, '0')}` } });
    }
    console.log(`eventos numerados: ${eventos.length}`);
  }

  const resumo = await prisma.$queryRawUnsafe<{ com_pr7: number; com_interno: number; sem_nada: number }[]>(
    `select count("idPR7")::int com_pr7, count("idInterno")::int com_interno,
            count(*) filter (where "idPR7" is null and "idInterno" is null)::int sem_nada from "Atendimento"`);
  console.table(resumo);
  console.log(aplicar ? '\nAplicado.' : '\nSimulação — rode com --aplicar para gravar.');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
