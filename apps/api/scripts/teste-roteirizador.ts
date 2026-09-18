/** Teste ponta a ponta da aba Roteirizador. Conta de teste removida no fim. */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';
const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const SENHA = 'TesteRot2026xxx', EMAIL = 'teste.rot@pr7.invalid';
let f = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) f++; };
async function req(t: string, metodo: string, url: string, corpo?: unknown) {
  const r = await fetch(API + url, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: corpo ? JSON.stringify(corpo) : undefined });
  let j: any = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
async function main() {
  await prisma.adminUser.deleteMany({ where: { email: EMAIL } });
  await prisma.adminUser.create({ data: { nome: 'Teste Rot', email: EMAIL, passwordHash: await bcrypt.hash(SENHA, 12), papel: Papel.OPERADOR, permissoes: ['roteirizador'], verticais: [Vertical.VEICULAR], criadoPor: 'teste' } });
  const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: SENHA }) })).json()).accessToken;
  ok(tok, 'login');
  const lista = await req(tok, 'GET', '/roteirizador?de=2026-09-01&ate=2026-09-30');
  ok(lista.status === 200 && Array.isArray(lista.j.itens), `lista carrega (${lista.j?.itens?.length} atendimentos)`);
  ok(lista.j.resumo && typeof lista.j.resumo.totalGeral === 'number', 'resumo com total');
  const alvo = lista.j.itens.find((x: any) => x.category === 'Roteirizador') || lista.j.itens[0];
  ok(alvo, `achou atendimento alvo (${alvo?.ref})`);
  if (alvo) {
    const add = await req(tok, 'POST', `/roteirizador/${alvo.id}/despesa`, { tipo: 'ABASTECIMENTO', valor: 250.5, litros: 40, odometro: 123456, obs: 'teste posto' });
    ok(add.status === 201 && add.j.despesas.some((d: any) => d.valor === 250.5), 'adiciona abastecimento');
    const mot = await req(tok, 'PATCH', `/roteirizador/${alvo.id}/motorista`, { motorista: 'Substituto Teste' });
    ok(mot.status === 200 && mot.j.motorista === 'Substituto Teste', 'define motorista substituto');
    const lista2 = await req(tok, 'GET', '/roteirizador?de=2026-09-01&ate=2026-09-30');
    const alvo2 = lista2.j.itens.find((x: any) => x.id === alvo.id);
    ok(alvo2.totalDespesas >= 250.5 && alvo2.motorista === 'Substituto Teste', 'despesa e motorista refletem na lista');
    ok(lista2.j.resumo.porTipo.ABASTECIMENTO?.litros >= 40, 'resumo soma litros do abastecimento');
    const idx = alvo2.despesas.findIndex((d: any) => d.valor === 250.5);
    const rm = await req(tok, 'POST', `/roteirizador/${alvo.id}/despesa/${idx}/remover`, {});
    ok(rm.status === 201 && !rm.j.despesas.some((d: any) => d.valor === 250.5), 'remove a despesa de teste');
    // devolve o motorista ao original (Tom) para não sujar o dado real
    await req(tok, 'PATCH', `/roteirizador/${alvo.id}/motorista`, { motorista: 'Tom' });
    ok((await req(tok, 'POST', `/roteirizador/${alvo.id}/despesa`, { tipo: 'X', valor: 10 })).status === 400, 'tipo inválido barrado');
  }
  ok((await req(tok, 'GET', '/atendimentos')).status === 403, 'sem permissão de atendimentos: 403 (isolado)');
  await prisma.adminUser.deleteMany({ where: { email: EMAIL } });
  console.log(f ? `\n${f} FALHA(S)` : '\nTodos os testes passaram');
}
main().catch((e) => { console.error(e); f++; }).finally(async () => { await prisma.adminUser.deleteMany({ where: { email: EMAIL } }).catch(() => {}); await prisma.$disconnect(); process.exit(f ? 1 : 0); });
