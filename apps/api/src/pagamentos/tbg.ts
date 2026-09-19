/**
 * Valor acordado do APOIO nos pontos TBG (não confundir com os R$350 do cliente).
 * A tabela vem da config `tbg_apoios` (importada da aba TBG-SEGURPRO). Quando o
 * atendimento é num ponto TBG e o apoio está na tabela com valor acordado, esse
 * valor prevalece sobre o cálculo padrão — é uma regra de valor por pessoa/ponto.
 */
export type ApoioTbg = {
  nome: string; telefone: string; cpf: string; ponto: string; conta: string;
  cidade: string; uf: string; camisa: string; atende: string; valorAcordado: number | null; obs: string;
};
export type ConfigTbg = { apoios: ApoioTbg[]; regraCamiseta?: string; clienteValorFixo?: number };

const norm = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digitos = (s: string) => (s || '').replace(/\D/g, '');

/** É um atendimento em ponto TBG? Olha estabelecimento, ponto e texto do chamado. */
export function ehPontoTbg(...textos: (string | null | undefined)[]): boolean {
  return textos.some((t) => /\btbg\b/i.test(t || ''));
}

/**
 * Acha o valor acordado do apoio na TBG. Casa pelo telefone (mais confiável) e,
 * na falta, pelo nome. Retorna null quando não há apoio/valor — aí segue a regra padrão.
 */
export function valorAcordadoTbg(
  cfg: ConfigTbg | null,
  prestador: { name?: string | null; apelido?: string | null; phone?: string | null },
): { valor: number; apoio: ApoioTbg } | null {
  if (!cfg?.apoios?.length) return null;
  const tel = digitos(prestador.phone || '');
  const nomes = [norm(prestador.name || ''), norm(prestador.apelido || '')].filter(Boolean);
  const casa = cfg.apoios.find((a) => {
    if (a.valorAcordado == null) return false;
    if (tel && a.telefone && digitos(a.telefone) === tel) return true;
    const an = norm(a.nome);
    return nomes.some((n) => n && (n === an || an.includes(n) || n.includes(an)));
  });
  return casa && casa.valorAcordado != null ? { valor: casa.valorAcordado, apoio: casa } : null;
}
