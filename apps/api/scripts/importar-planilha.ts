/**
 * Importa o histórico da planilha do sistema antigo para o banco.
 *
 * Abas lidas: "Patrimonial PG PRS 2025" e "Veicular".
 * Não usa IA — os dados já vêm estruturados, então o custo é zero.
 *
 * Pode rodar de novo quando a planilha for atualizada:
 * - atendimentos importados são recriados (os que vieram do WhatsApp ficam intactos);
 * - prestadores e agentes são ATUALIZADOS, nunca apagados — nome completo,
 *   apelido, telefone e e-mail editados no organograma são preservados.
 *
 * A planilha tem sujeira conhecida (cabeçalhos repetidos, UFs inválidas,
 * "Desconsiderar", colunas deslocadas), por isso cada linha é validada.
 *
 * Uso: npx ts-node -T scripts/importar-planilha.ts "caminho/da/planilha.xlsx"
 */
import { nomeDoHelpDesk } from '../src/equipe/nomes-help-desk';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { AtendimentoStatus, MotivoNaoAtendimento, Prisma, PrismaClient, ProviderStatus, ProviderTipo, Vertical } from '@prisma/client';
import { ufValida } from '../src/mapa/estados';
import { chaveCidade, normalizar, separarContato } from '../src/geo/normalizar';

const prisma = new PrismaClient();

const texto = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.text) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
    return '';
  }
  return String(v).trim();
};

/** Descarta data impossível (ano 0150, 1950...) que vem de célula suja. */
const plausivel = (d: Date | null): Date | null => {
  if (!d) return null;
  const ano = d.getUTCFullYear();
  return ano >= 2015 && ano <= new Date().getUTCFullYear() + 1 ? d : null;
};

/** Placa de verdade (AAA1234 ou Mercosul AAA1A23); "NÃO POSSUI", "SINFO", "433" viram vazio. */
const placaLimpa = (t: string): string | undefined => {
  const p = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) ? p : undefined;
};

/** Nome de pessoa: descarta número solto, código e abreviação de 1-2 letras. */
const nomeLimpo = (t: string): string => {
  const n = t.replace(/\s+/g, ' ').trim();
  if (n.length < 3 || /^\d+$/.test(n) || placaLimpa(n)) return '';
  return n;
};

/** Cidade: tira vírgula/pontuação sobrando e descarta o que é só número. */
const cidadeLimpa = (t: string): string => {
  const c = t.replace(/\s+/g, ' ').replace(/[,;.\s]+$/, '').trim();
  return /^\d+$/.test(c) || c.length < 2 ? '' : c;
};

const data = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  // Data serial do Excel (dias desde 30/12/1899) que veio sem formatação de data
  if (typeof v === 'number' && v > 30000 && v < 60000) return plausivel(new Date(Date.UTC(1899, 11, 30) + v * 864e5));
  const s = texto(v);
  if (!s) return null;
  // "dd/mm/aaaa", "dd-mm-aaaa" ou "dd.mm.aaaa" (+ hora) — a planilha de 2024 usa hífen
  const br = s.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) return plausivel(new Date(Date.UTC(+br[3], +br[2] - 1, +br[1], +(br[4] ?? 0), +(br[5] ?? 0), +(br[6] ?? 0))));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : plausivel(d);
};

/**
 * Data (sem hora) + coluna de hora separada (Date do Excel 1899-12-30 hh:mm, fração de dia ou "hh:mm").
 * A operação usa relógio de 24 h e escreve 00:01 ou 23:59 de propósito para marcar a virada
 * do dia — então hora informada vale sempre, mesmo à meia-noite. Retorna null na hora quando
 * a célula está vazia (aí é data sem horário, e não 00:00).
 */
const lerHora = (hora: unknown): { h: number; m: number } | null => {
  if (hora instanceof Date) return { h: hora.getUTCHours(), m: hora.getUTCMinutes() };
  if (typeof hora === 'number' && hora >= 0 && hora < 1) { const min = Math.round(hora * 1440); return { h: Math.floor(min / 60), m: min % 60 }; }
  const t = texto(hora).match(/(\d{1,2}):(\d{2})/);
  return t && +t[1] < 24 && +t[2] < 60 ? { h: +t[1], m: +t[2] } : null;
};

const juntarDataHora = (dia: Date | null, hora: unknown): Date | null => {
  if (!dia) return null;
  const t = lerHora(hora);
  if (!t) return dia;
  return new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), t.h, t.m));
};

/**
 * Horário posterior que aparece ANTES do pedido: ou virou o dia (relógio de 24 h),
 * ou a planilha anotou em 12 h (3:30 da tarde escrito como 03:30). A diferença diz qual:
 * até 12 h de atraso aparente, somar 12 h resolve; acima disso, é virada de dia.
 * Diferença maior que 24 h não é ajustada — aí o dado é de outro dia mesmo.
 */
