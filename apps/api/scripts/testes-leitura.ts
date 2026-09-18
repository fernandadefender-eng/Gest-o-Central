/**
 * Testes de leitura das mensagens do WhatsApp (sem IA e sem banco).
 * Rodar: npx ts-node -T scripts/testes-leitura.ts
 */
import { lerDivulgacao, lerFormularioRetorno, responsavelNoRelato } from '../src/whatsapp/formulario-retorno';
import { lerEventoTelemetria } from '../src/monitoramento/evento-telemetria';
import { prioridadePorTexto, tipoEventoVeicular } from '../src/monitoramento/prioridade';
import { ehGrupoFinanceiro, ehSoIds, lerComprovantePagamento, lerReclamacaoSac } from '../src/sac/sac';
import { abertoCompativel, detalheCancelamento, encaixarHoras, operadorValido, minutosEntreHoras, montarResumoOperacional } from '../src/classification/classification.service';
import { ehDoUsuario } from '../src/painel/painel.module';
import { feedbackAtendimento } from '../src/equipe/equipe.module';
import { idPR7Valido } from '../src/atendimentos/identificador';
import { telefoneCanonico } from '../src/geo/normalizar';
import { nomeDoHelpDesk } from '../src/equipe/nomes-help-desk';
import { ehGrupoRoteirizador, tipoDeParada } from '../src/classification/roteirizador';

let falhas = 0;
const ok = (nome: string, condicao: boolean, extra = '') => {
  console.log(`${condicao ? 'OK   ' : 'FALHA'} ${nome}${extra && !condicao ? ' → ' + extra : ''}`);
  if (!condicao) falhas++;
};

// ---------- Divulgação de veículo (alerta, não é chamado) ----------
const div = lerDivulgacao(
  'DIVULGAÇÃO FURTO\n\nPlaca: PUY2G95\nChassi: 9BFZD55PXFB784186\nDescrição: Ford - Fiesta 1.0 8V Flex 5p\nCor: CINZA\n' +
    'Ano Modelo/Fabricação: 2015/2014\n\nFurto ocorreu: :R. Campos Sáles, 350 - João Aranha, Paulínia - SP\nLAT./LONG.:-22.731037, -47.180218\nDATA/HORA:15/09 - 12:50(14:40)',
)!;
ok('divulgação: tipo, placa e chassi', div?.tipo === 'FURTO' && div.placa === 'PUY2G95' && div.chassi === '9BFZD55PXFB784186', JSON.stringify(div));
ok('divulgação: local e coordenadas', !!div.localOcorrencia?.startsWith('R. Campos') && Math.abs(div.latitude! + 22.731) < 0.01);
ok('pedido com placa NÃO é divulgação', lerDivulgacao('Placa: FPG8A47 Chassi: 935SUNFN1HB506490') === null);

// ---------- Responsável no local a partir do relato ----------
ok('responsável antes do nome', responsavelNoRelato('Responsável Fabiana informa que escutou barulhos')?.nome === 'Fabiana');
const r2 = responsavelNoRelato('Denise responsável 13991218452');
ok('nome antes + telefone', r2?.nome === 'Denise' && r2.telefone === '13991218452', JSON.stringify(r2));
ok('relato sem responsável', responsavelNoRelato('Local sem alterações') === null);

// ---------- Formulário de retorno ----------
const form = lerFormularioRetorno('Retorno deslocamento\nID: 36878\nConta: 18IFA\nEstabelecimento: X\nAgente: Henryque\nHr. de chegada: 13:57\nRelato: ok\nContato: já está em contato com a Orsegups')!;
ok('"Contato:" não vira responsável no local', !form.campos.contatoLocal);
ok('retorno completo', form.completo && form.ehRetorno);
ok('repasse não é retorno', lerFormularioRetorno('ID: 36878\nConta: 18IFA')?.ehRetorno === false);

// ---------- Tempo de cancelamento ----------
ok('minutos entre horários', minutosEntreHoras('16:22', '16:32') === 10 && minutosEntreHoras('23:50', '00:10') === 20);
const resumo = montarResumoOperacional({ categoria: 'Ronda', hora_solicitacao: '16:22', hora_cancelamento: '16:32', operador_pr7: 'Laysla' })!;
ok('resumo de cancelamento com o tempo', resumo.includes('(10 min após a solicitação)'), resumo);

