/**
 * Auditoria de qualidade dos dados importados: procura campo trocado, valor fora
 * de faixa e linha do tempo impossível. Só lê e relata — não altera nada.
 *
 *   npx ts-node -T scripts/analisar-qualidade.ts [--exemplos 5]
 */
import { PrismaClient } from '@prisma/client';
import { ufValida } from '../src/mapa/estados';

const prisma = new PrismaClient();
const QUANTOS = Number(process.argv[process.argv.indexOf('--exemplos') + 1]) || 4;

const PLACA_OK = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/; // AAA1234 e AAA1A23 (Mercosul)
const SO_LETRAS = /^[A-Za-zÀ-ÿ .'-]+$/;

type Problema = { chave: string; descricao: string; exemplos: string[]; total: number };

async function main() {
  const problemas: Problema[] = [];
  const anota = (chave: string, descricao: string, itens: string[], total: number) => {
    if (total) problemas.push({ chave, descricao, exemplos: itens.slice(0, QUANTOS), total });
  };

  // 1) Placa que não é placa (nome de prestador, cidade, texto)
  const comPlaca = await prisma.atendimento.findMany({
    where: { placa: { not: null } },
    select: { id: true, placa: true, agenteNome: true, vertical: true, idPR7: true },
  });
  const placaRuim = comPlaca.filter((a) => !PLACA_OK.test((a.placa ?? '').toUpperCase()));
  anota('placa-invalida', 'Campo placa com conteúdo que não é placa (nome, cidade, texto)',
    placaRuim.map((a) => `ID ${a.idPR7 ?? '-'} · placa="${a.placa}" · agente="${a.agenteNome ?? ''}"`), placaRuim.length);

  // 2) Agente com cara de placa ou de número
  const comAgente = await prisma.atendimento.findMany({
    where: { agenteNome: { not: null } },
    select: { id: true, agenteNome: true, placa: true, idPR7: true },
  });
  const agenteRuim = comAgente.filter((a) => {
    const n = (a.agenteNome ?? '').trim();
    return PLACA_OK.test(n.toUpperCase().replace(/[^A-Z0-9]/g, '')) || /^\d+$/.test(n) || n.length < 2;
  });
  anota('agente-invalido', 'Campo agente com placa ou número no lugar do nome',
    agenteRuim.map((a) => `ID ${a.idPR7 ?? '-'} · agente="${a.agenteNome}" · placa="${a.placa ?? ''}"`), agenteRuim.length);

  // 3) Veicular sem placa / Patrimonial com placa
  const [veicSemPlaca, patComPlaca] = await Promise.all([
    prisma.atendimento.count({ where: { vertical: 'VEICULAR', placa: null } }),
    prisma.atendimento.count({ where: { vertical: 'PATRIMONIAL', placa: { not: null } } }),
  ]);
  anota('veicular-sem-placa', 'Chamado veicular sem placa', [], veicSemPlaca);
  anota('patrimonial-com-placa', 'Chamado patrimonial com placa preenchida', [], patComPlaca);

  // 4) Linha do tempo impossível
  const tempos = await prisma.$queryRawUnsafe<{ id: string; idPR7: string | null; s: Date; c: Date | null; f: Date | null }[]>(
    `select id, "idPR7", "solicitadoEm" s, "chegadaEm" c, "concluidoEm" f from "Atendimento"
      where "solicitadoEm" is not null and (("chegadaEm" is not null and "chegadaEm" < "solicitadoEm")
         or ("concluidoEm" is not null and "concluidoEm" < "solicitadoEm")) limit 500`);
  anota('tempo-invertido', 'Chegada ou término antes da solicitação',
    tempos.map((t) => `ID ${t.idPR7 ?? '-'} · pedido ${t.s.toISOString().slice(0, 16)} · chegada ${t.c?.toISOString().slice(0, 16) ?? '-'} · fim ${t.f?.toISOString().slice(0, 16) ?? '-'}`), tempos.length);

  // 5) Atendimento longo demais (mais de 24 h entre pedido e término)
  const longos = await prisma.$queryRawUnsafe<{ idPR7: string | null; horas: number }[]>(
    `select "idPR7", extract(epoch from ("concluidoEm" - "solicitadoEm"))/3600 horas from "Atendimento"
      where "solicitadoEm" is not null and "concluidoEm" is not null
        and "concluidoEm" - "solicitadoEm" > interval '24 hours' order by 2 desc limit 200`);
  anota('duracao-absurda', 'Atendimento com mais de 24 h entre pedido e término',
    longos.map((l) => `ID ${l.idPR7 ?? '-'} · ${Math.round(l.horas)} h`), longos.length);

  // 6) Valores fora de faixa
  const valores = await prisma.$queryRawUnsafe<{ idPR7: string | null; valor: number }[]>(
    `select "idPR7", "valorPrestador"::float valor from "Atendimento"
      where "valorPrestador" is not null and ("valorPrestador" > 2000 or "valorPrestador" < 0) order by 2 desc limit 200`);
  anota('valor-fora-de-faixa', 'Valor pago ao prestador acima de R$ 2.000 ou negativo',
    valores.map((v) => `ID ${v.idPR7 ?? '-'} · R$ ${v.valor}`), valores.length);

  // 7) Cidade/UF trocadas ou inválidas (conta cadastrada)
  const contas = await prisma.conta.findMany({ select: { codigo: true, estabelecimento: true, cidade: true, estado: true } });
  const ufRuim = contas.filter((c) => !ufValida(c.estado.toUpperCase()));
  anota('uf-invalida', 'Conta com UF inválida', ufRuim.map((c) => `${c.codigo} · "${c.cidade}"/"${c.estado}"`), ufRuim.length);
  const cidadeRuim = contas.filter((c) => c.cidade && !SO_LETRAS.test(c.cidade));
  anota('cidade-suspeita', 'Conta com cidade contendo número ou símbolo', cidadeRuim.map((c) => `${c.codigo} · "${c.cidade}"`), cidadeRuim.length);

  // 8) Prestador com nome que parece telefone/código
  const prestadores = await prisma.provider.findMany({ select: { name: true, phone: true, cidadeBase: true } });
  const nomeRuim = prestadores.filter((p) => /^\d/.test(p.name.trim()) || p.name.trim().length < 3);
  anota('prestador-nome-suspeito', 'Prestador com nome começando por número ou muito curto',
    nomeRuim.map((p) => `"${p.name}" · ${p.phone}`), nomeRuim.length);

  // 9) Cliente com cara de cabeçalho ou lixo
  const clientes = await prisma.client.findMany({ select: { name: true } });
  const clienteRuim = clientes.filter((c) => /^(cliente|estabelecimento|data|total|soma|-|\d+)$/i.test(c.name.trim()));
  anota('cliente-suspeito', 'Cliente com nome de cabeçalho/linha de total', clienteRuim.map((c) => `"${c.name}"`), clienteRuim.length);

  // Resultado
  const total = await prisma.atendimento.count();
  console.log(`\n=== AUDITORIA · ${total} atendimentos ===\n`);
  if (!problemas.length) console.log('Nenhum problema encontrado.');
  for (const p of problemas.sort((a, b) => b.total - a.total)) {
    console.log(`[${p.total}] ${p.descricao}`);
    for (const e of p.exemplos) console.log(`      ${e}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
