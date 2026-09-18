/**
 * Importa os comprovantes de pagamento extraídos do grupo do WhatsApp.
 *
 *   npx ts-node -T scripts/importar-comprovantes.ts "<pasta com _chat.txt>" [--sem-fotos]
 *
 * - Um comprovante pode cobrir vários atendimentos (IDs citados na mensagem).
 * - Roda quantas vezes precisar: a chave (horário + texto) evita duplicar.
 * - A foto do comprovante vai para storage/comprovantes (visível a ADM/supervisor).
 * - Chave Pix NÃO é gravada: fica só no texto original do comprovante, que é
 *   guardado sem os dígitos da chave (regra de dados sensíveis do projeto).
 */
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { lerComprovante, lerMensagens } from './ler-comprovantes';

const prisma = new PrismaClient();
const PASTA_DESTINO = resolve(__dirname, '..', '..', '..', 'storage', 'comprovantes');

/** Tira a chave Pix do texto guardado (CPF, CNPJ, celular) */
function semPix(texto: string) {
  return texto.replace(/(pix\s*:?\s*)([^\n]+)/gi, (_, rotulo: string) => `${rotulo}[removido]`);
}

/**
 * Regime só quando a PRÓPRIA mensagem diz. O nome do grupo ("Pagamentos em 48 HRS")
 * não vale como regime — senão todo comprovante vira 48 h. Quando a mensagem não diz,
 * o regime vem do atendimento pago (scripts/corrigir-regimes.ts).
 */
function regimeDoTexto(texto: string, _grupo: string): string | null {
  const t = texto.toLowerCase();
  if (/48\s*h/.test(t)) return '48H';
  if (/quinzen/.test(t)) return 'QUINZENAL';
  if (/semanal/.test(t)) return 'SEMANAL';
  if (/mensal/.test(t)) return 'MENSAL';
  return null;
}

const dataBr = (s?: string) => {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return null;
  const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(Date.UTC(ano, +m[2] - 1, +m[1], 12));
};

async function main() {
  const pasta = process.argv[2];
  const semFotos = process.argv.includes('--sem-fotos');
  if (!pasta) { console.error('informe a pasta com o _chat.txt'); process.exit(1); }
  if (!semFotos) mkdirSync(PASTA_DESTINO, { recursive: true });

  const grupo = 'Patrimonial/Comprovantes/Pagamentos em 48 HRS Somente 02';
  const mensagens = lerMensagens(pasta);
  const comprovantes = mensagens.map(lerComprovante).filter((c): c is NonNullable<typeof c> => !!c);
  console.log(`comprovantes lidos: ${comprovantes.length}`);

  // Prestadores cadastrados, para ligar pelo nome
  const prestadores = await prisma.provider.findMany({ select: { id: true, name: true, apelido: true } });
  const porNome = new Map<string, string>();
  const chaveNome = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  for (const p of prestadores) {
    porNome.set(chaveNome(p.name), p.id);
    if (p.apelido) porNome.set(chaveNome(p.apelido), p.id);
  }

  let novos = 0, repetidos = 0, ligados = 0, fotos = 0, semAtendimento = 0;
  for (const c of comprovantes) {
    const chave = createHash('sha256').update(`${c.quando.toISOString()}|${c.texto}`).digest('hex').slice(0, 32);
    if (await prisma.pagamento.findUnique({ where: { chave }, select: { id: true } })) { repetidos++; continue; }

    // Foto do comprovante: uma cópia em storage/comprovantes
    let arquivo: string | null = null;
    if (!semFotos && c.anexo) {
      const origem = join(pasta, c.anexo);
      if (existsSync(origem)) {
        const destino = join(PASTA_DESTINO, c.anexo);
        if (!existsSync(destino)) copyFileSync(origem, destino);
        arquivo = c.anexo;
        fotos++;
      }
    }

    const nome = (c.prestador ?? 'Não identificado').slice(0, 120);
    const pagamento = await prisma.pagamento.create({
      data: {
        prestadorNome: nome,
        providerId: porNome.get(chaveNome(nome)) ?? null,
        regiao: c.regiao?.slice(0, 120) ?? null,
        cidade: c.cidade?.slice(0, 120) ?? null,
        cliente: c.cliente?.slice(0, 120) ?? null,
        conta: c.conta?.slice(0, 20) ?? null,
        valor: c.valor != null ? new Prisma.Decimal(c.valor.toFixed(2)) : null,
        regime: regimeDoTexto(c.texto, grupo),
        pagoEm: dataBr(c.dataPagamento) ?? c.quando,
        arquivo,
        grupo, autor: c.autor.slice(0, 80), chave, recebidoEm: c.quando,
        textoOriginal: semPix(c.texto).slice(0, 2000),
      },
    });
    novos++;

    for (const idPR7 of c.ids) {
      const atendimento = await prisma.atendimento.findFirst({ where: { idPR7 }, select: { id: true, valorPrestador: true } });
      await prisma.pagamentoAtendimento.create({
        data: { pagamentoId: pagamento.id, idPR7, atendimentoId: atendimento?.id ?? null, valor: pagamento.valor },
      });
      if (!atendimento) { semAtendimento++; continue; }
      ligados++;
      await prisma.atendimento.update({
        where: { id: atendimento.id },
        data: {
          pagoEm: pagamento.pagoEm,
          // Valor só entra quando o atendimento ainda não tem (a planilha manda)
          ...(atendimento.valorPrestador == null && pagamento.valor ? { valorPrestador: pagamento.valor } : {}),
        },
      });
    }
    if (novos % 500 === 0) process.stdout.write(`  ${novos} comprovantes gravados\r`);
  }

  console.log(`\nnovos: ${novos} · já existiam: ${repetidos} · fotos copiadas: ${fotos}`);
  console.log(`vínculos com atendimento: ${ligados} · IDs sem atendimento no sistema: ${semAtendimento}`);

  const pagos = await prisma.atendimento.count({ where: { pagoEm: { not: null } } });
  const totalPago = await prisma.pagamento.aggregate({ _sum: { valor: true }, _count: true });
  console.log(`atendimentos marcados como pagos: ${pagos}`);
  console.log(`pagamentos: ${totalPago._count} · soma dos valores informados: R$ ${totalPago._sum.valor ?? 0}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