const HORA = 3600e3;
const viradaDeDia = (inicio: Date | null | undefined, depois: Date | null | undefined): Date | null => {
  if (!depois) return depois ?? null;
  if (!inicio || +depois >= +inicio) return depois ?? null;
  const atraso = +inicio - +depois;
  if (atraso <= 12 * HORA) return new Date(+depois + 12 * HORA);
  if (atraso <= 24 * HORA) return new Date(+depois + 24 * HORA);
  return depois;
};

/** Aceita número ou texto "R$ 1.234,56"; valores absurdos (colunas deslocadas) são ignorados. */
const valor = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) < 1_000_000 ? v : null;
  const o = v as { result?: unknown };
  if (o && typeof o === 'object' && typeof o.result === 'number') return valor(o.result);
  const s = texto(v).replace(/R\$\s?/i, '').trim();
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && Math.abs(n) < 1_000_000 ? n : null;
};

type Linha = {
  vertical: Vertical;
  cliente: string; estab: string; conta: string; endereco: string;
  cidade: string; estado: string; tipo: string; motivo: string;
  dataSolic: Date | null; dataFim: Date | null; operador: string;
  agente: string; equipe: string;
  valorPrestador: number | null; valorTotalPrestador: number | null; valorCliente: number | null;
  formaPagamento: string;
  // Linha do tempo (ver schema: solicitado→acionado = operador; acionado→chegada = prestador)
  solicitadoEm?: Date | null; acionadoEm?: Date | null; chegadaEm?: Date | null; concluidoEm?: Date | null;
  naoAtendido?: { status: 'CANCELADO' | 'NAO_ATENDIDO'; motivo: MotivoNaoAtendimento; detalhe: string };
  placa?: string; latitude?: number | null; longitude?: number | null;
  idPR7?: string; // coluna "Id": ID do acionamento no sistema do PR7
  codigoValidacao?: string; sap?: string; // chaves de conferência usadas por alguns clientes
  detalhes?: Record<string, unknown>;
};

function colunas(ws: ExcelJS.Worksheet, linhaCab = 1) {
  const cab = (ws.getRow(linhaCab).values as unknown[]).map(texto);
  // Retorna o índice da célula (base 1) da primeira coluna cujo cabeçalho casa
  return (nome: RegExp) => cab.findIndex((h, i) => i > 0 && nome.test(h));
}

/**
 * Abas antigas ("🚜🚔🚜 Veicular Janeiro") têm mais de uma tabela na mesma aba, cada
 * uma com seu cabeçalho e ordem de colunas diferente. Ler tudo pelo cabeçalho da
 * linha 1 embaralha os campos (prestador no lugar de placa, data perdida), então
 * cada bloco é lido com o cabeçalho dele.
 */
function blocosDeCabecalho(ws: ExcelJS.Worksheet): { cab: number; ate: number }[] {
  const ROTULOS = [/^id$/i, /^cliente$/i, /^placa$/i, /^data$/i, /^motivo$/i, /^agente$/i, /^cidade$/i, /^estado$/i, /recuperado/i, /hora/i, /^conta$/i, /estabelecimento/i, /tipo de servi/i];
  const cabecalhos: number[] = [];
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    const vals = (row.values as unknown[]).map(texto);
    const casam = ROTULOS.filter((r) => vals.some((v, j) => j > 0 && r.test(v))).length;
    if (casam >= 5) cabecalhos.push(i);
  });
  if (!cabecalhos.length) cabecalhos.push(1);
  return cabecalhos.map((cab, k) => ({ cab, ate: k + 1 < cabecalhos.length ? cabecalhos[k + 1] - 1 : ws.rowCount }));
}

function lerPatrimonial(ws: ExcelJS.Worksheet, linhas: Linha[]) {
  const blocos = blocosDeCabecalho(ws);
  if (blocos.length > 1) console.log(`Aba ${ws.name}: ${blocos.length} tabelas na mesma aba — cada uma lida pelo seu cabeçalho`);
  let descartadasTotal = 0;
  for (const b of blocos) descartadasTotal += lerBlocoPatrimonial(ws, linhas, b.cab, b.ate);
  return descartadasTotal;
}

