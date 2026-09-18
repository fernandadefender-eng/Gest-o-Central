/**
 * Revisão manual dos atendimentos de 15/09/2026 (aprovada pelo usuário).
 * Corrige status, desfecho do evento e resumo operacional dos chamados que a IA
 * deixou em andamento ou com resumo misturado. Não usa IA (custo zero) e registra
 * cada correção como tratativa do evento.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { lerDivulgacao } from '../src/whatsapp/formulario-retorno';

const prisma = new PrismaClient();
const REVISOR = 'revisão 15/09';
const Z = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00.000Z`); // horário já convertido de Brasília (+3h)

async function tratativa(atendimentoId: string, texto: string, encerrar?: Prisma.EventoUpdateInput) {
  const ev = await prisma.evento.findUnique({ where: { atendimentoId } });
  if (!ev) return;
  await prisma.eventoTratativa.create({ data: { eventoId: ev.id, tipo: 'NOTA', usuario: REVISOR, texto } });
  if (encerrar) await prisma.evento.update({ where: { id: ev.id }, data: encerrar });
}

const encerrado = (desfecho: string, quando: Date) => ({
  status: 'ENCERRADO' as const, desfecho: desfecho as never, encerradoPor: REVISOR, encerradoEm: quando,
});

async function corrigir(id: string, dados: Prisma.AtendimentoUncheckedUpdateInput, nota: string, evento?: Prisma.EventoUpdateInput) {
  const antes = await prisma.atendimento.findUnique({ where: { id } });
  if (!antes) { console.log(`AUSENTE ${id}`); return; }
  const detalhes = { ...((antes.detalhes ?? {}) as Record<string, unknown>), aguardandoRevisao: false, revisadoEm: new Date().toISOString(), revisadoPor: REVISOR };
  await prisma.atendimento.update({ where: { id }, data: { ...dados, detalhes: detalhes as Prisma.InputJsonValue } });
  await tratativa(id, nota, evento);
  console.log(`OK ${id}: ${antes.status} -> ${dados.status ?? antes.status}`);
}

async function main() {
  // 1) ORSEGUPS · ID PR7 36878 · SIND DE TRABALHADORES EM ATIV — cliente liberou às 14:12
  await corrigir(
    '49e46386-d943-4adc-8838-28cda14687ce',
    {
      status: 'CONCLUIDO', motivoNaoAtendimento: null, detalheNaoAtendimento: null,
      solicitadoEm: Z('16:25'), chegadaEm: Z('16:57'), concluidoEm: Z('17:12'),
      encerradoPor: REVISOR, encerradoEm: Z('17:12'),
      agenteNome: 'Henryque', operadorPR7: 'Laysla Larissa',
      responsavelLocalNome: 'Fabiana',
      summary:
        'Cliente solicita vistoria de alarme às 13:25 (ocorrência 33717678 · ID PR7 36878).\n' +
        'Agente Henryque desloca, chega ao local às 13:57, realiza vistoria e laudo fotográfico do local.\n' +
        'Relato: responsável Fabiana informa intrusão pela manhã (~9h) pelo telhado, com danos em ar-condicionados e subtração de fiação; PM acionada não localizou o indivíduo. Na vistoria, nenhuma anormalidade: alarme inativo, portas fechadas e energia normal. Possível acesso pelos comércios vazios da rua de trás.\n' +
        'PR7 analisa as informações junto à equipe técnica e retorna ao cliente. Estando tudo ok, cliente libera o agente às 14:12. Atendimento encerrado.',
    },
    'Revisão: chamado estava EM ANDAMENTO. Cliente liberou o agente às 14:12 (mensagem "pode liberar") — encerrado como atendimento realizado. A correção do retorno foi reenviada pela operadora no grupo Suporte.',
    encerrado('ATENDIMENTO_REALIZADO', Z('17:12')),
  );

  // 2) ORSEGUPS · ocorrência 33713267 — agentes empenhados, ninguém disponível
  await corrigir(
    '0b5dde40-534e-4535-9e54-fedc9583456b',
    {
      status: 'NAO_ATENDIDO', motivoNaoAtendimento: 'SEM_PRESTADOR_REGIAO',
      detalheNaoAtendimento: 'Agentes da região todos empenhados às 12:52 — sem prestador disponível para o deslocamento',
      encerradoPor: REVISOR, encerradoEm: Z('15:52'), solicitadoEm: Z('15:20'),
      summary:
        'Cliente solicita atendimento às 12:20 (ocorrência 33713267).\n' +
        'PR7 consulta a rede da região e informa às 12:52 que os agentes estão todos empenhados.\n' +
        'Sem prestador disponível: chamado não atendido.',
    },
    'Revisão: nenhum agente disponível na região (12:52). Encerrado como não atendido — sem prestador.',
    encerrado('SEM_PRESTADOR', Z('15:52')),
  );

  // 3) ORSEGUPS · ocorrência 33721223 — cliente cancelou 10 min depois
  await corrigir(
    '07c2ef7d-0fe7-4543-a0e2-7949ba378bfe',
    {
      status: 'CANCELADO', motivoNaoAtendimento: 'CANCELADO_CLIENTE',
      detalheNaoAtendimento: 'Cliente cancelou 10 min após a solicitação (16:32)',
      solicitadoEm: Z('19:22'), encerradoPor: REVISOR, encerradoEm: Z('19:32'), concluidoEm: null,
      resultado: null,
      summary:
        'Cliente solicita atendimento às 16:22 (ocorrência 33721223).\n' +
        'Cliente cancela às 16:32 (10 min após a solicitação), antes do deslocamento.',
    },
    'Revisão: chamado cancelado pelo cliente 10 min após a solicitação. O resumo anterior misturava a foto de outro chamado (Itajaí).',
    encerrado('CANCELADO_CLIENTE', Z('19:32')),
  );

  // 4) SEGURPRO · Posto PortoSeco (Sr. Umberto) — cancelado 33 min depois
  await corrigir(
    '5bbf3f5d-d5ae-4f19-bc8d-f90ecf45b24d',
    {
      status: 'CANCELADO', motivoNaoAtendimento: 'CANCELADO_CLIENTE',
      detalheNaoAtendimento: 'Cliente cancelou 33 min após a solicitação (15:08) — imprevisto com o veículo da central',
      category: 'Ronda', solicitadoEm: Z('17:35'), encerradoPor: REVISOR, encerradoEm: Z('18:08'),
      operadorPR7: 'Laysla Larissa', responsavelLocalNome: 'Sr. Umberto',
      summary:
        'Cliente solicita agente de pronta resposta para o Posto PortoSeco às 14:35, para acompanhar o Sr. Umberto em vistoria no local (previsão 14:45).\n' +
        'PR7 confirma disponibilidade e aciona o apoio, com previsão de 40 min para chegada.\n' +
        'Cliente cancela às 15:08 (33 min após a solicitação) por imprevisto com o veículo da central.',
    },
    'Revisão: chamado do Posto PortoSeco cancelado pelo cliente 33 min após a solicitação (imprevisto com veículo da central).',
    encerrado('CANCELADO_CLIENTE', Z('18:08')),
  );

  // 5) SEGURPRO · ID PR7 36879 · Drogaria Nissei — concluído, resumo estava misturado com o PortoSeco
  await corrigir(
    '925d8165-9644-4d95-a838-41ef41e7aa3e',
    {
      status: 'CONCLUIDO', ocorrencia: 'B01-6365',
      solicitadoEm: Z('18:38'), chegadaEm: Z('18:57'), concluidoEm: Z('20:02'),
      encerradoPor: REVISOR, encerradoEm: Z('20:02'),
      agenteNome: 'João Victor', operadorPR7: 'Laysla Larissa',
      responsavelLocalNome: 'Denise', responsavelLocalTelefone: '13991218452',
      resultado:
        'Realizada vistoria no local: sem sinal de intrusão, alarme inativo e nenhuma anormalidade. ' +
        'Morador de rua que estava acampado no estacionamento já se retirou.',
      summary:
        'Cliente solicita ronda para a DROGARIA NISSEI às 15:38 (conta B01-6365 · ID PR7 36879).\n' +
        'Agente João Victor desloca, chega ao local às 15:57, realiza vistoria e laudo fotográfico do local.\n' +
        'Relato: responsável Denise (13 99121-8452) acompanha; local sem sinal de intrusão, alarme inativo e sem anormalidades. Morador de rua acampado no estacionamento já se retirou. Local limpo às 16:18.\n' +
        'PR7 analisa as informações junto à equipe técnica e retorna ao cliente. Estando tudo ok, cliente libera o agente e o apoio se retira às 17:02. Atendimento encerrado.',
    },
    'Revisão: resumo estava misturado com o chamado do Posto PortoSeco. Reescrito com os dados da Drogaria Nissei (agente João Victor, responsável Denise).',
    encerrado('ATENDIMENTO_REALIZADO', Z('20:02')),
  );

  // 6) CEABS · furto Citroën Aircross FPG8A47 — recuperado (KM final 16:20, "Positivo" 16:27)
  await corrigir(
    '3a1a7839-eb80-40da-9222-f433d80d2f2c',
    {
      status: 'CONCLUIDO', concluidoEm: Z('19:27'), encerradoPor: REVISOR, encerradoEm: Z('19:27'),
      resultado: 'Positivo — veículo localizado pela equipe de Inteligência em Segurança; KM final informado às 16:20.',
      summary:
        'Cliente CEABS informa furto do Citroën Aircross placa FPG8A47 às 13:51 (CEABS 05).\n' +
        'Equipe de pronta resposta autorizada e Inteligência em Segurança realiza buscas em comunidade de risco, com envio contínuo de evidências fotográficas.\n' +
        'Resultado positivo: veículo localizado, KM final informado às 16:20 e confirmação do cliente às 16:27. Atendimento encerrado.',
    },
    'Revisão: veículo localizado (resultado positivo confirmado pelo cliente às 16:27). Chamado encerrado.',
    { ...encerrado('ATENDIMENTO_REALIZADO', Z('19:27')), vertical: 'VEICULAR', placa: 'FPG8A47' },
  );

  // 7) CIEP 04 · PUY2G95 — é divulgação de furto (alerta), não é chamado
  const div = await prisma.atendimento.findUnique({ where: { id: '90bb0586-8677-4993-a566-561d6249ed05' }, include: { conversation: true } });
  if (div) {
    const msg = await prisma.message.findFirst({
      where: { conversationId: div.conversationId!, content: { contains: 'PUY2G95' } }, orderBy: { sentAt: 'asc' },
    });
    const d = msg ? lerDivulgacao(msg.content) : null;
    if (msg && d) {
      await prisma.alertaVeicular.upsert({
        where: { messageId: msg.id },
        create: {
          tipo: d.tipo, placa: d.placa, chassi: d.chassi, descricao: d.descricao, cor: d.cor, anoModelo: d.anoModelo,
          localOcorrencia: d.localOcorrencia, latitude: d.latitude, longitude: d.longitude, dataHoraTexto: d.dataHora,
          divulgadoEm: msg.sentAt, grupo: div.conversation?.groupName ?? null, remetente: msg.senderName,
          empresaId: div.empresaId, messageId: msg.id, textoOriginal: msg.content.slice(0, 4000),
        },
        update: {},
      });
      console.log(`OK alerta veicular ${d.tipo} ${d.placa} registrado`);
    } else console.log('ATENÇÃO: mensagem da divulgação PUY2G95 não encontrada — alerta não criado');
    await prisma.midia.updateMany({ where: { atendimentoId: div.id }, data: { atendimentoId: null } });
    await prisma.eventoTratativa.deleteMany({ where: { evento: { atendimentoId: div.id } } });
    await prisma.evento.deleteMany({ where: { atendimentoId: div.id } });
    await prisma.atendimento.delete({ where: { id: div.id } });
    console.log('OK chamado CIEP 04 (divulgação) removido');
  }

  // 8) Grupo "Centrais" é interno — o "chamado" 28A8F saiu de um repasse entre centrais
  const centrais = await prisma.conversation.findFirst({ where: { groupName: 'Centrais' } });
  if (centrais) {
    await prisma.conversation.update({ where: { id: centrais.id }, data: { tipoGrupo: 'INTERNO' } });
    console.log('OK grupo Centrais marcado como INTERNO');
  }
  const interno = await prisma.atendimento.findUnique({ where: { id: '82b2caf1-53f9-4136-ae42-8eed27f21125' } });
  if (interno) {
    await prisma.midia.updateMany({ where: { atendimentoId: interno.id }, data: { atendimentoId: null } });
    await prisma.eventoTratativa.deleteMany({ where: { evento: { atendimentoId: interno.id } } });
    await prisma.evento.deleteMany({ where: { atendimentoId: interno.id } });
    await prisma.atendimento.delete({ where: { id: interno.id } });
    console.log('OK chamado 28A8F (grupo interno Centrais) removido');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