// ---------- Evento da central (Monitoramento) ----------
const ev = lerEventoTelemetria(
  '*Laysla Larissa:*\n\nDescrição do Evento\nPainel Violado\nCliente\nTRANSPORTES CORDENONSI\nData Evento\n15/09/2026 11:24:30\nPlaca\nRYV2F98\nLocalização\nRua Dom Roberto, Cajamar, São Paulo, 07787-115, Brasil',
)!;
ok('evento: descrição, cliente e placa', ev?.descricao === 'Painel Violado' && ev.cliente === 'TRANSPORTES CORDENONSI' && ev.placa === 'RYV2F98', JSON.stringify(ev));
ok('evento: cidade/UF do endereço', ev.cidade === 'Cajamar' && ev.uf === 'SP');
ok('evento: data de Brasília em UTC', ev.ocorridoEm?.toISOString() === '2026-09-15T14:24:30.000Z', String(ev.ocorridoEm));
ok('evento: conversa comum não vira evento', lerEventoTelemetria('bom dia, tudo certo?') === null);
ok('tipos oficiais', tipoEventoVeicular('Painel Violado') === 'Painel violado'
  && tipoEventoVeicular('Desconexão de Bateria') === 'Desconexão de bateria'
  && tipoEventoVeicular('Remoção de bateria') === 'Remoção de bateria'
  && tipoEventoVeicular('Veículo bloqueado') === 'Veículo bloqueado'
  && tipoEventoVeicular('Saída de cerca') === 'Cerca');
ok('prioridade do evento', prioridadePorTexto('Painel Violado') === 'CRITICA' && prioridadePorTexto('Cerca') === 'MEDIA');
// Roubo e furto são ocorrência de atendimento veicular — não entram na fila do Monitoramento
ok('roubo não é evento de monitoramento', tipoEventoVeicular('Roubo do veículo placa ABC1D23') === null);
ok('furto não é evento de monitoramento', tipoEventoVeicular('Furto de motocicleta em São Paulo') === null);
ok('recuperação não é evento de monitoramento', tipoEventoVeicular('Recuperação de veículo') === null);

// ---------- SAC ----------
ok('grupo financeiro', ehGrupoFinanceiro('Patrimonial/Comprovantes/Pagamentos em 48 HRS Somente 02') && !ehGrupoFinanceiro('PR7 & ORSEGUPS'));
const comp = lerComprovantePagamento('[Foto] Alberto Fonseca/ Recife/ IDs 36259/36467')!;
ok('comprovante: nome, região e IDs', comp?.nome === 'Alberto Fonseca' && comp.regiao === 'Recife' && comp.ids.join(',') === '36259,36467', JSON.stringify(comp));
ok('continuação só com IDs', ehSoIds('36254 / 36332 / 36389')?.length === 3 && ehSoIds('bom dia') === null);
ok('reclamação de atendimento em atraso', lerReclamacaoSac('estou com atendimento em atraso, IDs 36259 e 36467')?.tipo === 'ATENDIMENTO_ATRASO');
ok('reclamação de pagamento', lerReclamacaoSac('não recebi o pagamento do ID 36259 até agora')?.tipo === 'PAGAMENTO_ATRASO');
ok('mensagem comum não abre SAC', lerReclamacaoSac('agente a caminho do local') === null);

// ---------- Painel do mês: de quem é o atendimento (campo Help Desk) ----------
ok('help desk: nome completo', ehDoUsuario('Hemily Dias', 'Hemily Dias'));
ok('help desk: sem acento/caixa', ehDoUsuario('LAYSLA LARISSA', 'Laysla Lárissa'));
ok('help desk: só o primeiro nome', ehDoUsuario('Laysla', 'Laysla Larissa'));
ok('help desk: outra pessoa com mesmo nome não conta', !ehDoUsuario('Hemily Souza', 'Hemily Dias'));
ok('help desk: nome diferente', !ehDoUsuario('Eliane Lopes', 'Hemily Dias') && !ehDoUsuario(null, 'Hemily Dias'));

