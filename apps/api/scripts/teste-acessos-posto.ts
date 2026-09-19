/** Teste da aba Acessos dos postos: registro, troca de senha com histórico, restrição. */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';
const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const SENHA = 'TesteAcesso2026x', OP = 'teste.acesso.op@pr7.invalid', SEM = 'teste.acesso.sem@pr7.invalid';
let f = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) f++; };
async function req(t: string, metodo: string, url: string, corpo?: unknown) {
  const r = await fetch(API + url, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: corpo ? JSON.stringify(corpo) : undefined });
  let j: any = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
const login = async (e: string) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: SENHA }) })).json()).accessToken;
async function main() {
  await prisma.adminUser.deleteMany({ where: { email: { in: [OP, SEM] } } });
  await prisma.acessoPosto.deleteMany({ where: { posto: { startsWith: 'TESTE POSTO' } } });
  const hash = await bcrypt.hash(SENHA, 12);
  await prisma.adminUser.create({ data: { nome: 'Teste Acesso Op', email: OP, passwordHash: hash, papel: Papel.OPERADOR, permissoes: ['prestadores'], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  await prisma.adminUser.create({ data: { nome: 'Teste Acesso Sem', email: SEM, passwordHash: hash, papel: Papel.OPERADOR, permissoes: ['atendimentos'], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  const op = await login(OP), sem = await login(SEM);
  ok(op && sem, 'login');
  ok((await req(sem, 'GET', '/acessos-posto')).status === 403, 'sem permissão prestadores: 403');
  const cria = await req(op, 'POST', '/acessos-posto', { posto: 'TESTE POSTO ALFA', cidade: 'Recife', uf: 'PE', cliente: 'TBG', tipo: 'SENHA', segredo: '1234' });
  ok(cria.status === 201 && cria.j.id, 'registra posto com cadeado de senha');
  const id = cria.j.id;
  const lista = await req(op, 'GET', '/acessos-posto?q=alfa');
  const item = lista.j.find((x: any) => x.id === id);
  ok(item && item.temSegredo && !('segredo' in item), 'lista mostra que há segredo, mas NÃO expõe o valor');
  const det = await req(op, 'GET', `/acessos-posto/${id}`);
  ok(det.j.segredo === '1234', 'detalhe traz o segredo (auditado)');
  // outra empresa troca a senha
  const troca = await req(op, 'PATCH', `/acessos-posto/${id}`, { posto: 'TESTE POSTO ALFA', tipo: 'SENHA', segredo: '9999', outraEmpresa: true, motivo: 'equipe X trocou' });
  ok(troca.status === 200, 'atualiza (troca de senha)');
  const det2 = await req(op, 'GET', `/acessos-posto/${id}`);
  ok(det2.j.segredo === '9999', 'segredo atualizado');
  ok(Array.isArray(det2.j.historico) && det2.j.historico.length === 2 && det2.j.historico[1].outraEmpresa === true && det2.j.historico[1].segredoTrocado === true, 'histórico registrou a troca por outra empresa');
  // muda para chave física
  await req(op, 'PATCH', `/acessos-posto/${id}`, { posto: 'TESTE POSTO ALFA', tipo: 'CHAVE_FISICA' });
  const det3 = await req(op, 'GET', `/acessos-posto/${id}`);
  ok(det3.j.tipo === 'CHAVE_FISICA' && !det3.j.segredo && det3.j.historico.length === 3, 'muda para chave física, limpa segredo, +1 no histórico');
  ok((await req(op, 'POST', '/acessos-posto', { posto: '', tipo: 'SENHA' })).status === 400, 'posto vazio barrado');
  await prisma.acessoPosto.deleteMany({ where: { posto: { startsWith: 'TESTE POSTO' } } });
  await prisma.adminUser.deleteMany({ where: { email: { in: [OP, SEM] } } });
  console.log(f ? `\n${f} FALHA(S)` : '\nTodos os testes passaram');
}
main().catch((e) => { console.error(e); f++; }).finally(async () => { await prisma.acessoPosto.deleteMany({ where: { posto: { startsWith: 'TESTE POSTO' } } }).catch(() => {}); await prisma.adminUser.deleteMany({ where: { email: { in: [OP, SEM] } } }).catch(() => {}); await prisma.$disconnect(); process.exit(f ? 1 : 0); });
