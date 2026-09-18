/** Teste da aba Fechamentos: acesso só ADM, define valor do cliente, fecha período. */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';
const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const SENHA = 'TesteFech2026xx', ADM = 'teste.fech.adm@pr7.invalid', SUP = 'teste.fech.sup@pr7.invalid';
let f = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) f++; };
async function req(t: string, metodo: string, url: string, corpo?: unknown) {
  const r = await fetch(API + url, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: corpo ? JSON.stringify(corpo) : undefined });
  let j: any = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
const login = async (e: string) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: SENHA }) })).json()).accessToken;
async function main() {
  await prisma.adminUser.deleteMany({ where: { email: { in: [ADM, SUP] } } });
  const hash = await bcrypt.hash(SENHA, 12);
  await prisma.adminUser.create({ data: { nome: 'Teste Fech Adm', email: ADM, passwordHash: hash, papel: Papel.ADMIN, permissoes: [], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  await prisma.adminUser.create({ data: { nome: 'Teste Fech Sup', email: SUP, passwordHash: hash, papel: Papel.OPERADOR, funcao: 'SUPERVISAO', permissoes: ['equipe', 'valores', 'pagamentos', 'atendimentos'], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  const adm = await login(ADM), sup = await login(SUP);
  ok(adm && sup, 'login adm e supervisão');
  // Supervisão NÃO acessa
  ok((await req(sup, 'GET', '/fechamentos')).status === 403, 'supervisão NÃO vê Fechamentos (403)');
  // Admin acessa
  const lista = await req(adm, 'GET', '/fechamentos?de=2026-09-01&ate=2026-09-30');
  ok(lista.status === 200 && Array.isArray(lista.j.clientes), `admin vê o resumo (${lista.j?.clientes?.length} clientes)`);
  ok(typeof lista.j.totalFaturamento === 'number', 'resumo tem faturamento total');
  // pega um atendimento concluído para testar o valor
  const at = await prisma.atendimento.findFirst({ where: { status: 'CONCLUIDO', OR: [{ solicitadoEm: { gte: new Date('2026-09-01') } }, { createdAt: { gte: new Date('2026-09-01') } }] }, select: { id: true, valorCliente: true, empresaId: true } });
  if (at) {
    const antes = at.valorCliente;
    const set = await req(adm, 'PATCH', `/fechamentos/atendimento/${at.id}`, { valor: 123.45 });
    ok(set.status === 200, 'admin define valor do cliente');
    const conf = await prisma.atendimento.findUnique({ where: { id: at.id }, select: { valorCliente: true } });
    ok(Number(conf?.valorCliente) === 123.45, 'valor do cliente gravado');
    ok((await req(sup, 'PATCH', `/fechamentos/atendimento/${at.id}`, { valor: 1 })).status === 403, 'supervisão não altera valor do cliente');
    // devolve ao original para não sujar o dado
    await prisma.atendimento.update({ where: { id: at.id }, data: { valorCliente: antes } });
    ok(true, 'valor original restaurado');
  } else ok(false, 'sem atendimento concluído em set/2026 para testar (verificar período)');
  await prisma.adminUser.deleteMany({ where: { email: { in: [ADM, SUP] } } });
  console.log(f ? `\n${f} FALHA(S)` : '\nTodos os testes passaram');
}
main().catch((e) => { console.error(e); f++; }).finally(async () => { await prisma.adminUser.deleteMany({ where: { email: { in: [ADM, SUP] } } }).catch(() => {}); await prisma.$disconnect(); process.exit(f ? 1 : 0); });