function lerBlocoPatrimonial(ws: ExcelJS.Worksheet, linhas: Linha[], linhaCab: number, ateLinha: number) {
  const col = colunas(ws, linhaCab);
  const noBloco = (i: number) => i > linhaCab && i <= ateLinha;
  // Cada bloco escreve o rótulo do seu jeito ("Estado"/"UF", "Data da Solicitação"/
  // "Data de Solicitação", "Operador PR7"/"Op. PR7"): os padrões aceitam as variações.
  const c = {
    id: col(/^id$/i), sap: col(/^sap$/i),
    cliente: col(/^cliente$/i), estab: col(/estabelecimento/i), conta: col(/^(conta|remota\/c[oó]d\.?)$/i), endereco: col(/endere/i),
    cidade: col(/^cidade$/i), estado: col(/^(estado|uf)$/i), tipo: col(/(tipo de servi|^servi[çc]o$)/i), motivo: col(/^motivo$/i),
    solicit: col(/data d[ae] solicita/i), termino: col(/data (t[eé]rmino|termino|final|de finaliza)/i), operador: col(/(operador|op\. ?pr7)/i),
    agente: col(/(nome do agente|^agente$)/i), equipe: col(/^equipes?$/i), pagamento: col(/^pagamento$/i),
    valor: col(/^valor$/i), valorTotal: col(/^valor total$/i), valorCliente: col(/preserva.*cliente/i),
    dSolicitada: col(/^data solicitada$/i), hSolicitada: col(/^hora solicitada$/i),
    // 2024 registra os marcos como hora ("Hora Local", "Hora Termino") sobre a data do pedido
    hLocal: col(/^(hora local|hr local|h\.local)$/i), hTermino: col(/^(hora t[eé]rmino|hora termino|hr final|hora final)$/i),
    totalHoras: col(/^(total de horas|total de hrs)$/i),
    dDeslocamento: col(/^data deslocamento$/i), dLocal: col(/^data local$/i),
    validacao: col(/(^valida|c[oó]digo de valida)/i),
  };
  let descartadas = 0;
  ws.eachRow((row, n) => {
    // Linha oculta foi escondida de propósito pela operação (filtro): não entra
    if (!noBloco(n) || row.hidden) return;
    const cel = (i: number) => (i > 0 ? row.getCell(i).value : null);
    const estado = texto(cel(c.estado)).toUpperCase();
    const estab = texto(cel(c.estab));
    // A coluna Cliente vem vazia na maioria das linhas; o nome útil está em Estabelecimento.
    const cliente = texto(cel(c.cliente)) || estab;
    const tipo = texto(cel(c.tipo));
    if (!ufValida(estado) || !cliente) { descartadas++; return; }
    const motivo = texto(cel(c.motivo));
    const marcas = [cliente, tipo, motivo, texto(cel(c.validacao)), texto(cel(c.pagamento))].join(' ');
    // A planilha é de pagamento (só entra o que foi atendido); as poucas linhas marcadas
    // como desconsideradas/canceladas viram registro de não atendimento em vez de sumirem.
    const naoAtendido = /desconsider/i.test(marcas)
      ? { status: 'NAO_ATENDIDO' as const, motivo: MotivoNaoAtendimento.OUTRO, detalhe: 'Marcado "Desconsiderar" na planilha' }
      : /cancelad|cancelou/i.test(texto(cel(c.validacao)) + ' ' + texto(cel(c.pagamento)))
        ? { status: 'CANCELADO' as const, motivo: MotivoNaoAtendimento.CANCELADO_CLIENTE, detalhe: 'Marcado como cancelado na planilha' }
        : /demora/i.test(marcas)
          ? { status: 'NAO_ATENDIDO' as const, motivo: MotivoNaoAtendimento.DEMORA_ATENDIMENTO, detalhe: 'Demora registrada na planilha' }
          : undefined;
    // "Data Deslocamento" NÃO é horário: é a DURAÇÃO do deslocamento (Data Local − Data Solicitada),
    // gravada como hora. Conferido linha a linha. A planilha não registra quando o prestador foi
    // acionado — o histórico só permite medir o tempo de resposta (pedido → chegada).
    // 2025/2026 trazem "Data Solicitada" com hora; 2024 traz a data em "Data da solicitação"
    // e a hora em "Hora Solicitada" — juntando as duas o chamado ganha a data real.
    const dataDoPedido = data(cel(c.solicit));
    const solicitada = data(cel(c.dSolicitada)) ?? juntarDataHora(dataDoPedido, cel(c.hSolicitada));
    const chegada = viradaDeDia(solicitada, data(cel(c.dLocal)) ?? juntarDataHora(dataDoPedido, cel(c.hLocal)));
    const terminoBruto = viradaDeDia(chegada ?? solicitada, data(cel(c.termino)) ?? juntarDataHora(dataDoPedido, cel(c.hTermino)));
    // Data impossível na planilha (mês trocado, ano errado): melhor sem marco do que com marco falso
    const impossivel = (d: Date | null) => !!(d && solicitada && (+d < +solicitada || +d - +solicitada > 48 * HORA));
    const termino = impossivel(terminoBruto) ? null : terminoBruto;
    linhas.push({
      vertical: Vertical.PATRIMONIAL,
      idPR7: texto(cel(c.id)).replace(/\D/g, '') || undefined,
      codigoValidacao: texto(cel(c.validacao)) || undefined,
      sap: texto(cel(c.sap)) || undefined,
      naoAtendido,
      solicitadoEm: solicitada,
      acionadoEm: null,
      chegadaEm: impossivel(chegada) ? null : chegada,
      concluidoEm: termino,
      cliente, estab: estab || cliente, conta: texto(cel(c.conta)), endereco: texto(cel(c.endereco)),
      cidade: cidadeLimpa(texto(cel(c.cidade))), estado, tipo, motivo,
      dataSolic: dataDoPedido, dataFim: termino ?? (texto(cel(c.totalHoras)) ? dataDoPedido : null), operador: texto(cel(c.operador)),
      agente: nomeLimpo(texto(cel(c.agente))), equipe: texto(cel(c.equipe)),
      // Nas linhas recentes a operação preenche só "Valor total" — é o que se paga ao prestador
      valorPrestador: valor(cel(c.valor)) ?? valor(cel(c.valorTotal)), valorTotalPrestador: valor(cel(c.valorTotal)), valorCliente: valor(cel(c.valorCliente)),
      formaPagamento: texto(cel(c.pagamento)),
    });
  });
  return descartadas;
}

