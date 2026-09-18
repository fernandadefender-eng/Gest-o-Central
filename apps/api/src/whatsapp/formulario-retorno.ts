/**
 * Leitor do formulário de retorno que o prestador manda no grupo:
 *
 *   ID: 36848
 *   Cliente/Estabelecimento: ...
 *   Conta: ...
 *   Contato no local: ...
 *   Relato: ...
 *
 * Lido por texto (sem IA): mais preciso para campos rotulados e sem custo.
 * Aceita negrito/itálico do WhatsApp (*ID:*), bullets e variações de rótulo.
 */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// rótulo normalizado → campo do sistema (mesmos campos da planilha De Mattos)
const ROTULOS: [RegExp, string][] = [
  [/^(id|id do acionamento|id acionamento|id pr7|n[ºo°]? do acionamento)$/, 'id'],
  [/^(cliente\s*\/\s*estabelecimento|estabelecimento|cliente|loja|unidade)$/, 'estabelecimento'],
  [/^(conta|remota|remota ?\/ ?conta|n[ºo°]? da conta|cod(igo)? da conta|codigo conta)$/, 'conta'],
  // "Contato:" sozinho NÃO é responsável (ex: "Contato: informou que já está em contato com a Orsegups")
  [/^(contato no local|contato local|responsavel no local|responsavel local|responsavel)$/, 'contatoLocal'],
  [/^(relato|relatorio|relatorio do agente|descricao|ocorrido)$/, 'relato'],
  [/^(codigo de validacao|cod(igo)? (de )?validacao|validacao|id validacao)$/, 'validacao'],
  [/^(sap|n[ºo°]? sap|cod(igo)? sap|numero sap)$/, 'sap'],
  [/^(nome do agente|agente|agente no local)$/, 'agente'],
  [/^(equipe|prestador)$/, 'equipe'],
  [/^(op\.? solicitante|operador solicitante|solicitante)$/, 'solicitante'],
  [/^(op\.? pr7|operador pr7|operador)$/, 'operadorPR7'],
  [/^(data|data d[aeo] solicitacao|data solicitacao|data da realizacao|data da vistoria)$/, 'data'],
  [/^(ocorrencia|n[ºo°]? da ocorrencia)$/, 'ocorrencia'],
  [/^(hr\.? solicitad[oa]|hora solicitad[oa]|hora da solicitacao)$/, 'horaSolicitada'],
  [/^(hr\.? (de |da |do )?chegada|hora (de |da |do )?chegada|hora no local|chegada)$/, 'horaChegada'],
  [/^(hr\.? (de )?saida|hora (de )?saida|hora termino|termino|saida)$/, 'horaTermino'],
  [/^(servico|servico de|tipo de servico|servico de servico|servico realizado)$/, 'servico'],
  [/^(endereco|local)$/, 'endereco'],
  [/^(cidade)$/, 'cidade'],
  [/^(placa)$/, 'placa'],
];

// Campos exigidos para o retorno contar como completo. Faltando algum: chamado vira
// NÃO ATENDIDO com motivo obrigatório (regra da operação).
export const CAMPOS_OBRIGATORIOS: Record<string, string> = {
  id: 'ID',
  conta: 'Remota/Conta',
  estabelecimento: 'Cliente/Estabelecimento',
  agente: 'Agente',
  horaChegada: 'Hr. de chegada',
  relato: 'Relato',
};
// Desejáveis: a falta vira pendência para completar, sem marcar como não atendido
// (retornos reais bem-sucedidos chegam sem "Contato no local", que aparece no relato)
export const CAMPOS_RECOMENDADOS: Record<string, string> = {
  contatoLocal: 'Contato no local',
};

export interface FormularioRetorno {
  // true = retorno do atendimento (tem relato, hora de chegada ou título "Retorno").
  // false = só identifica o chamado (ex: PR7 repassando "ID: 36878" ao grupo de prestadores)
  ehRetorno: boolean;
  campos: Record<string, string>;   // campos reconhecidos
  extras: Record<string, string>;   // rótulos não mapeados (ex: pedidos específicos do cliente)
  faltando: string[];               // rótulos obrigatórios ausentes/vazios
  recomendadosFaltando: string[];   // rótulos desejáveis ausentes (só pendência)
  completo: boolean;
}

