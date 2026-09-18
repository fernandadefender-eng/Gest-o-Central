/**
 * Leitura da extração do grupo "Patrimonial/Comprovantes/Pagamentos em 48 HRS".
 * Só lê e mede o encaixe (não grava nada) — use antes da importação.
 *
 *   npx ts-node -T scripts/ler-comprovantes.ts "<pasta com _chat.txt>"
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

export type Comprovante = {
  quando: Date;
  autor: string;
  prestador?: string;
  regiao?: string;
  cidade?: string;
  cliente?: string;
  conta?: string;
  valor?: number;
  dataPagamento?: string;
  ids: string[];
  anexo?: string;
  texto: string;
};

const CABECALHO = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] ([^:]+): ?(.*)$/;

/** Quebra o _chat.txt em mensagens (a mensagem continua nas linhas seguintes). */
export function lerMensagens(pasta: string) {
  const bruto = readFileSync(join(pasta, '_chat.txt'), 'utf8').replace(/‎/g, '');
  const mensagens: { quando: Date; autor: string; texto: string }[] = [];
  let atual: { quando: Date; autor: string; texto: string } | null = null;
  for (const linha of bruto.split(/\r?\n/)) {
    const m = CABECALHO.exec(linha);
    if (m) {
      if (atual) mensagens.push(atual);
      const [, d, mes, ano, h, min, seg] = m;
      // Horário do export é local (Brasília) → UTC
      atual = { quando: new Date(Date.UTC(+ano, +mes - 1, +d, +h + 3, +min, +seg)), autor: m[7].trim(), texto: m[8] };
    } else if (atual) atual.texto += '\n' + linha;
  }
  if (atual) mensagens.push(atual);
  return mensagens;
}

const campo = (texto: string, re: RegExp) => texto.match(re)?.[1]?.replace(/\*/g, '').trim() || undefined;

/** Valor em reais: "R$ 60,00", "60.00", "R$60" */
function lerValor(texto: string): number | undefined {
  const m = texto.match(/valor\s*:?\s*\/?\s*R?\$?\s*([\d.,]+)/i);
  if (!m) return undefined;
  const bruto = m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : undefined;
}

/**
 * IDs de atendimento citados. Só conta o que vem depois do rótulo "ID/IDs"
 * ("Joe Franco/ RJ/ IDs 29686/30072"): sem isso, CEP, valor e telefone entram como ID.
 */
function lerIds(texto: string): string[] {
  const marca = texto.match(/\bids?\s*:?\s*([\d\s/,.;e-]+)/i);
  if (!marca) return [];
  // Tira datas (01/12) e mantém só números de 5 dígitos
  const trecho = marca[1].replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ');
  return [...new Set([...trecho.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]))];
}

export function lerComprovante(m: { quando: Date; autor: string; texto: string }): Comprovante | null {
  const texto = m.texto;
  const anexo = texto.match(/<anexado:\s*([^>]+)>/i)?.[1]?.trim();
  const ids = lerIds(texto);
  const valor = lerValor(texto);

  // Formato antigo: "Apoio: Nome / Cidade: X / Pix: ... / Valor: R$ 60,00 / Cliente / Conta / Status"
  const apoio = campo(texto, /apoio\s*:?\s*\/?\s*([^\n\/]+)/i);
  // Formato atual: "Nome/ Região/ IDs 29686/30072 <anexado: foto>"
  const primeiraLinha = texto.split('\n')[0].replace(/<anexado:[^>]+>/i, '').trim();
  const partes = primeiraLinha.split('/').map((p) => p.trim()).filter(Boolean);
  const nomeDireto = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'.]+(\s+[A-Za-zÀ-ÿ'.]+)*$/.test(partes[0] ?? '') && !/\d/.test(partes[0] ?? '') ? partes[0] : undefined;

  const prestador = apoio ?? nomeDireto;
  if (!prestador && !ids.length && !valor) return null;
  if (!anexo && !valor && !ids.length) return null;

  const regiao = apoio
    ? campo(texto, /cidade\s*:?\s*\/?\s*([^\n\/]+)/i)
    : partes[1] && !/^ids?\b/i.test(partes[1]) && !/^\d/.test(partes[1]) ? partes[1] : undefined;

  return {
    quando: m.quando, autor: m.autor, prestador, regiao,
    cidade: campo(texto, /cidade\s*:?\s*\/?\s*([^\n\/]+)/i),
    cliente: campo(texto, /cliente\s*:?\s*\/?\s*([^\n\/]+)/i),
    conta: campo(texto, /conta\s*:?\s*\/?\s*([A-Z0-9-]{3,8})/i),
    valor,
    dataPagamento: campo(texto, /data\s*(?:de\s*)?(?:pagamento|pgto)?\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i),
    ids, anexo, texto: texto.slice(0, 2000),
  };
}

async function main() {
  const pasta = process.argv[2];
  if (!pasta) { console.error('informe a pasta com o _chat.txt'); process.exit(1); }
  const mensagens = lerMensagens(pasta);
  const comprovantes = mensagens.map(lerComprovante).filter((c): c is Comprovante => !!c);
  console.log(`mensagens: ${mensagens.length} · comprovantes lidos: ${comprovantes.length}`);
  console.log(`com foto: ${comprovantes.filter((c) => c.anexo).length} · com valor: ${comprovantes.filter((c) => c.valor).length} · com ID: ${comprovantes.filter((c) => c.ids.length).length}`);

  const todosIds = [...new Set(comprovantes.flatMap((c) => c.ids))];
  console.log(`IDs distintos citados: ${todosIds.length}`);

  const prisma = new PrismaClient();
  const existentes = await prisma.atendimento.findMany({ where: { idPR7: { in: todosIds } }, select: { idPR7: true, valorPrestador: true, solicitadoEm: true } });
  const comValor = existentes.filter((a) => a.valorPrestador != null).length;
  console.log(`IDs que existem no sistema: ${existentes.length} (${comValor} já têm valor, ${existentes.length - comValor} sem valor)`);

  const porAno = new Map<string, { qtd: number; valor: number }>();
  for (const c of comprovantes) {
    const ano = String(c.quando.getUTCFullYear());
    const a = porAno.get(ano) ?? { qtd: 0, valor: 0 };
    a.qtd++; a.valor += c.valor ?? 0;
    porAno.set(ano, a);
  }
  console.log('\npor ano (comprovantes / valor informado no texto):');
  for (const [ano, a] of [...porAno.entries()].sort()) console.log(`  ${ano}: ${a.qtd} · R$ ${a.valor.toFixed(2)}`);

  console.log('\nexemplos:');
  for (const c of comprovantes.filter((x) => x.ids.length && x.anexo).slice(-5)) {
    console.log(`  ${c.quando.toISOString().slice(0, 10)} | ${c.prestador ?? '?'} | ${c.regiao ?? ''} | IDs ${c.ids.join(',')} | ${c.anexo}`);
  }
  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