// ---------- ID do PR7 ----------
ok('ID PR7 válido', idPR7Valido('36911') && idPR7Valido('2151') && idPR7Valido('ID: 36879'));
ok('ocorrência do cliente não é ID PR7', !idPR7Valido('33760663') && !idPR7Valido('18') && !idPR7Valido(''));

// ---------- Feedback do Help Desk ----------
const TIME = { respostaMedianaMin: 29, acionamentoMedianaMin: null, pctRespostaLenta: 14, taxaNaoAtendimento: 0.2, taxaConclusao: 99 };
const base = { total: 300, respostaMedianaMin: 29, acionamentoMedianaMin: null, comAcionamento: 0, pctRespostaLenta: 14, comResposta: 300, taxaNaoAtendimento: 0, naoAtendidos: 0, negativas: 0, demoras: 0, abertos: 0, taxaConclusao: 100, mediaPorDia: 6.3 };
const lento = feedbackAtendimento({ ...base, respostaMedianaMin: 36, pctRespostaLenta: 25 }, TIME, false, 6.3);
ok('feedback: quem está atrás recebe o ponto a melhorar com número', lento[0].tipo === 'melhorar' && /25%|36 min/.test(lento[0].texto), JSON.stringify(lento));
const rapido = feedbackAtendimento({ ...base, respostaMedianaMin: 22, pctRespostaLenta: 6 }, TIME, false, 6.3);
ok('feedback: ponto forte reconhece o que está melhor', rapido.at(-1)!.tipo === 'forte' && /22 min|6%/.test(rapido.at(-1)!.texto), JSON.stringify(rapido));
ok('feedback: sempre tem algo a melhorar e um ponto forte', rapido.some((f) => f.tipo === 'melhorar') && rapido.some((f) => f.tipo === 'forte'));
ok('feedback: chamado em aberto vira ação', feedbackAtendimento({ ...base, abertos: 3 }, TIME, false, 6.3).some((f) => /3 chamado/.test(f.texto)));
ok('feedback: poucos chamados não julga', feedbackAtendimento({ ...base, total: 5 }, TIME)[0].texto.includes('poucos'));

// ---------- Horários em sequência (regra de 24 h) ----------
{
  // Caso real ID 36897: pedido 16/09 20:24, classificado só no dia 17 (fila atrasada)
  const primeira = new Date('2026-09-16T23:24:00Z'); // 20:24 de Brasília
  const agora = new Date('2026-09-18T01:00:00Z');
  const q = encaixarHoras({ solicitacao: '20:24', outras: ['21:16', '21:00', '22:10'] }, null, primeira, agora);
  ok('pedido no dia certo', q('20:24')?.toISOString() === '2026-09-16T23:24:00.000Z', String(q('20:24')?.toISOString()));
  ok('chegada no mesmo dia do pedido (não no dia da classificação)', q('21:00')?.toISOString() === '2026-09-17T00:00:00.000Z', String(q('21:00')?.toISOString()));
  const v = encaixarHoras({ solicitacao: '23:40', outras: ['23:55', '00:30', '02:10'] }, null, new Date('2026-09-16T02:41:00Z'), agora);
  ok('virada do dia: 23:55 → 00:30 cai no dia seguinte', v('00:30')?.toISOString() === '2026-09-16T03:30:00.000Z' && v('02:10')?.toISOString() === '2026-09-16T05:10:00.000Z', `${v('00:30')?.toISOString()} ${v('02:10')?.toISOString()}`);
  const ja = encaixarHoras({ outras: ['21:00'] }, new Date('2026-09-16T23:24:00Z'), new Date('2026-09-17T23:00:00Z'), agora);
  ok('chamado já aberto: ancora no pedido gravado', ja('21:00')?.toISOString() === '2026-09-17T00:00:00.000Z', String(ja('21:00')?.toISOString()));
  ok('nunca no futuro', +(encaixarHoras({ outras: ['23:59'] }, null, new Date('2026-09-18T00:30:00Z'), agora)('23:59') ?? 0) <= +agora + 300000);
}

ok('Help Desk: nome do grupo não vale', !operadorValido('PR7 & ORSEGUPS', 'PR7 & ORSEGUPS') && !operadorValido('ORSEGUPS Monitoramento Eletrônico LTDA'));
ok('Help Desk: <UNKNOWN>/não informado não vale', !operadorValido('<UNKNOWN>') && !operadorValido('Não informado'));
ok('Help Desk: pessoa vale', operadorValido('Laysla') && operadorValido('Eliane Lopes', 'PR7 & ORSEGUPS'));