function lerVeicular(ws: ExcelJS.Worksheet, linhas: Linha[]) {
  const blocos = blocosDeCabecalho(ws);
  if (blocos.length > 1) console.log(`Aba ${ws.name}: ${blocos.length} tabelas na mesma aba (cabeçalhos nas linhas ${blocos.map((b) => b.cab).join(', ')}) — cada uma lida pelo seu cabeçalho`);
  let descartadas = 0;
  for (const b of blocos) descartadas += lerBlocoVeicular(ws, linhas, b.cab, b.ate);
  return descartadas;
}

function lerBlocoVeicular(ws: ExcelJS.Worksheet, linhas: Linha[], linhaCab: number, ateLinha: number) {
  const colCab = colunas(ws, linhaCab);
  const noBloco = (i: number) => i > linhaCab && i <= ateLinha;
  // Nesta aba os dados estão deslocados uma coluna à direita a partir de "Placa".
  // Detecta pelo campo Estado: usa o deslocamento em que mais linhas têm UF válida.
  const iPlaca = colCab(/^placa$/i), iEstadoCab = colCab(/^estado$/i);
  // Algumas abas antigas ("Veicular Janeiro") não têm coluna Estado: sem ela não há
  // como medir o deslocamento, então lê sem deslocar.
  const ufsCom = (d: number) => {
    if (iEstadoCab <= 0) return 0;
    let n = 0;
    ws.eachRow((r, i) => { if (noBloco(i) && ufValida(texto(r.getCell(iEstadoCab + d).value).toUpperCase())) n++; });
    return n;
  };
  const desloc = ufsCom(1) > ufsCom(0) ? 1 : 0;
  if (desloc) console.log(`Aba ${ws.name}: dados deslocados 1 coluna a partir de "Placa" — corrigido na leitura`);
  const col = (nome: RegExp) => { const i = colCab(nome); return i >= iPlaca ? i + desloc : i; };

  // Confere se a coluna que o cabeçalho aponta como "Placa" realmente tem placas.
  // Abas antigas têm um segundo bloco de tabela com outro layout no meio da mesma aba,
  // e aí a posição mente — nesse caso a leitura passa a ser pelo conteúdo da célula.
  const ehPlaca = (t?: string) => /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test((t ?? '').toUpperCase().replace(/\s/g, ''));
  const iPlacaCol = col(/^placa$/i);
  let comPlaca = 0, linhasLidas = 0;
  ws.eachRow((r, i) => {
    if (!noBloco(i) || r.hidden || linhasLidas >= 40) return;
    linhasLidas++;
    if (iPlacaCol > 0 && ehPlaca(texto(r.getCell(iPlacaCol).value))) comPlaca++;
  });
  const posicaoConfiavel = linhasLidas === 0 || comPlaca / linhasLidas >= 0.5;
  if (!posicaoConfiavel) console.log(`Aba ${ws.name} (linhas ${linhaCab + 1}-${ateLinha}): colunas fora do cabeçalho (${comPlaca}/${linhasLidas} com placa) — lendo pelo conteúdo`);
  const c = {
    id: col(/^id$/i),
    data: col(/^data$/i), hora: col(/hora solicita/i), cliente: col(/^cliente$/i), placa: col(/^placa$/i),
    modelo: col(/modelo/i), motivo: col(/^motivo$/i), franqueado: col(/franqueado/i), recuperado: col(/recuperado/i),
    operador: col(/(op\.? ?pr7|^operador)/i), cidade: col(/^cidade$/i), estado: col(/^(estado|uf)$/i),
    lat: col(/latitude/i), lng: col(/longitude/i), agente: col(/^agente$/i), equipe: col(/^equipes?$/i),
    kmIni: col(/km inicial/i), kmFim: col(/km final/i), kmTotal: col(/km total/i), kmExc: col(/km excedente/i),
    dataFinal: col(/data final/i), valorServico: col(/valor servi/i), total: col(/^total$/i),
    dDesloc: col(/data deslocamento/i), dLocal: col(/data local/i),
    pedagio: col(/ped[aá]gio/i), alimentacao: col(/alimenta/i), combustivel: col(/combust/i),
    custos: col(/custos adicionais/i), obs: col(/observa/i),
  };
  let descartadas = 0;
  ws.eachRow((row, n) => {
    if (!noBloco(n) || row.hidden) return;
    const cel = (i: number) => (i > 0 ? row.getCell(i).value : null);
    const cliente = texto(cel(c.cliente));
    const estado = texto(cel(c.estado)).toUpperCase();
    // Aba com layout fora do cabeçalho: acha a placa pelo conteúdo da linha, e os
    // campos que dependem de posição (agente, motivo, valores) não são importados —
    // melhor o registro sem esses campos do que com o dado do vizinho.
    const valores = (row.values as unknown[]).map(texto);
    const placaPorConteudo = valores.find((t) => ehPlaca(t))?.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const placaLinha = posicaoConfiavel
      ? texto(cel(c.placa)).toUpperCase().replace(/[^A-Z0-9]/g, '')
      : placaPorConteudo ?? '';
    // Abas antigas não têm coluna Estado: a placa é o que confirma que a linha é um chamado veicular
    const linhaValida = ufValida(estado) || /^[A-Z0-9]{7}$/.test(placaLinha);
    if (!cliente || /^cliente$/i.test(cliente) || !linhaValida) { descartadas++; return; }
    // Colunas de valores/KM desta aba ainda não foram validadas com a operação:
    // ficam guardadas em "detalhes" e NÃO entram nos totais financeiros até confirmação.
    const coord = (v: unknown) => { const x = valor(v); return x !== null && Math.abs(x) <= 180 && x !== 0 ? x : null; };
    // Só preenche o que depende de posição quando o cabeçalho é confiável
    const detalhes = posicaoConfiavel
      ? {
          modelo: texto(cel(c.modelo)) || undefined,
          franqueado: texto(cel(c.franqueado)) || undefined,
          recuperado: texto(cel(c.recuperado)) || undefined,
          horaSolicitacao: texto(cel(c.hora)) || undefined,
          kmInicial: valor(cel(c.kmIni)), kmFinal: valor(cel(c.kmFim)), kmTotal: valor(cel(c.kmTotal)), kmExcedente: valor(cel(c.kmExc)),
          valorServico: valor(cel(c.valorServico)), total: valor(cel(c.total)),
          pedagio: valor(cel(c.pedagio)), alimentacao: valor(cel(c.alimentacao)), combustivel: valor(cel(c.combustivel)),
          custosAdicionais: valor(cel(c.custos)),
          // Interno: nunca vai para relatório de cliente
          observacaoInterna: texto(cel(c.obs)) || undefined,
        }
      : { revisarLayout: `aba "${ws.name}" com colunas fora do cabeçalho — campos dependentes de posição não importados` };
    linhas.push({
      vertical: Vertical.VEICULAR,
      idPR7: texto(cel(c.id)).replace(/\D/g, '') || undefined,
      cliente, estab: cliente, conta: '', endereco: '',
      cidade: posicaoConfiavel ? cidadeLimpa(texto(cel(c.cidade))) : '', estado: posicaoConfiavel ? estado : '',
      tipo: 'Recuperação de Veículo', motivo: posicaoConfiavel ? texto(cel(c.motivo)) : '',
      dataSolic: data(cel(c.data)), dataFim: posicaoConfiavel ? data(cel(c.dataFinal)) : null,
      operador: posicaoConfiavel ? texto(cel(c.operador)) : '',
      // Como no Patrimonial, "Data Deslocamento" não é confiável como horário de acionamento
      solicitadoEm: juntarDataHora(data(cel(c.data)), posicaoConfiavel ? cel(c.hora) : null),
      acionadoEm: null,
      chegadaEm: posicaoConfiavel ? viradaDeDia(juntarDataHora(data(cel(c.data)), cel(c.hora)), data(cel(c.dLocal))) : null,
      concluidoEm: posicaoConfiavel ? viradaDeDia(juntarDataHora(data(cel(c.data)), cel(c.hora)), data(cel(c.dataFinal))) : null,
      agente: posicaoConfiavel ? nomeLimpo(texto(cel(c.agente))) : '',
      equipe: posicaoConfiavel ? texto(cel(c.equipe)) : '',
      valorPrestador: null, valorTotalPrestador: null, valorCliente: null, formaPagamento: '',
      placa: placaLimpa(placaLinha),
      latitude: posicaoConfiavel ? coord(cel(c.lat)) : null, longitude: posicaoConfiavel ? coord(cel(c.lng)) : null,
      detalhes,
    });
  });
  return descartadas;
}

