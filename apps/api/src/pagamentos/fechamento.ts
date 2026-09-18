/**
 * Regras de fechamento e prazo de pagamento aos prestadores (confirmadas pela operação):
 *
 * - Regimes: 48H, SEMANAL, QUINZENAL e MENSAL.
 * - A quinzena fecha no dia 15 e no último dia do mês, às 23h59.
 * - Fechou, começam a contar **5 dias úteis** para iniciar os pagamentos.
 *   Ex.: quinzena de setembro/2026 fechou em 16/09 23h59 → pagar até 23/09.
 * - Semanal fecha no domingo; mensal, no último dia do mês; 48H conta direto
 *   do término do atendimento.
 */
export type Regime = '48H' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
export const REGIMES: Regime[] = ['48H', 'SEMANAL', 'QUINZENAL', 'MENSAL'];

const MS_DIA = 864e5;
/** Dia em que a 1ª quinzena fecha (regra da operação) */
export const DIA_DA_QUINZENA = 16;
const ehFimDeSemana = (d: Date) => [0, 6].includes(d.getUTCDay());

/** Soma dias úteis (pula sábado e domingo). Feriados não entram — a central confere. */
export function somarDiasUteis(inicio: Date, dias: number): Date {
  const d = new Date(inicio.getTime());
  let faltam = dias;
  while (faltam > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!ehFimDeSemana(d)) faltam--;
  }
  return d;
}

/** Fim do período em que o atendimento cai, por regime (23h59 no horário de Brasília). */
export function fechamentoDoPeriodo(regime: Regime, quando: Date): Date {
  const ano = quando.getUTCFullYear(), mes = quando.getUTCMonth(), dia = quando.getUTCDate();
  const fimDoDia = (a: number, m: number, d: number) => new Date(Date.UTC(a, m, d, 23, 59, 59) + 3 * 3600e3);
  switch (regime) {
    case '48H':
      return new Date(quando.getTime() + 2 * MS_DIA);
    case 'SEMANAL': {
      // Fecha no domingo da semana do atendimento
      const faltam = (7 - quando.getUTCDay()) % 7;
      const domingo = new Date(quando.getTime() + faltam * MS_DIA);
      return fimDoDia(domingo.getUTCFullYear(), domingo.getUTCMonth(), domingo.getUTCDate());
    }
    // A operação fecha a 1ª quinzena no dia 16 às 23h59 (ex.: setembro/2026 fechou em 16/09)
    case 'QUINZENAL':
      return dia <= DIA_DA_QUINZENA ? fimDoDia(ano, mes, DIA_DA_QUINZENA) : fimDoDia(ano, mes + 1, 0);
    case 'MENSAL':
      return fimDoDia(ano, mes + 1, 0);
  }
}

/** Data limite para iniciar o pagamento: 5 dias úteis após o fechamento. */
export function prazoDePagamento(regime: Regime, quando: Date, diasUteis = 5): Date {
  return somarDiasUteis(fechamentoDoPeriodo(regime, quando), diasUteis);
}

/** Rótulo do período ("1ª quinzena de setembro/2026") para agrupar na tela. */
export function rotuloDoPeriodo(regime: Regime, quando: Date): string {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mes = meses[quando.getUTCMonth()], ano = quando.getUTCFullYear();
  if (regime === 'QUINZENAL') return `${quando.getUTCDate() <= DIA_DA_QUINZENA ? '1ª' : '2ª'} quinzena de ${mes}/${ano}`;
  if (regime === 'MENSAL') return `${mes}/${ano}`;
  if (regime === 'SEMANAL') {
    const f = fechamentoDoPeriodo('SEMANAL', quando);
    return `semana que fecha em ${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return `48 h do atendimento de ${String(quando.getUTCDate()).padStart(2, '0')}/${String(quando.getUTCMonth() + 1).padStart(2, '0')}`;
}