// ---------- Mensagem sem ID em grupo com várias ocorrências ----------
{
  const clamed = { id: 'c', solicitadoEm: new Date('2026-09-16T01:45:00Z'), createdAt: new Date('2026-09-16T01:45:00Z'), detalhes: { estabelecimento: 'CLAMED 973 - FPP Dourados II' } };
  ok('grupo: mensagem do dia seguinte não cai no chamado antigo', abertoCompativel([clamed], undefined, new Date('2026-09-16T23:14:00Z'), true) === undefined);
  ok('grupo: outro estabelecimento não cai no chamado aberto', abertoCompativel([clamed], 'Oboticario L329', new Date('2026-09-16T02:00:00Z'), true) === undefined);
  ok('grupo: mesmo estabelecimento e recente cai no aberto', abertoCompativel([clamed], 'Clamed Dourados', new Date('2026-09-16T02:10:00Z'), true) === clamed);
  ok('grupo: dois abertos → não escolhe', abertoCompativel([clamed, { ...clamed, id: 'd' }], undefined, new Date('2026-09-16T02:00:00Z'), true) === undefined);
  ok('conversa 1-a-1: usa o aberto', abertoCompativel([clamed], 'qualquer', new Date('2026-09-20T02:00:00Z'), false) === clamed);
}

// ---------- Formulário no formato "*Rótulo* valor" (sem dois-pontos) ----------
{
  const f = lerFormularioRetorno('*Eliane Lopes:*\n\n*Conta:* 1BA6B\n*ocorrência*33793207\n*Estabelecimento* PLASTICOS ALPINAS\n*Operador solicitante*: N/INF\n*Data de solicitação*: 17/09/2026\n*Hora solicitada* 20:46\n*Hora de chegada:* 21:20\n*Agente*: HENRIQUE\n*Serviço de* VISTORIA\n**ID PR7* 36912\n\n*RELATO:*REALIZADO VISTORIA LOCAL SEM ANORMALIDADES*')!;
  ok('negrito: ID, conta e ocorrência separados', f.campos.id === '36912' && f.campos.conta === '1BA6B' && f.campos.ocorrencia === '33793207', JSON.stringify(f.campos));
  ok('negrito: hora solicitada, serviço e estabelecimento', f.campos.horaSolicitada === '20:46' && f.campos.servico === 'VISTORIA' && f.campos.estabelecimento === 'PLASTICOS ALPINAS', JSON.stringify(f.campos));
  ok('negrito: formulário completo', f.completo, f.faltando.join(','));
  ok('assinatura "*Eliane Lopes:*" vira quem postou', f.campos.assinatura === 'Eliane Lopes', String(f.campos.assinatura));
  const r = lerFormularioRetorno('*ID: 36891*\n*Conta: Não possui*\n*Estabelecimento: Vibra Energia - Posto Raízes*\n*Agente: Claudemir*\n*Hr. de chegada: 20:10*\n*Relatório: Local sem novidade.*')!;
  ok('"Conta: Não possui" com estabelecimento = completo', r.completo, r.faltando.join(','));
  const antigo = lerFormularioRetorno('*Ingridy:*\n\n*ID: 36897*\n*Conta: 2337C*\n*Estabelecimento: Campneus*\n*Agente: Anderson*\n*Hr. solicitada: 20:24*\n*Hr. de chegada: 21:00*\n*Relatório: Local sem novidades.*\n*Portões devidamente fechados, local energizado e alarme sonoro inativo.*')!;
  ok('formato com dois-pontos continua igual (relato em negrito não vira rótulo)', antigo.completo && antigo.campos.id === '36897' && antigo.campos.relato.includes('Portões'), JSON.stringify(antigo.campos));
}

