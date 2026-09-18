/** Remove acentos, caixa e espaços extras — para comparar nomes digitados de jeitos diferentes. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Chave única de cidade: "sao paulo|SP". */
export function chaveCidade(cidade: string, uf: string): string {
  return `${normalizar(cidade)}|${uf.toUpperCase()}`;
}

/**
 * Separa nome e telefone de textos como "Fulano de Tal (11) 91234-5678".
 * Aplica as regras do cadastro: telefone com DDD e nome com sobrenome.
 */
/**
 * Telefone num formato só: DDD + número, celular sempre com o 9 na frente.
 * "43 9907-1221" e "43 99907-1221" são o mesmo celular (o 9 foi acrescentado em 2012–2016
 * e a planilha tem os dois jeitos) — sem isso a mesma pessoa virava dois cadastros.
 * Fixo (número começando com 2 a 5) continua com 10 dígitos.
 */
export function telefoneCanonico(t?: string | null): string | null {
  let d = (t ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  return d.length === 10 || d.length === 11 ? d : d || null;
}

export function separarContato(bruto: string) {
  const inicioTelefone = bruto.search(/[+(]?\d/);
  const nome = (inicioTelefone >= 0 ? bruto.slice(0, inicioTelefone) : bruto)
    .replace(/[\s\-–:(|/]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let digitos = inicioTelefone >= 0 ? bruto.slice(inicioTelefone).replace(/\D/g, '') : '';
  if (digitos.length >= 12 && digitos.startsWith('55')) digitos = digitos.slice(2);

  const pendencias: string[] = [];
  let telefone: string | null = null;
  if (digitos.length === 10 || digitos.length === 11) telefone = telefoneCanonico(digitos);
  else if (digitos.length === 8 || digitos.length === 9) {
    telefone = digitos;
    pendencias.push('Telefone sem DDD');
  } else pendencias.push('Sem telefone');

  if (nome.split(' ').filter((p) => p.length > 1).length < 2) pendencias.push('Nome sem sobrenome');

  return { nome, telefone, pendencias };
}
