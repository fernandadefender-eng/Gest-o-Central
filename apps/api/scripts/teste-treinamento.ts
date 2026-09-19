/**
 * Teste ponta a ponta da Academia PR7 (Treinamento): gabarito protegido, XP sem "farm",
 * plantão ao vivo, validação pela supervisão, certificado em PDF com logo e conferência.
 * Contas de teste e registros são removidos; validações reais do conteúdo ficam como estavam.
 * Uso: npx ts-node scripts/teste-treinamento.ts
 */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';
import { CENARIOS, MODULOS } from '../src/treinamento/conteudo';

const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const SENHA = 'TesteTreino2026x';
const ALUNO = 'teste.aluno@pr7.invalid', SUP = 'teste.sup.treino@pr7.invalid', OUTRO = 'teste.outro.treino@pr7.invalid';
let falhas = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };

async function req(token: string, metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(API + caminho, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: corpo ? JSON.stringify(corpo) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, json, buf, tipo: r.headers.get('content-type') };
}
const login = async (email: string) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: SENHA }) });
  return (await r.json()).accessToken as string;
};

let validacoesAntes: { moduloCodigo: string }[] = [];
async function limpar() {
  const us = await prisma.adminUser.findMany({ where: { email: { in: [ALUNO, SUP, OUTRO] } }, select: { id: true } });
  const ids = us.map((u) => u.id);
  await prisma.treinoResposta.deleteMany({ where: { userId: { in: ids } } });
  await prisma.treinoSimulacao.deleteMany({ where: { userId: { in: ids } } });
  await prisma.treinoCertificado.deleteMany({ where: { userId: { in: ids } } });
  await prisma.treinoValidacao.deleteMany({ where: { validadoPor: SUP } });
  await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpar();
  validacoesAntes = await prisma.treinoValidacao.findMany({ select: { moduloCodigo: true } });
  const hash = await bcrypt.hash(SENHA, 12);
  const base = { passwordHash: hash, papel: Papel.OPERADOR, verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' };
  await prisma.adminUser.create({ data: { ...base, nome: 'Teste Aluno Academia', email: ALUNO, funcao: 'HELP_DESK', permissoes: ['atendimentos', 'treinamento'] } });
  await prisma.adminUser.create({ data: { ...base, nome: 'Teste Supervisao Academia', email: SUP, funcao: 'SUPERVISAO', permissoes: ['equipe', 'treinamento'] } });
  await prisma.adminUser.create({ data: { ...base, nome: 'Teste Outro Academia', email: OUTRO, funcao: 'HELP_DESK', permissoes: ['atendimentos'] } });
  const a = await login(ALUNO), s = await login(SUP), o = await login(OUTRO);

  ok((await req(o, 'GET', '/treinamento/perfil')).status === 403, 'sem permissão treinamento: 403');
  const p0 = (await req(a, 'GET', '/treinamento/perfil')).json;
  ok(p0.xp === 0 && p0.ranque.nome === 'Recruta' && p0.modulos.length === MODULOS.length, 'perfil inicial: Recruta, 0 XP');
  ok(p0.modulos.filter((m: any) => m.aguardandoMaterial).length === 2, 'Sincro e Seven aguardando material (Power e GR já com conteúdo)');
  const mod = (await req(a, 'GET', '/treinamento/modulos/mon-fundamentos')).json;
  ok(mod.questoes.length && !JSON.stringify(mod).includes('"certa"') && !JSON.stringify(mod).includes('explicacao'), 'módulo chega SEM gabarito');
  const cen = (await req(a, 'GET', '/treinamento/cenarios/sim-bateria')).json;
  ok(!JSON.stringify(cen).includes('"certa"'), 'plantão chega SEM gabarito');

  // Errar, acertar, repetir: XP só no primeiro acerto
  const q1 = MODULOS[0].questoes[0];
  const errada = (q1.certa + 1) % q1.opcoes.length;
  const r1 = (await req(a, 'POST', '/treinamento/responder', { questaoId: q1.id, resposta: errada })).json;
  ok(r1.correta === false && r1.xp === 0 && r1.certa === q1.certa, 'resposta errada: 0 XP e mostra a certa');
  const r2 = (await req(a, 'POST', '/treinamento/responder', { questaoId: q1.id, resposta: q1.certa })).json;
  ok(r2.correta && r2.xp > 0, `acerto: +${r2.xp} XP`);
  const r3 = (await req(a, 'POST', '/treinamento/responder', { questaoId: q1.id, resposta: q1.certa })).json;
  ok(r3.correta && r3.xp === 0, 'repetir o acerto não dá XP de novo');
  ok((await req(a, 'POST', '/treinamento/responder', { questaoId: q1.id, resposta: 99 })).status === 400, 'resposta fora das opções: 400');

  // Certificado ainda bloqueado
  ok((await req(a, 'POST', '/treinamento/certificado')).status === 400, 'certificado bloqueado antes de concluir');

  // Conclui todos os módulos e plantões
  for (const m of MODULOS) for (const q of m.questoes) await req(a, 'POST', '/treinamento/responder', { questaoId: q.id, resposta: q.certa, tempoMs: 3000 });
  for (const c of CENARIOS) {
    const r = (await req(a, 'POST', `/treinamento/cenarios/${c.id}`, { respostas: c.etapas.map((e) => e.certa), tempoMs: 5000 })).json;
    ok(r.acertos === r.total && r.xp > 0, `plantão "${c.titulo}": ${r.acertos}/${r.total}, +${r.xp} XP`);
  }
  const rep = (await req(a, 'POST', `/treinamento/cenarios/${CENARIOS[0].id}`, { respostas: CENARIOS[0].etapas.map((e) => e.certa), tempoMs: 5000 })).json;
  ok(rep.xp === 0, 'repetir plantão igual não dá XP');
  const p1 = (await req(a, 'GET', '/treinamento/perfil')).json;
  ok(p1.modulos.filter((m: any) => m.total).every((m: any) => m.concluido), 'todos os módulos com conteúdo concluídos');
  ok(p1.certificado.faltas.length && p1.certificado.faltas.every((f: string) => /validação/.test(f)), 'falta só a validação da supervisão');
  ok(p1.conquistas.find((c: any) => c.id === 'plantao').ok && p1.conquistas.find((c: any) => c.id === 'fila').ok, 'conquistas Plantão perfeito e Mestre da fila');

  // Supervisão valida (aluno não pode)
  ok((await req(a, 'POST', '/treinamento/gestao/validacoes/mon-fundamentos', { validar: true })).status === 403, 'aluno não valida conteúdo');
  ok((await req(s, 'POST', '/treinamento/gestao/validacoes/central-sincro', { validar: true })).status === 400, 'módulo sem material não pode ser validado');
  for (const m of MODULOS.filter((x) => x.questoes.length && !validacoesAntes.some((v) => v.moduloCodigo === x.codigo))) {
    await req(s, 'POST', `/treinamento/gestao/validacoes/${m.codigo}`, { validar: true, observacao: 'teste' });
  }
  const eq = (await req(s, 'GET', '/treinamento/gestao/equipe')).json;
  ok(eq.some((x: any) => x.nome === 'Teste Aluno Academia' && x.concluidos === x.totalModulos), 'supervisão vê o progresso do aluno');

  // Certificado
  const em = (await req(a, 'POST', '/treinamento/certificado')).json;
  ok(/^PR7-TR-\d{4}-[0-9A-F]{8}$/.test(em.codigo) && em.novo, `certificado emitido: ${em.codigo}`);
  ok((await req(a, 'POST', '/treinamento/certificado')).json.codigo === em.codigo, 'emitir de novo devolve o mesmo certificado');
  const pdf = await req(a, 'GET', `/treinamento/certificado/${em.codigo}/pdf`);
  ok(pdf.status === 200 && pdf.tipo?.includes('pdf') && pdf.buf.subarray(0, 4).toString() === '%PDF', `PDF gerado (${Math.round(pdf.buf.length / 1024)} KB)`);
  ok(pdf.buf.length > 40_000 && pdf.buf.includes(Buffer.from('/Subtype /Image')), 'PDF contém o logo da PR7');
  require('fs').writeFileSync(require('path').join(process.env.TEMP || '.', 'certificado-teste.pdf'), pdf.buf);
  ok((await req(o, 'GET', `/treinamento/certificado/${em.codigo}/pdf`)).status === 403, 'outra pessoa não baixa o certificado');
  ok((await req(s, 'GET', `/treinamento/certificado/${em.codigo}/pdf`)).status === 200, 'supervisão baixa o certificado da equipe');
  const v = (await req(s, 'GET', `/treinamento/gestao/verificar/${em.codigo}`)).json;
  ok(v.valido && v.nome === 'Teste Aluno Academia', 'código do certificado confere');
  ok((await req(s, 'GET', '/treinamento/gestao/verificar/PR7-TR-2026-00000000')).json.valido === false, 'código falso não confere');
  const rk = (await req(a, 'GET', '/treinamento/ranking')).json;
  ok(rk.top.some((x: any) => x.eu && x.nome === 'Teste A.'), 'ranking da semana mostra só primeiro nome + inicial');

  await limpar();
  const depois = await prisma.treinoValidacao.findMany({ select: { moduloCodigo: true } });
  ok(depois.length === validacoesAntes.length, 'validações reais do conteúdo continuam como estavam');
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram');
}
main().catch((e) => { console.error(e); falhas++; }).finally(async () => { await limpar().catch(() => {}); await prisma.$disconnect(); process.exit(falhas ? 1 : 0); });
