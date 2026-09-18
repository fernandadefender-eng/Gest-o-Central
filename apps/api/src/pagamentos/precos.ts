/**
 * Valor pago ao prestador por atendimento — regras da operação (18/09/2026) conferidas
 * com a planilha de pagamentos de 2025/2026:
 *
 *  - Patrimonial (ronda, pronta resposta, vistoria): R$ 70 fixo.
 *  - Preservação: R$ 25 a R$ 30 POR HORA (a planilha guarda a taxa; total = horas × taxa).
 *    Usa a taxa que o próprio prestador costuma receber; sem histórico, R$ 30.
 *  - Veicular: valor base do cliente + km excedente + horas excedentes + gastos adicionais.
 *    Fórmulas da planilha: franquia 50 km e 3 h; R$ 1,20 por km e R$ 35 por hora além disso.
 *  - Locais difíceis têm valor diferente: o calculado é só o ponto de partida — o valor
 *    editado no chamado prevalece e nunca é recalculado (detalhes.valorManual).
 *  - Antenista (Técnico de RF em Geolocalização) e acompanhamento velado: sem regra
 *    definida ainda → não calcula (fica pendente para a operação informar).
 */
export const TABELA_PRECOS = {
  patrimonialFixo: 70,
  preservacaoHoraPadrao: 30,
  preservacaoFaixa: [25, 30] as [number, number],
  veicular: {
    franquiaKm: 50,
    valorKmExcedente: 1.2,
    franquiaHoras: 3,
    valorHoraExcedente: 35,
    basePadrao: 200,
    // Valor base mais usado por cliente na planilha 2025 (demais: basePadrao)
    basePorCliente: { swint: 150, 'locca-bailo': 180 } as Record<string, number>,
  },
};

export type Calculo = { valor: number; regra: string; memoria: string; conferir: string[] } | { valor: null; regra: string; memoria: string; conferir: string[] };

const horasEntre = (a?: Date | null, b?: Date | null) => (a && b && +b > +a ? (+b - +a) / 3600e3 : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularValorPrestador(a: {
  vertical: string; category: string | null; clienteNome?: string | null;
  chegadaEm?: Date | null; concluidoEm?: Date | null; solicitadoEm?: Date | null;
  detalhes?: Record<string, unknown> | null;
}, taxaPreservacaoDoPrestador?: number | null): Calculo {
  const cat = (a.category ?? '').toLowerCase();
  const d = a.detalhes ?? {};

  // "Análise de Tecnologia Rastreável" é o serviço do antenista (busca por RF)
  if (/antenista|\br\.?f\b|geolocaliza|tecnologia rastre/.test(cat)) return { valor: null, regra: 'Antenista', memoria: 'Valor do antenista ainda não definido', conferir: ['informar a regra do antenista'] };
  if (/roteiriz|acompanhamento/.test(cat)) return { valor: null, regra: 'Acompanhamento velado', memoria: 'Regra do acompanhamento ainda não definida', conferir: ['informar a regra do acompanhamento'] };

  if (a.vertical === 'VEICULAR') {
    const v = TABELA_PRECOS.veicular;
    const cli = (a.clienteNome ?? '').toLowerCase();
    const chaveBase = Object.keys(v.basePorCliente).find((k) => cli.includes(k));
    const base = chaveBase ? v.basePorCliente[chaveBase] : v.basePadrao;
    const kmTotal = Number(d.kmTotal ?? (d.kmFinal != null && d.kmInicial != null ? Number(d.kmFinal) - Number(d.kmInicial) : NaN));
    const horas = horasEntre(a.solicitadoEm, a.concluidoEm);
    const gastos = Number(d.custosAdicionais ?? 0) + Number(d.pedagio ?? 0) + Number(d.alimentacao ?? 0) + Number(d.combustivel ?? 0);
    const conferir: string[] = [];
    let total = base;
    const partes = [`base R$ ${base}${chaveBase ? '' : ' (padrão)'}`];
    if (Number.isFinite(kmTotal)) {
      const exc = Math.max(kmTotal - v.franquiaKm, 0);
      if (exc) { total += exc * v.valorKmExcedente; partes.push(`${exc} km excedentes × R$ ${v.valorKmExcedente} = R$ ${r2(exc * v.valorKmExcedente)}`); }
    } else conferir.push('km rodados não informados');
    if (horas !== null) {
      const exc = Math.max(horas - v.franquiaHoras, 0);
      if (exc) { total += exc * v.valorHoraExcedente; partes.push(`${r2(exc)} h excedentes × R$ ${v.valorHoraExcedente} = R$ ${r2(exc * v.valorHoraExcedente)}`); }
    } else conferir.push('horário de término não informado');
    if (gastos > 0) { total += gastos; partes.push(`gastos adicionais R$ ${r2(gastos)}`); }
    return { valor: r2(total), regra: 'Veicular (base + km + horas + gastos)', memoria: partes.join(' + '), conferir };
  }

  if (/preserva/.test(cat)) {
    const taxa = taxaPreservacaoDoPrestador && taxaPreservacaoDoPrestador >= TABELA_PRECOS.preservacaoFaixa[0] && taxaPreservacaoDoPrestador <= TABELA_PRECOS.preservacaoFaixa[1]
      ? taxaPreservacaoDoPrestador : TABELA_PRECOS.preservacaoHoraPadrao;
    const horas = horasEntre(a.chegadaEm, a.concluidoEm);
    if (horas === null) return { valor: null, regra: 'Preservação (por hora)', memoria: `R$ ${taxa}/h — falta chegada e término para calcular`, conferir: ['horário de chegada/término'] };
    // Horas e minutos exatos × taxa, como na planilha (sem arredondamento inventado)
    const hhmm = `${Math.floor(horas)}h${String(Math.round((horas % 1) * 60)).padStart(2, '0')}`;
    const conferir = taxaPreservacaoDoPrestador ? [] : ['taxa padrão R$ 30/h — confirmar se é 25 ou 30'];
    // Preservação muito curta costuma ser horário lançado errado — não paga automático
    if (horas < 1) return { valor: null, regra: 'Preservação (por hora)', memoria: `${hhmm} × R$ ${taxa}/h — menos de 1 hora, conferir os horários`, conferir: ['preservação com menos de 1 h: conferir chegada e término', ...conferir] };
    return { valor: r2(horas * taxa), regra: 'Preservação (por hora)', memoria: `${hhmm} × R$ ${taxa}/h${taxaPreservacaoDoPrestador ? ' (taxa do prestador)' : ' (taxa padrão)'}`, conferir };
  }

  return { valor: TABELA_PRECOS.patrimonialFixo, regra: 'Patrimonial fixo', memoria: `R$ ${TABELA_PRECOS.patrimonialFixo} por atendimento`, conferir: [] };
}
