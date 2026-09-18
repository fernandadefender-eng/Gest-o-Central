/**
 * Reclassifica as unidades policiais já baixadas usando o nome guardado — sem
 * consultar o OpenStreetMap de novo. Serve quando a regra de classificação melhora
 * (ex.: "Brigada Militar" do RS, "CIOPS", "D.P.M." agora contam como PM).
 */
import { PrismaClient } from '@prisma/client';
import { classificar } from './importar-policia';

const prisma = new PrismaClient();

async function main() {
  const unidades = await prisma.unidadePolicial.findMany({ select: { id: true, nome: true, tipo: true } });
  let mudadas = 0;
  for (const u of unidades) {
    const novo = classificar({ name: u.nome });
    if (novo === u.tipo || novo === 'OUTRA') continue;
    await prisma.unidadePolicial.update({ where: { id: u.id }, data: { tipo: novo } });
    mudadas++;
  }
  console.log(`unidades reclassificadas: ${mudadas} de ${unidades.length}`);
  const porTipo = await prisma.unidadePolicial.groupBy({ by: ['tipo'], _count: true, orderBy: { _count: { tipo: 'desc' } } });
  console.table(porTipo.map((t) => ({ tipo: t.tipo, unidades: t._count })));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
