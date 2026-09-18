import { normalizar } from '../geo/normalizar';

type EmpresaBusca = { id: string; razaoSocial: string; nomeFantasia: string | null; cidade: string | null; apelidos: string[] };

/**
 * Descobre a empresa cliente pelo nome do grupo ("PR7 & ORSEGUPS" → Orsegups).
 * Empresa com várias filiais (ex: Segurpro por cidade): prefere a filial cuja cidade
 * aparece no nome do grupo; senão, a de razão social mais curta (matriz).
 */
export function empresaDoGrupo<T extends EmpresaBusca>(nomeGrupo: string | null | undefined, empresas: T[]): T | null {
  const nome = ` ${normalizar(nomeGrupo ?? '').replace(/[^a-z0-9\s-]/g, ' ')} `;
  if (!nome.trim()) return null;
  const candidatas = empresas.filter((e) => e.apelidos.some((a) => a.length >= 3 && nome.includes(` ${a} `)));
  if (!candidatas.length) return null;
  const naCidade = candidatas.find((e) => e.cidade && nome.includes(` ${normalizar(e.cidade)} `));
  if (naCidade) return naCidade;
  return [...candidatas].sort((a, b) => a.razaoSocial.length - b.razaoSocial.length)[0];
}
