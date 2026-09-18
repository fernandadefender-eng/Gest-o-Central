/**
 * Áreas de risco e ocorrências públicas: o que alimenta o mapa de alerta do Veicular.
 *
 * Regra do projeto: o sistema NUNCA estima domínio de facção. Só entra o que vem de
 * fonte pública identificada (GENI/UFF + Fogo Cruzado, ISP-RJ, SSP-SP), com data de
 * referência e link guardados junto do registro.
 */
export const FACCOES = ['CV', 'TCP', 'ADA', 'CI', 'MILICIA', 'PCC', 'OUTRA', 'INDEFINIDA'] as const;
export type Faccao = (typeof FACCOES)[number];

export const NOME_FACCAO: Record<string, string> = {
  CV: 'Comando Vermelho',
  TCP: 'Terceiro Comando Puro',
  ADA: 'Amigos dos Amigos',
  CI: 'Comando Independente',
  MILICIA: 'Milícia',
  PCC: 'Primeiro Comando da Capital',
  OUTRA: 'Outro grupo armado',
  INDEFINIDA: 'Sem identificação',
};

/** Cor de cada grupo no mapa (o painel usa a mesma tabela). */
export const COR_FACCAO: Record<string, string> = {
  CV: '#fb7185',
  TCP: '#fbbf24',
  ADA: '#38bdf8',
  CI: '#a78bfa',
  MILICIA: '#f97316',
  PCC: '#ef4444',
  OUTRA: '#94a3b8',
  INDEFINIDA: '#64748b',
};

export function normalizarFaccao(texto?: string | null): Faccao {
  const t = (texto ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ');
  if (/COMANDO VERMELHO|\bCV\b/.test(t)) return 'CV';
  if (/TERCEIRO COMANDO|\bTCP\b|\bTC\b/.test(t)) return 'TCP';
  if (/AMIGOS DOS AMIGOS|\bADA\b/.test(t)) return 'ADA';
  if (/COMANDO INDEPENDENTE|\bCI\b/.test(t)) return 'CI';
  if (/MILICIA|MILÍCIA/.test(t)) return 'MILICIA';
  if (/PRIMEIRO COMANDO|\bPCC\b/.test(t)) return 'PCC';
  if (!t.trim()) return 'INDEFINIDA';
  return 'OUTRA';
}

export function normalizarSituacao(texto?: string | null): string | null {
  const t = (texto ?? '').toLowerCase();
  if (/disput/.test(t)) return 'DISPUTA';
  if (/influ/.test(t)) return 'INFLUENCIA';
  if (/domin/.test(t)) return 'DOMINIO';
  return null;
}


/**
 * Nível de risco por volume de crime contra veículo no município (12 meses).
 * Usado quando a fonte é estatística e não fala de facção.
 */
export const NIVEIS = [
  { nivel: 'CRITICO', rotulo: 'Crítico', cor: '#b91c1c', desde: 2000 },
  { nivel: 'ALTO', rotulo: 'Alto', cor: '#dc2626', desde: 500 },
  { nivel: 'MEDIO', rotulo: 'Médio', cor: '#ef4444', desde: 100 },
  { nivel: 'BAIXO', rotulo: 'Baixo', cor: '#f87171', desde: 0 },
] as const;

export function nivelDeRisco(totalNoPeriodo: number) {
  return NIVEIS.find((n) => totalNoPeriodo >= n.desde) ?? NIVEIS[NIVEIS.length - 1];
}