/** Devolve null se a mensagem não parece um formulário (sem ID nem Conta rotulados). */
export function lerFormularioRetorno(texto: string): FormularioRetorno | null {
  const campos: Record<string, string> = {};
  const extras: Record<string, string> = {};
  let ultimo: { alvo: Record<string, string>; chave: string } | null = null;

  // Assinatura do Help Desk no topo ("*Eliane Lopes:*"): é quem postou pela PR7
  const assinatura = texto.trim().split(/\r?\n/)[0]?.match(/^\*?\s*([A-Za-zÀ-ú][A-Za-zÀ-ú .]{1,40}?)\s*:\s*\*?\s*$/)?.[1];
  if (assinatura) campos.assinatura = assinatura.trim();

  for (const linhaCrua of texto.split(/\r?\n/)) {
    // Formato "*Rótulo* valor" / "**ID PR7* 36912" (rótulo em negrito, sem dois-pontos):
    // só vale quando o rótulo é conhecido — texto em negrito do relato continua relato
    const negrito = linhaCrua.trim().match(/^[-•·▪►>\s]*\*{1,2}\s*([^*]{2,40}?)\s*:?\s*\*{1,2}\s*:?\s*(.*)$/);
    if (negrito) {
      const rot = semAcento(negrito[1]).replace(/\s+/g, ' ').trim();
      const mapeado = ROTULOS.find(([re]) => re.test(rot))?.[1];
      if (mapeado) {
        campos[mapeado] = negrito[2].replace(/[*_~`]/g, '').trim();
        ultimo = { alvo: campos, chave: mapeado };
        continue;
      }
    }
    const linha = linhaCrua.replace(/[*_~`]/g, '').replace(/^\s*[-•·▪►>]+\s*/, '').trim();
    if (!linha) continue;
    const m = linha.match(/^([^:]{2,40}):\s*(.*)$/);
    if (m) {
      const rotulo = semAcento(m[1]).replace(/\s+/g, ' ').trim();
      const valor = m[2].trim();
      const mapeado = ROTULOS.find(([re]) => re.test(rotulo))?.[1];
      if (mapeado) { campos[mapeado] = valor; ultimo = { alvo: campos, chave: mapeado }; }
      else { extras[m[1].trim()] = valor; ultimo = { alvo: extras, chave: m[1].trim() }; }
    } else if (ultimo) {
      // Continuação do valor anterior (relato em várias linhas)
      ultimo.alvo[ultimo.chave] = `${ultimo.alvo[ultimo.chave]}\n${linha}`.trim();
    }
  }

  if (!campos.id && !campos.conta) return null;
  if (campos.id) campos.id = campos.id.replace(/\D/g, '');
  const vazio = (k: string) => !campos[k] || /^(-+|n\/?a|n\/?inf|n[aã]o (foi )?informad[oa]|sem informa[cç][aã]o|sem|n[aã]o possui)$/i.test(campos[k].trim());
  // "Conta: Não possui" com o estabelecimento informado é resposta dada (ex: ronda do
  // Posto Raízes, que não tem conta) — não é campo esquecido
  const semContaDeclarada = /^(nao|não) possui|^sem conta/i.test((campos.conta ?? '').trim()) && !vazio('estabelecimento');
  const faltando = Object.entries(CAMPOS_OBRIGATORIOS).filter(([k]) => vazio(k) && !(k === 'conta' && semContaDeclarada)).map(([, rotulo]) => rotulo);
  const recomendadosFaltando = Object.entries(CAMPOS_RECOMENDADOS).filter(([k]) => vazio(k)).map(([, rotulo]) => rotulo);
  // Repasse do chamado (só ID/conta) não é retorno: nunca pode marcar "não atendido"
  const ehRetorno = Boolean(campos.relato || campos.horaChegada || campos.horaTermino || /\bretorno\b/i.test(texto));
  return { ehRetorno, campos, extras, faltando, recomendadosFaltando, completo: ehRetorno && faltando.length === 0 };
}

/**
 * Responsável citado no relato: "Responsável Fabiana informa...", "Denise responsável 13991218452",
 * "contato com responsável Alice". Telefone só se tiver DDD (10–11 dígitos).
 */
export function responsavelNoRelato(relato?: string | null): { nome?: string; telefone?: string } | null {
  if (!relato) return null;
  const nomeDepois = relato.match(/[Rr]espons[aá]vel\s+(?:no local\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)?)/);
  const nomeAntes = relato.match(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)\s+respons[aá]vel/);
  const nome = nomeDepois?.[1] ?? nomeAntes?.[1];
  const tel = relato.match(/respons[aá]vel[^\n\d]{0,40}(\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4})/i)?.[1]?.replace(/\D/g, '');
  if (!nome && !tel) return null;
  return { nome, telefone: tel && /^\d{10,11}$/.test(tel) ? tel : undefined };
}

