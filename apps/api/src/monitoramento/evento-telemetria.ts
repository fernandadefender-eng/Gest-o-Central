/**
 * Evento da central de rastreamento, como chega no grupo (sem IA). A central manda em
 * DOIS formatos, e o leitor aceita os dois (com ou sem dois-pontos nos rótulos):
 *
 *  Formato A (rótulo numa linha, valor na linha seguinte):
 *   Descrição do Evento:
 *   Painel Violado
 *   Cliente
 *   TRANSPORTES CORDENONSI
 *   Data Evento
 *   18/09/2026 08:40:50
 *   Placa
 *   RYB9I32
 *   Localização
 *   Rua Dom Roberto..., Cajamar, São Paulo, 07787-115, Brasil
 *
 *  Formato B (rótulo e valor na mesma linha):
 *   TRANSPORTES CORDENONSI
 *   Evento: Painel Violado
 *   Veículo: RAI8G15
 *   Data: 18/09/2026 11:43:55
 *   Endereco: Marginal da BR-101, Itajaí, Santa Catarina, ...
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
// Rótulo normalizado (sem acento, sem dois-pontos no fim): a que campo pertence
const ROTULOS: [keyof typeof MAPA, RegExp][] = [];
const MAPA = {
  descricao: /^(descricao do evento|descricao|evento|tipo de evento|ocorrencia)$/,
  cliente: /^(cliente|empresa|razao social)$/,
  placa: /^(placa|veiculo|veículo|veic)$/,
  data: /^(data( do)? evento|data\/hora|data hora|data)$/,
  local: /^(localiza(c|ç)ao|endereco|endereço|local)$/,
} as const;
for (const k of Object.keys(MAPA) as (keyof typeof MAPA)[]) ROTULOS.push([k, MAPA[k]]);

const rotuloDe = (linhaNorm: string): keyof typeof MAPA | null => {
  for (const [campo, re] of ROTULOS) if (re.test(linhaNorm)) return campo;
  return null;
};

/** "15/09/2026 11:24:30" no horário de Brasília → instante UTC */
function dataEvento(valor?: string): Date | undefined {
  const m = valor?.match(/(\d{2})\/(\d{2})\/(\d{4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mes, ano, h, min, seg] = m;
  return new Date(Date.UTC(+ano, +mes - 1, +d, +h + 3, +min, +(seg ?? 0)));
}

export function lerEventoTelemetria(texto: string): EventoTelemetria | null {
  // O gateway prefixa o autor ("*Laysla Larissa:*"); tira isso e normaliza as linhas
  const linhas = texto.replace(/\*[^*]{0,60}:\*/g, '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const campos: Partial<Record<keyof typeof MAPA, string>> = {};
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    // "Rótulo: valor" na mesma linha
    const inline = linha.match(/^([^:]{2,40}):\s*(.+)$/);
    if (inline) {
      const campo = rotuloDe(semAcento(inline[1]));
      if (campo && campos[campo] === undefined) campos[campo] = inline[2].trim();
      continue;
    }
    // "Rótulo:" (ou "Rótulo") sozinho na linha → valor na próxima linha que não seja rótulo
    const campo = rotuloDe(semAcento(linha).replace(/:$/, ''));
    if (campo && campos[campo] === undefined) {
      const prox = linhas[i + 1];
      if (prox && !rotuloDe(semAcento(prox).replace(/:$/, ''))) campos[campo] = prox.trim();
    }
  }
  const descricao = campos.descricao;
  if (!descricao) return null;

  const localizacao = campos.local;
  let cidade: string | undefined, uf: string | undefined;
  if (localizacao) {
    const partes = localizacao.split(',').map((p) => p.trim()).filter(Boolean);
    const iEstado = partes.findIndex((p) => UFS[semAcento(p)] || /^[A-Z]{2}$/.test(p));
    if (iEstado > 0) {
      uf = UFS[semAcento(partes[iEstado])] ?? partes[iEstado].toUpperCase();
      cidade = partes[iEstado - 1];
    }
  }
  // Cliente: rótulo explícito ou, no formato B, a linha em CAIXA ALTA antes do "Evento:"
  let cliente = campos.cliente;
  if (!cliente) {
    const iEvento = linhas.findIndex((l) => /^evento\b/i.test(l) || /^descricao do evento/i.test(semAcento(l)));
    const anterior = iEvento > 0 ? linhas[iEvento - 1] : undefined;
    if (anterior && anterior.length >= 4 && anterior === anterior.toUpperCase() && !rotuloDe(semAcento(anterior).replace(/:$/, ''))) cliente = anterior;
  }
  const placaBruta = campos.placa?.toUpperCase().replace(/[^A-Z0-9]/g, '') || undefined;
  return {
    descricao,
    cliente,
    placa: placaBruta && /^[A-Z0-9]{7}$/.test(placaBruta) ? placaBruta : undefined,
    ocorridoEm: dataEvento(campos.data),
    localizacao, cidade, uf,
  };
}
