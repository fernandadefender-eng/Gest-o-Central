/**
 * Tira do cadastro de prestadores o que não é pessoa: marcação da planilha que caiu
 * na coluna Equipe ("X", "Sim", "Não", "R$ 500"). O atendimento continua existindo,
 * só fica sem prestador — melhor sem do que com o nome errado.
 *
 *   npx ts-node -T scripts/limpar-prestadores-invalidos.ts [--aplicar]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const naoEhPessoa = (nome: string, telefone: string) => {
  const t = nome.trim();
  const telefoneValido = /^\d{10,11}$/.test(telefone);
  if (/^(x|sim|n[ãa]o|nao|-+|pr|r\$.*|\d+[.,]?\d*)$/i.test(t)) return true;
  return !/[a-zà-ú]{3}/i.test(t) && !telefoneValido;
};

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const todos = await prisma.provider.findMany({ select: { id: true, name: true, phone: true, origem: true } });
  const invalidos = todos.filter((p) => naoEhPessoa(p.name, p.phone));

  console.log(`prestadores: ${todos.length} · fora do padrão: ${invalidos.length}\n`);
  for (const p of invalidos) {
    const [atend, membros, areas] = await Promise.all([
      prisma.atendimento.count({ where: { providerId: p.id } }),
      prisma.providerMembro.count({ where: { providerId: p.id } }),
      prisma.providerArea.count({ where: { providerId: p.id } }),
    ]);
    console.log(`"${p.name}" (${p.phone}) · ${atend} atendimentos · ${membros} agentes · ${areas} áreas`);
    if (!aplicar) continue;
    await prisma.atendimento.updateMany({ where: { providerId: p.id }, data: { providerId: null } });
    await prisma.providerMembro.deleteMany({ where: { providerId: p.id } });
    await prisma.providerArea.deleteMany({ where: { providerId: p.id } });
    await prisma.provider.delete({ where: { id: p.id } });
    console.log('   → removido (atendimentos mantidos, sem prestador)');
  }
  if (!aplicar) console.log('\n(simulação — rode com --aplicar para efetivar)');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