/** Mensagem de "DIVULGAÇÃO FURTO/ROUBO" (alerta de veículo, não é chamado). */
export function lerDivulgacao(texto: string) {
  if (!/divulga[cç][aã]o/i.test(texto) || !/placa\s*:/i.test(texto)) return null;
  const campo = (re: RegExp) => texto.match(re)?.[1]?.replace(/^[\s:]+/, '').trim() || undefined;
  const latlng = texto.match(/lat\.?\s*\/?\s*long\.?\s*:?\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i);
  const tipo = /roubo/i.test(texto) ? 'ROUBO' : /apropria/i.test(texto) ? 'APROPRIACAO_INDEBITA' : /furto/i.test(texto) ? 'FURTO' : 'OUTRO';
  const placa = campo(/placa\s*:\s*([A-Z0-9-]{7,8})/i)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!placa) return null;
  return {
    tipo, placa,
    chassi: campo(/chassi\s*:\s*([A-Z0-9]{11,17})/i)?.toUpperCase(),
    descricao: campo(/descri[cç][aã]o\s*:\s*([^\n]+)/i)?.replace(/^-\s*/, ''),
    cor: campo(/cor\s*:\s*([^\n]+)/i),
    anoModelo: campo(/ano[^:\n]*:\s*([^\n]+)/i),
    localOcorrencia: campo(/(?:furto|roubo)[^:\n]*ocorreu\s*:+\s*([^\n]+)/i) ?? campo(/local\s*:\s*([^\n]+)/i),
    latitude: latlng ? Number(latlng[1]) : undefined,
    longitude: latlng ? Number(latlng[2]) : undefined,
    dataHora: campo(/data\s*\/\s*hora\s*:\s*([^\n]+)/i),
  };
}

/**
 * "20:45" (horário de Brasília) + data do formulário ou da mensagem → instante real (UTC),
 * igual às mensagens do WhatsApp. Brasília = UTC-3, sem horário de verão desde 2019.
 */
export function horaDoFormulario(valor: string | undefined, dataBase: Date, dataTexto?: string): Date | null {
  if (!valor) return null;
  const completo = valor.match(/(\d{2})\/(\d{2})\/(\d{4})\D+(\d{1,2})[:h](\d{2})/);
  if (completo) return new Date(Date.UTC(+completo[3], +completo[2] - 1, +completo[1], +completo[4] + 3, +completo[5]));
  const hm = valor.match(/(\d{1,2})[:h](\d{2})/);
  if (!hm || +hm[1] > 23 || +hm[2] > 59) return null;
  const d = dataTexto?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const [diaB, mesB, anoB] = dataBase.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').map(Number);
  const [ano, mes, dia] = d ? [+d[3], +d[2] - 1, +d[1]] : [anoB, mesB - 1, diaB];
  return new Date(Date.UTC(ano, mes, dia, +hm[1] + 3, +hm[2]));
}
