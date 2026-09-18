/**
 * Teste ponta a ponta do acesso do técnico de SST (permissão nr1) e dos comunicados de
 * risco com link pessoal. Contas e registros de teste são removidos no fim.
 * Uso: npx ts-node scripts/teste-sst.ts
 */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const SENHA = 'TesteSst2026xx';
const TEC = 'teste.sst@pr7.invalid', OP = 'teste.op.sst@pr7.invalid', EXT = 'teste.trabalhador@pr7.invalid';
let falhas = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };

async function req(token: string | null, metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(API + caminho, { method: metodo, redirect: 'manual', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  let json: any = null; try { json = JSON.parse(texto); } catch {}
  return { status: r.status, json, texto, local: r.headers.get('location') };
}
const login = async (email: string) => (await req(null, 'POST', '/auth/login', { email, password: SENHA })).json?.accessToken as string;
const incidentesTeste: string[] = [];

async function limpar() {
  const cs = await prisma.comunicadoSst.findMany({ where: { criadoPor: { in: [TEC, OP] } }, select: { id: true } });
  await prisma.comunicadoDestinatario.deleteMany({ where: { comunicadoId: { in: cs.map((c) => c.id) } } });
  await prisma.comunicadoSst.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
  await prisma.incidenteSeguranca.deleteMany({ where: { OR: [{ id: { in: incidentesTeste } }, { registradoPor: TEC }] } });
  await prisma.adminUser.deleteMany({ where: { email: { in: [TEC, OP] } } });
}

async function main() {
  await limpar();
  const hash = await bcrypt.hash(SENHA, 12);
  await prisma.adminUser.create({ data: { nome: 'Teste Técnico SST', email: TEC, passwordHash: hash, papel: Papel.OPERADOR, funcao: 'TECNICO_SST', permissoes: ['nr1'], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  await prisma.adminUser.create({ data: { nome: 'Teste Operador Sst', email: OP, passwordHash: hash, papel: Papel.OPERADOR, funcao: 'HELP_DESK', permissoes: ['atendimentos'], verticais: [Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  const t = await login(TEC), o = await login(OP);
  ok(t && o, 'login das contas de teste');

  // Acesso do técnico: só NR-1
  ok((await req(t, 'GET', '/seguranca/painel')).status === 403, 'técnico NÃO vê proteção de dados/acessos');
  ok((await req(t, 'GET', '/seguranca/eventos')).status === 403, 'técnico NÃO vê a auditoria');
  ok((await req(t, 'GET', '/atendimentos')).status === 403, 'técnico NÃO vê atendimentos');
  const comp = await req(t, 'GET', '/seguranca/painel/compliance');
  ok(comp.status === 200 && comp.json.length && comp.json.every((i: any) => i.norma === 'NR1'), `checklist: só itens NR-1 (${comp.json?.length})`);
  const lgpd = await prisma.itemCompliance.findFirst({ where: { norma: 'LGPD', automatico: false } });
  ok((await req(t, 'PATCH', `/seguranca/painel/compliance/${lgpd!.id}`, { evidencia: 'x' })).status === 403, 'técnico não altera item LGPD');
  ok((await req(t, 'GET', '/seguranca/painel/nr1/riscos')).status === 200, 'técnico vê o inventário de riscos');
  ok((await req(t, 'GET', '/seguranca/painel/nr1/indicadores')).status === 200, 'técnico vê os indicadores NR-1');
  const incDados = await req(t, 'POST', '/seguranca/painel/incidentes', { categoria: 'DADOS', titulo: 'teste', descricao: 'teste', ocorridoEm: new Date().toISOString(), gravidade: 'BAIXA' });
  ok(incDados.status === 403, 'técnico não registra incidente de DADOS');
  const incOc = await req(t, 'POST', '/seguranca/painel/incidentes', { titulo: 'Teste acidente', descricao: 'teste', ocorridoEm: new Date().toISOString(), gravidade: 'BAIXA', esocialEnviadoEm: new Date().toISOString(), esocialRecibo: '1.2.3', titularesAfetados: 99 });
  if (incOc.json?.id) incidentesTeste.push(incOc.json.id);
  ok(incOc.json?.categoria === 'OCUPACIONAL' && incOc.json?.esocialRecibo === '1.2.3' && incOc.json?.titularesAfetados == null, 'acidente ocupacional com CAT/eSocial; campos de vazamento ignorados');
  const lista = await req(t, 'GET', '/seguranca/painel/incidentes');
  ok(lista.json.every((i: any) => i.categoria === 'OCUPACIONAL'), 'técnico só lista incidentes ocupacionais');

  // Comunicado de riscos
  ok((await req(o, 'GET', '/sst/comunicados')).status === 403, 'operador sem nr1 não acessa comunicados');
  const funcoes = (await req(t, 'GET', '/sst/funcoes')).json;
  ok(funcoes.length > 0, `funções do inventário (${funcoes.length})`);
  const equipe = (await req(t, 'GET', '/sst/equipe')).json;
  ok(equipe.length && !JSON.stringify(equipe).includes('@'), 'lista da equipe sem e-mails');
  const status = (await req(t, 'GET', '/sst/status')).json;
  const f = funcoes[0].funcao;
  const criado = await req(t, 'POST', '/sst/comunicados', { titulo: 'Teste riscos', mensagem: 'Leia com atenção', funcoes: [f], externos: [{ nome: 'Trabalhador Teste', email: EXT }], validadeDias: 7 });
  ok(criado.status === 201 && criado.json?.id, 'comunicado criado');
  const pend = criado.json?.pendentes?.[0];
  const link: string | undefined = pend?.link;
  if (status.emailConfigurado) ok(true, 'e-mail configurado (envio tentado)');
  else ok(link && /\/sst-info\/[A-Za-z0-9_-]{43}$/.test(link), 'sem SMTP: link devolvido uma vez para repassar');
  const guardado = await prisma.comunicadoDestinatario.findFirst({ where: { email: EXT } });
  const codigo = link?.split('/sst-info/')[1] ?? '';
  ok(guardado && guardado.tokenHash.length === 64 && !JSON.stringify(guardado).includes(codigo), 'banco guarda só o hash do link');

  if (codigo) {
    const pag = await req(null, 'GET', `/sst-info/${codigo}`, undefined, { 'cf-connecting-ip': '203.0.113.9' });
    const riscoAlgum = await prisma.riscoOcupacional.findFirst({ where: { funcao: f } });
    ok(pag.status === 200 && pag.texto.includes(riscoAlgum!.perigo.slice(0, 20).replace(/&/g, '&amp;')), 'link abre pela internet e mostra os riscos da função');
    ok(!pag.texto.includes('responsavel') && !(riscoAlgum!.responsavel && pag.texto.includes(riscoAlgum!.responsavel)), 'página não mostra responsável nem dados internos');
    ok((await req(null, 'GET', '/sst/comunicados', undefined, { 'cf-connecting-ip': '203.0.113.9' })).status === 404, 'pela internet, o resto continua fechado');
    ok((await req(null, 'GET', '/sst-info/codigo-invalido', undefined, { 'cf-connecting-ip': '203.0.113.9' })).status === 404, 'código malformado é barrado no túnel');
    const c = await req(null, 'POST', `/sst-info/${codigo}/ciente`, undefined, { 'cf-connecting-ip': '203.0.113.9' });
    ok(c.status === 303, 'estou ciente registrado');
    const l = (await req(t, 'GET', '/sst/comunicados')).json.find((x: any) => x.id === criado.json.id);
    ok(l.totais.cientes === 1 && l.totais.abertos === 1, 'painel mostra aberto e ciente');
    const nr105 = (await req(t, 'GET', '/seguranca/painel/compliance')).json.find((i: any) => i.codigo === 'NR1-05');
    ok(/confirmaram a ciência/.test(nr105.evidencia), `NR1-05 automático: ${nr105.evidencia}`);

    // Reenviar derruba o link anterior
    const re = await req(t, 'POST', `/sst/comunicados/${criado.json.id}/destinatarios/${guardado!.id}/reenviar`);
    ok(re.status === 200, 'reenvio');
    ok((await req(null, 'GET', `/sst-info/${codigo}`)).texto.includes('Link indisponível'), 'link anterior deixa de valer após reenvio');
    const novo = re.json?.pendentes?.[0]?.link?.split('/sst-info/')[1];
    if (novo) {
      ok(!(await req(null, 'GET', `/sst-info/${novo}`)).texto.includes('Link indisponível'), 'novo link funciona');
      await req(t, 'POST', `/sst/comunicados/${criado.json.id}/revogar`);
      ok((await req(null, 'GET', `/sst-info/${novo}`)).texto.includes('Link indisponível'), 'revogado: link para de funcionar');
    }
  }
  await limpar();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram');
}
main().catch((e) => { console.error(e); falhas++; }).finally(async () => { await limpar().catch(() => {}); await prisma.$disconnect(); process.exit(falhas ? 1 : 0); });
