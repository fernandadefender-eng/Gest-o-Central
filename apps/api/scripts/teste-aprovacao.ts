/**
 * Teste ponta a ponta do pedido de aprovação (cadastro da equipe fora da regra) e do aviso
 * de acesso monitorado. Usa contas de teste temporárias (removidas no fim) — nunca a conta
 * de ninguém da equipe. Uso: npx ts-node scripts/teste-aprovacao.ts
 */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const SENHA = 'TesteAprov2026x';
const SUP = 'teste.supervisao@pr7.invalid', ADM = 'teste.admin@pr7.invalid';
const NOVO_OK = 'teste.helpdesk@pr7.invalid', NOVO_FORA = 'teste.analista@pr7.invalid';
let falhas = 0;
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) falhas++; };

async function req(token: string | null, metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(API + caminho, { method: metodo, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  let json: any = null; try { json = JSON.parse(texto); } catch {}
  return { status: r.status, json };
}
const login = async (email: string) => (await req(null, 'POST', '/auth/login', { email, password: SENHA })).json?.accessToken as string;

async function limpar() {
  const emails = [SUP, ADM, NOVO_OK, NOVO_FORA];
  await prisma.pedidoAprovacao.deleteMany({ where: { OR: [{ solicitante: { in: emails } }, { alvoDescricao: { contains: '@pr7.invalid' } }] } });
  await prisma.adminUser.deleteMany({ where: { email: { in: emails } } });
}

async function main() {
  await limpar();
  const hash = await bcrypt.hash(SENHA, 12);
  await prisma.adminUser.create({ data: { nome: 'Teste Supervisão', email: SUP, passwordHash: hash, papel: Papel.OPERADOR, funcao: 'SUPERVISAO', permissoes: ['atendimentos', 'usuarios', 'valores'], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  const admin = await prisma.adminUser.create({ data: { nome: 'Teste Administrador', email: ADM, passwordHash: hash, papel: Papel.ADMIN, permissoes: [], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  const tSup = await login(SUP), tAdm = await login(ADM);
  ok(tSup && tAdm, 'login das contas de teste');

  // 1. Dentro da regra: aplica direto
  const r1 = await req(tSup, 'POST', '/usuarios', { nome: 'Teste Helpdesk', email: NOVO_OK, senha: SENHA, funcao: 'HELP_DESK', permissoes: ['atendimentos', 'mapa'], verticais: ['PATRIMONIAL'] });
  ok(r1.status === 201 && !r1.json?.pendente && r1.json?.id, `dentro da regra: criado direto (${r1.status})`);

  // 2. Função fora da regra: vira pedido, usuário NÃO é criado
  const r2 = await req(tSup, 'POST', '/usuarios', { nome: 'Teste Analista', email: NOVO_FORA, senha: SENHA, funcao: 'ANALISTA', verticais: ['PATRIMONIAL'] });
  ok(r2.json?.pendente && r2.json?.pedidoId, `função fora da regra → pedido (${r2.json?.motivos?.join('; ')})`);
  ok(!(await prisma.adminUser.findUnique({ where: { email: NOVO_FORA } })), 'usuário fora da regra ainda não existe');
  const r2b = await req(tSup, 'POST', '/usuarios', { nome: 'Teste Analista', email: NOVO_FORA, senha: SENHA, funcao: 'ANALISTA', verticais: ['PATRIMONIAL'] });
  ok(r2b.status === 409, 'pedido repetido para o mesmo e-mail é recusado');

  // 3. Tela fora da regra ao editar: vira pedido, nada muda
  const r3 = await req(tSup, 'PATCH', `/usuarios/${r1.json.id}`, { permissoes: ['atendimentos', 'mapa', 'visao_geral'] });
  ok(r3.json?.pendente, `tela fora da regra ao editar → pedido (${r3.json?.motivos?.join('; ')})`);
  const antes = await prisma.adminUser.findUnique({ where: { id: r1.json.id } });
  ok(!antes?.permissoes.includes('visao_geral'), 'permissões não mudaram antes da aprovação');

  // 4. Quem pediu não aprova
  const r4 = await req(tSup, 'POST', `/usuarios/aprovacoes/${r2.json.pedidoId}/aprovar`, {});
  ok(r4.status === 403, `supervisão não aprova o próprio pedido (${r4.status})`);

  // 5. Listas: sem hash de senha
  const lSup = await req(tSup, 'GET', '/usuarios/aprovacoes');
  const lAdm = await req(tAdm, 'GET', '/usuarios/aprovacoes?status=PENDENTE');
  ok(lSup.json?.length === 2, `quem pediu vê os próprios pedidos (${lSup.json?.length})`);
  ok(lAdm.json?.some((p: any) => p.id === r2.json.pedidoId), 'administrador vê o pedido pendente');
  ok(!JSON.stringify(lAdm.json).includes('passwordHash') && !JSON.stringify(lAdm.json).includes('$2'), 'hash de senha nunca sai da API');

  // 6. Aprovado: usuário criado com a senha definida por quem pediu
  const r6 = await req(tAdm, 'POST', `/usuarios/aprovacoes/${r2.json.pedidoId}/aprovar`, { observacao: 'ok teste' });
  ok(r6.status === 200 && r6.json?.status === 'APROVADO', 'administrador aprova');
  const criado = await prisma.adminUser.findUnique({ where: { email: NOVO_FORA } });
  ok(criado?.funcao === 'ANALISTA' && criado.papel === 'OPERADOR', 'usuário criado como Analista (operador, nunca admin)');
  ok(!!(await login(NOVO_FORA)), 'novo usuário entra com a senha definida no pedido');

  // 7. Recusado: nada muda
  const r7 = await req(tAdm, 'POST', `/usuarios/aprovacoes/${r3.json.pedidoId}/recusar`, { observacao: 'não precisa' });
  ok(r7.json?.status === 'RECUSADO', 'administrador recusa');
  const depois = await prisma.adminUser.findUnique({ where: { id: r1.json.id } });
  ok(!depois?.permissoes.includes('visao_geral'), 'recusado: permissões continuam as mesmas');

  // 8. Decidir de novo não vale
  ok((await req(tAdm, 'POST', `/usuarios/aprovacoes/${r3.json.pedidoId}/aprovar`, {})).status === 409, 'pedido já decidido não é decidido de novo');

  // 9. Administrador continua intocável
  ok((await req(tSup, 'PATCH', `/usuarios/${admin.id}`, { nome: 'Outro Nome' })).status === 403, 'não-administrador não mexe em administrador');

  // 10. Aviso de monitoramento registrado
  ok((await req(tSup, 'POST', '/auth/ciencia-monitoramento', {})).json?.ok, 'ciência do monitoramento aceita');
  await new Promise((r) => setTimeout(r, 500));
  const ev = await prisma.eventoSeguranca.findMany({ where: { usuario: { in: [SUP, ADM] }, tipo: { in: ['CIENCIA_MONITORAMENTO', 'APROVACAO'] } } });
  ok(ev.some((e) => e.tipo === 'CIENCIA_MONITORAMENTO') && ev.filter((e) => e.tipo === 'APROVACAO').length >= 4, `trilha de auditoria gravada (${ev.length} eventos)`);

  await limpar();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram');
}
main().catch(async (e) => { console.error(e); falhas++; }).finally(async () => { await limpar().catch(() => {}); await prisma.$disconnect(); process.exit(falhas ? 1 : 0); });