/** Identifica a aba pelo cabeçalho (os nomes mudam de planilha para planilha). */
function tipoDaAba(ws: ExcelJS.Worksheet): 'PATRIMONIAL' | 'VEICULAR' | null {
  if (ws.actualRowCount < 2) return null;
  const col = colunas(ws);
  const temPlaca = col(/^placa$/i) > 0, temRecuperado = col(/^recuperado$/i) > 0;
  if (temPlaca && temRecuperado) return 'VEICULAR';
  // Patrimonial: serviço + conta/estabelecimento + data da solicitação
  if (col(/tipo de servi/i) > 0 && (col(/^conta$/i) > 0 || col(/estabelecimento/i) > 0) && col(/data da solicita/i) > 0) return 'PATRIMONIAL';
  return null;
}

async function main() {
  const arquivos = process.argv.slice(2);
  if (!arquivos.length) throw new Error('Informe o caminho de uma ou mais planilhas');

  const linhas: Linha[] = [];
  let descartadas = 0;
  for (const arquivo of arquivos) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(arquivo);
    const nome = arquivo.split(/[\/]/).pop();
    const antes = linhas.length;
    for (const ws of wb.worksheets) {
      // Aba oculta (hidden/veryHidden) é rascunho ou histórico arquivado: não entra
      if (ws.state !== 'visible') {
        console.log(`  ${nome} · aba "${ws.name}" IGNORADA (oculta)`);
        continue;
      }
      const tipo = tipoDaAba(ws);
      if (!tipo) continue;
      descartadas += tipo === 'PATRIMONIAL' ? lerPatrimonial(ws, linhas) : lerVeicular(ws, linhas);
      console.log(`  ${nome} · aba "${ws.name}" (${tipo}): ${linhas.length - antes} linhas acumuladas`);
    }
    if (linhas.length === antes) console.log(`  ${nome}: nenhuma aba reconhecida`);
  }

  // Mesmo atendimento em duas planilhas (2024 e 2025 se sobrepõem): fica o último lido,
  // que é o da planilha mais atual. Sem Id, a chave é conta + data + agente.
  const porChave = new Map<string, Linha>();
  for (const l of linhas) {
    const chave = l.idPR7 ? `id:${l.idPR7}` : `k:${l.conta}|${l.dataSolic?.toISOString() ?? ''}|${l.agente}|${l.estab}`;
    porChave.set(chave, l);
  }
  const repetidas = linhas.length - porChave.size;
  linhas.splice(0, linhas.length, ...porChave.values());
  console.log(`Linhas válidas: ${linhas.length} (patrimonial ${linhas.filter((l) => l.vertical === 'PATRIMONIAL').length}, veicular ${linhas.filter((l) => l.vertical === 'VEICULAR').length}) | descartadas: ${descartadas} | repetidas entre planilhas: ${repetidas}`);

  // Clientes
  for (const nome of new Set(linhas.map((l) => l.cliente))) {
    await prisma.client.upsert({ where: { phone: `import:${nome}` }, create: { phone: `import:${nome}`, name: nome }, update: {} });
  }
  const clientes = new Map((await prisma.client.findMany({ where: { phone: { startsWith: 'import:' } } })).map((c) => [c.name, c.id]));

  // Contas (só Patrimonial; chave = código da conta ou estabelecimento+cidade)
  const chaveConta = (l: Linha) => l.conta || `${l.estab}|${l.cidade}|${l.estado}`;
  const contasMap = new Map<string, Linha>();
  for (const l of linhas) if (l.vertical === 'PATRIMONIAL' && !contasMap.has(chaveConta(l))) contasMap.set(chaveConta(l), l);
  for (const [codigo, l] of contasMap) {
    await prisma.conta.upsert({
      where: { codigo },
      create: { codigo, clientId: clientes.get(l.cliente)!, estabelecimento: l.estab, endereco: l.endereco, cidade: l.cidade, estado: l.estado },
      update: {},
    });
  }
  const contas = new Map((await prisma.conta.findMany({ select: { id: true, codigo: true } })).map((c) => [c.codigo, c.id]));
  console.log(`Clientes: ${clientes.size} | Contas: ${contas.size}`);

  // ---------- Prestadores ----------
  // "Equipe(s)" = contato acionado (responsável / adm da região); "Agente" = quem foi ao local.
  type Prest = {
    chave: string; nomes: Map<string, number>; telefone: string | null; pendencias: Set<string>;
    agentes: Map<string, number>; areas: Map<string, { cidade: string; estado: string; qtd: number; ultimo: Date | null }>;
    ultimo: Date | null;
  };
  const prestadores = new Map<string, Prest>();
  const chaveDaLinha: (string | null)[] = [];
  // Nome completo já cadastrado COM telefone: a linha da planilha sem telefone é a mesma
  // pessoa (evita recriar o cadastro "sem-telefone" que a revisão de duplicidades juntou)
  const telefonePorNome = new Map<string, Set<string>>();
  for (const e of await prisma.provider.findMany({ where: { NOT: { phone: { startsWith: 'sem-telefone' } } }, select: { name: true, phone: true } })) {
    if (e.name.trim().split(/\s+/).filter((x) => x.length > 1).length < 2) continue;
    const k = normalizar(e.name);
    if (!telefonePorNome.has(k)) telefonePorNome.set(k, new Set());
    telefonePorNome.get(k)!.add(e.phone);
  }
  // A coluna Equipe às vezes traz marcação da planilha ("X", "Sim", "Não", "R$ 300")
  // em vez do prestador — isso não é gente e não pode virar cadastro.
  const nomeDePessoa = (n?: string) => {
    const t = (n ?? '').trim();
    if (!t || /^(x|sim|n[ãa]o|nao|-+|pr|r\$.*|\d+[.,]?\d*)$/i.test(t)) return false;
    return /[a-zà-ú]{3}/i.test(t);
  };
  for (const l of linhas) {
    const c = l.equipe ? separarContato(l.equipe) : null;
    if (!c || (!c.nome && !c.telefone)) { chaveDaLinha.push(null); continue; }
    // Telefone só vale como identificador com DDD (10 ou 11 dígitos); "R$ 500,00"
    // vira "50001000" e não é contato de ninguém.
    const telefoneValido = !!c.telefone && /^\d{10,11}$/.test(c.telefone);
    if (!nomeDePessoa(c.nome) && !telefoneValido) { chaveDaLinha.push(null); continue; }
    const unicoTelefone = !c.telefone && telefonePorNome.get(normalizar(c.nome))?.size === 1 ? [...telefonePorNome.get(normalizar(c.nome))!][0] : null;
    const chave = c.telefone ?? unicoTelefone ?? `sem-telefone:${normalizar(c.nome)}`;
    let p = prestadores.get(chave);
    if (!p) prestadores.set(chave, (p = { chave, nomes: new Map(), telefone: c.telefone, pendencias: new Set(), agentes: new Map(), areas: new Map(), ultimo: null }));
    if (c.nome) p.nomes.set(c.nome, (p.nomes.get(c.nome) ?? 0) + 1);
    if (l.agente) p.agentes.set(l.agente, (p.agentes.get(l.agente) ?? 0) + 1);
    const ka = chaveCidade(l.cidade, l.estado);
    const area = p.areas.get(ka) ?? { cidade: l.cidade, estado: l.estado, qtd: 0, ultimo: null };
    area.qtd++;
    if (l.dataSolic && (!area.ultimo || l.dataSolic > area.ultimo)) area.ultimo = l.dataSolic;
    p.areas.set(ka, area);
    if (l.dataSolic && (!p.ultimo || l.dataSolic > p.ultimo)) p.ultimo = l.dataSolic;
    chaveDaLinha.push(chave);
  }

  const existentes = new Map((await prisma.provider.findMany({ select: { id: true, phone: true, name: true, status: true } })).map((p) => [p.phone, p]));
  const restritos = await prisma.restrito.findMany({ where: { ativo: true }, select: { telefone: true, nomeBusca: true } });
  const maisFrequente = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const limiteAtivo = Date.now() - 90 * 24 * 3600 * 1000;
  const idPorChave = new Map<string, string>();
  let novos = 0;

  for (const p of prestadores.values()) {
    const antigo = existentes.get(p.chave);
    // Nome editado no organograma prevalece sobre o da planilha
    const nome = antigo?.name ?? maisFrequente(p.nomes) ?? '(sem nome)';
    const pendencias: string[] = [];
    if (nome.split(' ').filter((x) => x.length > 1).length < 2) pendencias.push('Nome sem sobrenome');
    if (!p.telefone) pendencias.push('Sem telefone');
    else if (p.telefone.length < 10) pendencias.push('Telefone sem DDD');
    const primeiroNome = normalizar(nome).split(' ')[0];
    const ehEquipe = [...p.agentes.keys()].some((a) => normalizar(a).split(' ')[0] !== primeiroNome);
    const base = [...p.areas.values()].sort((a, b) => b.qtd - a.qtd)[0];
    const calculado = {
      tipo: ehEquipe ? ProviderTipo.EQUIPE : ProviderTipo.INDIVIDUAL,
      status: (p.ultimo && p.ultimo.getTime() >= limiteAtivo ? ProviderStatus.ATIVO : ProviderStatus.INATIVO) as ProviderStatus,
      cidadeBase: base?.cidade ?? null, estadoBase: base?.estado ?? null, ultimoAtendimento: p.ultimo, pendencias,
    };
    const id = antigo?.id ?? randomUUID();
    // Restrição é decisão da operação: a planilha nunca a desfaz, e quem está na lista de bloqueio já entra RESTRITO
    const bloqueado = restritos.some((r) => (r.telefone && r.telefone === p.telefone) || r.nomeBusca === normalizar(nome));
    if (bloqueado) calculado.status = ProviderStatus.RESTRITO;
    if (antigo) await prisma.provider.update({ where: { id }, data: antigo.status === ProviderStatus.RESTRITO ? { ...calculado, status: ProviderStatus.RESTRITO } : calculado });
    else { await prisma.provider.create({ data: { id, name: nome, phone: p.chave, origem: 'planilha', ...calculado } }); novos++; }
    idPorChave.set(p.chave, id);

    // Agentes: soma de atendimentos atualizada; dados cadastrais editados ficam intactos
    for (const [agente, qtd] of p.agentes) {
      await prisma.providerMembro.upsert({
        where: { providerId_nome: { providerId: id, nome: agente } },
        create: { providerId: id, nome: agente, apelido: agente, atendimentos: qtd },
        update: { atendimentos: qtd },
      });
    }
    // Áreas: 100% derivadas dos atendimentos, podem ser recriadas
    await prisma.providerArea.deleteMany({ where: { providerId: id } });
    await prisma.providerArea.createMany({
      data: [...p.areas.values()].map((a) => ({ providerId: id, cidade: a.cidade, estado: a.estado, atendimentos: a.qtd, ultimoAtendimento: a.ultimo })),
      skipDuplicates: true,
    });
  }
  console.log(`Prestadores: ${prestadores.size} (${novos} novos, ${prestadores.size - novos} atualizados)`);

  // ---------- Atendimentos (recriados; os do WhatsApp têm conversa e ficam intactos) ----------
  // Apaga só o que veio da planilha: WhatsApp tem conversa e o formulário marca "registradoPor"
  const apagados = await prisma.$executeRaw`
    DELETE FROM "Atendimento"
    WHERE "conversationId" IS NULL AND (detalhes IS NULL OR NOT (detalhes ? 'registradoPor'))`;
  console.log(`Atendimentos da importação anterior removidos: ${apagados}`);
  const dec = (n: number | null) => (n === null ? null : new Prisma.Decimal(n.toFixed(2)));
  // Nomes do Help Desk que a própria planilha traz: servem para reconhecer quem é o
  // login ("eliane.lopes…@…") sem guardar e-mail nenhum no código
  const nomesHelpDesk = [...new Set(linhas.map((l) => l.operador).filter((o) => o && !o.includes('@')))];
  const registros: Prisma.AtendimentoCreateManyInput[] = linhas.map((l, i) => ({
    clientId: clientes.get(l.cliente)!,
    contaId: l.vertical === 'PATRIMONIAL' ? contas.get(chaveConta(l)) ?? null : null,
    providerId: chaveDaLinha[i] ? idPorChave.get(chaveDaLinha[i]!) ?? null : null,
    agenteNome: l.agente || null,
    category: l.tipo || null,
    summary: l.motivo || null,
    status: l.naoAtendido ? AtendimentoStatus[l.naoAtendido.status] : l.dataFim ? AtendimentoStatus.CONCLUIDO : AtendimentoStatus.NOVO,
    solicitadoEm: l.solicitadoEm ?? null, acionadoEm: l.acionadoEm ?? null, chegadaEm: l.chegadaEm ?? null, concluidoEm: l.concluidoEm ?? null,
    ...(l.naoAtendido ? { motivoNaoAtendimento: l.naoAtendido.motivo, detalheNaoAtendimento: l.naoAtendido.detalhe, encerradoPor: 'planilha', encerradoEm: l.dataFim ?? l.dataSolic } : {}),
    // E-mail de login no lugar do nome (planilha 2024) vira o nome da pessoa
    operadorPR7: nomeDoHelpDesk(l.operador, nomesHelpDesk),
    // Sem data na planilha: createdAt é só carimbo técnico — o gráfico ignora pelo detalhes.semData
    createdAt: l.dataSolic ?? l.dataFim ?? new Date(),
    vertical: l.vertical,
    idPR7: l.idPR7 ?? null,
    codigoValidacao: l.codigoValidacao ?? null,
    sap: l.sap ?? null,
    valorPrestador: dec(l.valorPrestador),
    valorTotalPrestador: dec(l.valorTotalPrestador),
    valorCliente: dec(l.valorCliente),
    formaPagamento: l.formaPagamento || null,
    placa: l.placa ?? null,
    latitude: l.latitude ?? null,
    longitude: l.longitude ?? null,
    detalhes: ((): Prisma.InputJsonValue | undefined => {
      const base = l.detalhes ? (JSON.parse(JSON.stringify(l.detalhes)) as Record<string, unknown>) : undefined;
      if (l.dataSolic || l.dataFim) return base as Prisma.InputJsonValue | undefined;
      return { ...(base ?? {}), semData: true } as Prisma.InputJsonValue;
    })(),
    // Veicular não tem conta: guarda cidade/UF no JSON para mapa e filtros
    ...(l.vertical === 'VEICULAR' ? { detalhes: { ...(l.detalhes ?? {}), cidade: l.cidade, estado: l.estado } as Prisma.InputJsonValue } : {}),
  }));

  console.log(`Gravando ${registros.length} atendimentos...`);
  for (let i = 0; i < registros.length; i += 1000) {
    await prisma.atendimento.createMany({ data: registros.slice(i, i + 1000) });
    process.stdout.write(`  ${Math.min(i + 1000, registros.length)}/${registros.length}\r`);
  }
  console.log('\nImportação concluída.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
