/**
 * Arruma o regime de pagamento:
 *  - normaliza as grafias da planilha ("48 Hrs", "48 hrs", "Quinzena", "TX"...);
 *  - no comprovante, o regime passa a vir do atendimento que ele pagou — o nome do
 *    grupo ("Pagamentos em 48 HRS") não define regime, era daí que vinha o erro.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** "48 Hrs" → 48H · "Quinzena" → QUINZENAL · "TX" → TX */
export function normalizarRegime(texto?: string | null): string | null {
  const t = (texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/48/.test(t)) return '48H';
  if (/quinzen/.test(t)) return 'QUINZENAL';
  if (/semanal|semana/.test(t)) return 'SEMANAL';
  if (/mensal|m[eê]s/.test(t)) return 'MENSAL';
  if (/^tx$|taxa/.test(t)) return 'TX';
  return null;
}

async function main() {
  // 1) Atendimento.formaPagamento com grafia padronizada
  const formas = await prisma.atendimento.groupBy({ by: ['formaPagamento'], _count: true });
  let atendimentosAjustados = 0;
  for (const f of formas) {
    const normal = normalizarRegime(f.formaPagamento);
    if (!normal || normal === f.formaPagamento) continue;
    const r = await prisma.atendimento.updateMany({ where: { formaPagamento: f.formaPagamento }, data: { formaPagamento: normal } });
    atendimentosAjustados += r.count;
  }
  console.log(`atendimentos com regime padronizado: ${atendimentosAjustados}`);

  // 2) Pagamento.regime vem do atendimento pago (maioria); sem vínculo, fica vazio
  const pagamentos = await prisma.pagamento.findMany({
    where: { origem: 'WHATSAPP' },
    select: { id: true, regime: true, itens: { select: { atendimento: { select: { formaPagamento: true } } } } },
  });
  let comRegime = 0, semRegime = 0;
  for (const p of pagamentos) {
    const votos = new Map<string, number>();
    for (const i of p.itens) {
      const r = normalizarRegime(i.atendimento?.formaPagamento);
      if (r) votos.set(r, (votos.get(r) ?? 0) + 1);
    }
    const escolhido = [...votos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (escolhido === p.regime) { escolhido ? comRegime++ : semRegime++; continue; }
    await prisma.pagamento.update({ where: { id: p.id }, data: { regime: escolhido } });
    escolhido ? comRegime++ : semRegime++;
  }
  console.log(`comprovantes com regime do atendimento: ${comRegime} · sem regime identificado: ${semRegime}`);

  // 3) Regime do PRESTADOR: a coluna "Pagamento" da planilha é do prestador, não do chamado.
  //    Vale o regime que mais aparece nos atendimentos dele (e o mais recente desempata).
  const prestadores = await prisma.provider.findMany({ select: { id: true, name: true } });
  let comRegimePrestador = 0;
  for (const p of prestadores) {
    const formas = await prisma.atendimento.groupBy({
      by: ['formaPagamento'],
      where: { providerId: p.id, formaPagamento: { not: null } },
      _count: true,
      orderBy: { _count: { formaPagamento: 'desc' } },
    });
    const escolhido = formas.map((f) => normalizarRegime(f.formaPagamento)).find(Boolean) ?? null;
    if (!escolhido) continue;
    await prisma.provider.update({ where: { id: p.id }, data: { regimePagamento: escolhido } });
    comRegimePrestador++;
  }
  console.log(`prestadores com regime definido: ${comRegimePrestador} de ${prestadores.length}`);
  const porRegimePrestador = await prisma.provider.groupBy({ by: ['regimePagamento'], _count: true });
  console.table(porRegimePrestador.map((r) => ({ regime: r.regimePagamento ?? 'não informado', prestadores: r._count })));

  const resumo = await prisma.pagamento.groupBy({ by: ['regime'], _count: true, _sum: { valor: true } });
  console.table(resumo.map((r) => ({ regime: r.regime ?? 'não informado', qtd: r._count, valor: Number(r._sum.valor ?? 0).toFixed(2) })));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
