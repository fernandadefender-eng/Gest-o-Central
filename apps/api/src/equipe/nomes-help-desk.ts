/**
 * Nome do Help Desk a partir do que veio na origem. Na planilha de 2024 (jan–abr) e em
 * alguns dias de jul/2025 a coluna "Operador" traz o E-MAIL de login em vez do nome —
 * a mesma pessoa aparecia duas vezes no ranking.
 *
 * Nenhum e-mail fica guardado no código: o nome é reconhecido pelas palavras antes do
 * "@" ("eliane.lopes…" → "Eliane Lopes") comparadas com os nomes do Help Desk que já
 * existem na base. Sem correspondência segura, o valor fica como veio.
 */
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Mesma pessoa escrita de jeitos diferentes → um nome só (confirmado pela operação).
 * Chave: nome sem acento e em minúsculas. Vale para planilha e WhatsApp.
 */
const MESMA_PESSOA: Record<string, string> = {
  // 18/09/2026: "a Ingridy é só uma" — Lorrayne/Lorrany/Lorranny são grafias do mesmo nome
  'ingridy': 'Ingridy Lorranny Oliveira Silva',
  'ingridy lorrayne': 'Ingridy Lorranny Oliveira Silva',
  'ingridy lorrany': 'Ingridy Lorranny Oliveira Silva',
  'ingridy lorranny': 'Ingridy Lorranny Oliveira Silva',
  'ingridy lorranny oliveira silva': 'Ingridy Lorranny Oliveira Silva',
  // 18/09/2026: "Eliane também só tem uma"
  'eliane': 'Eliane Lopes',
  // 18/09/2026 (revisão de duplicidades): só existe UMA pessoa com esse primeiro nome no Help Desk.
  // 18/09/2026: "Carlos é o Carlos Gabriel" (confirmado pela operação)
  'carlos': 'Carlos Gabriel',
  'bruno': 'Bruno Alves',
  'bruno alves': 'Bruno Alves',
  'hemily': 'Hemily Dias',
  'laysla': 'Laysla Larissa',
  'marlon': 'Marlon Paulo de Oliveira Silva',
  'joao': 'João Victor Da Costa Vasconcelos',
  'joao victor': 'João Victor Da Costa Vasconcelos',
  'joao victor da costa vasconcelos': 'João Victor Da Costa Vasconcelos',
};

/**
 * Quem não faz mais parte da equipe (18/09/2026: "está fora do jogo: Edi Carlos, Julia").
 * O histórico fica; saem do ranking, das comparações e do feedback da equipe atual.
 */
export const FORA_DA_EQUIPE: Record<string, string> = {
  'Edi Carlos': '2026-09-18',
  'Julia Farias': '2026-09-18',
};

/**
 * Pessoas do CLIENTE que aparecem na coluna de operador (não são Help Desk da PR7).
 * 18/09/2026: "Vanessa, ela é cliente Power".
 */
export const OPERADORES_DO_CLIENTE: Record<string, string> = {
  vanessa: 'Power',
};

/** Todas as grafias conhecidas de cada pessoa (para a revisão de duplicidades no banco). */
export const GRAFIAS_DA_MESMA_PESSOA = MESMA_PESSOA;

export function nomeDoHelpDesk(valor: string | null | undefined, nomesConhecidos: string[] = []): string | null {
  const v = (valor ?? '').trim();
  if (!v) return null;
  // Contato do cliente escrito no lugar do Help Desk: não é da PR7
  if (OPERADORES_DO_CLIENTE[semAcento(v).replace(/\s+/g, ' ')]) return null;
  const canonico = MESMA_PESSOA[semAcento(v).replace(/\s+/g, ' ')];
  if (canonico) return canonico;
  if (!v.includes('@')) return v;
  const local = semAcento(v.split('@')[0]).replace(/[^a-z]/g, ' ');
  // Pontua cada nome: primeiro nome obrigatório + quantos outros nomes aparecem no login
  const candidatos: { nome: string; pontos: number }[] = [];
  for (const nome of nomesConhecidos) {
    if (nome.includes('@')) continue;
    const partes = semAcento(nome).split(/\s+/).filter((p) => p.length >= 3);
    if (!partes.length || !local.startsWith(partes[0])) continue;
    candidatos.push({ nome, pontos: partes.filter((p) => local.includes(p)).length });
  }
  if (!candidatos.length) return v;
  const max = Math.max(...candidatos.map((c) => c.pontos));
  const empatados = candidatos.filter((c) => c.pontos === max);
  // Só o primeiro nome bate e há mais de uma pessoa com ele (ex: duas "Ingridy"):
  // não dá para saber quem é — fica como veio, sem adivinhar
  const primeiros = new Set(empatados.map((c) => c.nome.split(' ').slice(0, 2).join(' ').toLowerCase()));
  if (max < 2 && primeiros.size > 1) return v;
  // Mesmo nome escrito curto e completo ("João Victor" / "João Victor Da Costa Vasconcelos"): o completo
  return empatados.sort((a, b) => b.nome.length - a.nome.length)[0].nome;
}
