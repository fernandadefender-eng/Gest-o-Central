/**
 * Evento da central de rastreamento, como chega no grupo (sem IA):
 *
 *   Descrição do Evento
 *   Painel Violado
 *   Cliente
 *   TRANSPORTES CORDENONSI
 *   Data Evento
 *   15/09/2026 11:24:30
 *   Placa
 *   RYV2F98
 *   Localização
 *   Rua Dom Roberto..., Cajamar, São Paulo, 07787-115, Brasil
 *
 * Só o veicular entra no Monitoramento (regra da operação).
 */
export type EventoTelemetria = {
  descricao: string;
  cliente?: string;
  placa?: string;
  ocorridoEm?: Date;
  localizacao?: string;
  cidade?: string;
  uf?: string;
};

const UFS: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "15/09/2026 11:24:30" no horário de Brasília → instante UTC */
function dataEvento(valor?: string): Date | undefined {
  const m = valor?.match(/(\d{2})\/(\d{2})\/(\d{4})[\s,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mes, ano, h, min, seg] = m;
  return new Date(Date.UTC(+ano, +mes - 1, +d, +h + 3, +min, +(seg ?? 0)));
}

export function lerEventoTelemetria(texto: string): EventoTelemetria | null {
  // O gateway prefixa o autor ("*Laysla Larissa:*"); os campos vêm um por linha
  const linhas = texto.replace(/\*[^*]{0,60}:\*/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const valorDe = (rotulo: RegExp) => {
    const i = linhas.findIndex((l) => rotulo.test(semAcento(l)));
    return i >= 0 && linhas[i + 1] && !/^(descricao|cliente|data|placa|localiza)/.test(semAcento(linhas[i + 1])) ? linhas[i + 1] : undefined;
  };
  const descricao = valorDe(/^descricao do evento$/);
  if (!descricao) return null;

  const localizacao = valorDe(/^localiza[cç]ao$/);
  // "Rua X, Cajamar, São Paulo, 07787-115, Brasil" → cidade = penúltimo antes do estado
  let cidade: string | undefined, uf: string | undefined;
  if (localizacao) {
    const partes = localizacao.split(',').map((p) => p.trim()).filter(Boolean);
    const iEstado = partes.findIndex((p) => UFS[semAcento(p)] || /^[A-Z]{2}$/.test(p));
    if (iEstado > 0) {
      uf = UFS[semAcento(partes[iEstado])] ?? partes[iEstado].toUpperCase();
      cidade = partes[iEstado - 1];
    }
  }
  const placa = valorDe(/^placa$/)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || undefined;
  return {
    descricao,
    cliente: valorDe(/^cliente$/),
    placa: placa && /^[A-Z0-9]{7}$/.test(placa) ? placa : undefined,
    ocorridoEm: dataEvento(valorDe(/^data (do )?evento$/)),
    localizacao, cidade, uf,
  };
}