// ---------- Pedido no lote que atravessa horas + motivo do cancelamento ----------
{
  // Caso real PR7-H-000096: lote começa 20:03 e o pedido do Boticário é 22:12 do MESMO dia
  const lote = [
    { sentAt: new Date('2026-09-17T23:03:00Z'), content: '*Eliane Lopes:* *Conta:* 1B8AE ...' },
    { sentAt: new Date('2026-09-18T01:12:00Z'), content: '[Foto] Agente diponível?' },
    { sentAt: new Date('2026-09-18T01:18:00Z'), content: 'Cancelar por gentileza' },
  ];
  const q = encaixarHoras({ solicitacao: '22:12', outras: ['22:18', '22:18'] }, null, lote[0].sentAt, new Date('2026-09-18T03:00:00Z'), lote);
  ok('pedido pela mensagem enviada naquele horário (não pela 1ª do lote)', q('22:12')?.toISOString() === '2026-09-18T01:12:00.000Z', String(q('22:12')?.toISOString()));
  const citada = encaixarHoras({ solicitacao: '20:24', outras: [] }, null, new Date('2026-09-17T23:00:00Z'), new Date('2026-09-18T03:00:00Z'),
    [{ sentAt: new Date('2026-09-17T00:06:00Z'), content: '*Hr. solicitada: 20:24*' }, { sentAt: new Date('2026-09-17T23:00:00Z'), content: 'oi' }]);
  ok('pedido pela mensagem que cita a hora ("Hr. solicitada: 20:24")', citada('20:24')?.toISOString() === '2026-09-16T23:24:00.000Z', String(citada('20:24')?.toISOString()));

  const recusa = detalheCancelamento({ minutos: 6, horaCancelamento: '22:18', prazo: '15 min', horaPrazo: '22:18', prazoEm: new Date('2026-09-18T01:18:00Z'), cancelou: new Date('2026-09-18T01:18:00Z') });
  ok('cancelamento logo após o prazo = provável recusa do prazo', /mesmo minuto/.test(recusa) && /recusa do prazo/.test(recusa) && /não informou/.test(recusa), recusa);
  const antes = detalheCancelamento({ minutos: 2, horaCancelamento: '23:18' });
  ok('cancelamento sem prazo informado = PR7 ainda verificando', /antes de a PR7 informar prazo/.test(antes), antes);
  const dito = detalheCancelamento({ minutos: 9, motivo: 'agente próprio já está no local' });
  ok('motivo escrito pelo cliente é registrado com as palavras dele', /"agente próprio já está no local"/.test(dito) && !/não informou/.test(dito), dito);
  ok('"cancela" não conta como motivo', /não informou/.test(detalheCancelamento({ minutos: 1, motivo: 'cancela' })));
}

// ---------- Roteirizador (acompanhamento velado) ----------
ok('grupo de acompanhamento é roteirizador', ehGrupoRoteirizador('PR7 Acompanhamento Velado') && !ehGrupoRoteirizador('PR7 & ORSEGUPS'));
ok('paradas do trajeto', tipoDeParada('Veiculo no proximo cliente') === 'A caminho do próximo cliente'
  && tipoDeParada('No cliente descarregando') === 'No cliente descarregando'
  && tipoDeParada('Veículo saiu do cliente') === 'Saiu do cliente'
  && tipoDeParada('No cliente') === 'No cliente'
  && tipoDeParada('Veículo na frente do cliente normalmente descarrega na frente mesmo') === 'No cliente descarregando');
ok('conversa comum não é parada', tipoDeParada('Bom dia, positivo.') === null);

// ---------- Duplicidades: telefone e nomes do Help Desk ----------
ok('telefone: celular sem o 9 vira com 9', telefoneCanonico('4399071221') === '43999071221' && telefoneCanonico('+55 (43) 9907-1221') === '43999071221');
ok('telefone: fixo continua com 10 dígitos', telefoneCanonico('1133224455') === '1133224455');
ok('Help Desk: grafias da mesma pessoa viram um nome', nomeDoHelpDesk('Ingridy Lorrayne') === 'Ingridy Lorranny Oliveira Silva' && nomeDoHelpDesk('eliane') === 'Eliane Lopes' && nomeDoHelpDesk('João Victor') === 'João Victor Da Costa Vasconcelos');
ok('Help Desk: "Carlos" é o Carlos Gabriel (confirmado)', nomeDoHelpDesk('Carlos') === 'Carlos Gabriel' && nomeDoHelpDesk('Edi Carlos') === 'Edi Carlos');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
