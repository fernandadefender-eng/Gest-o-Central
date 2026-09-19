/** Smoke test: gera de fato os relatórios PDF/Excel de SAC e Roteirizador. */
import { PrismaClient, Papel, Vertical } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const API = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL = 'smoke-rel@teste.local', SENHA = 'Smoke#123456';

async function main() {
  await prisma.adminUser.deleteMany({ where: { email: EMAIL } });
  await prisma.adminUser.create({ data: { nome: 'Smoke Rel', email: EMAIL, passwordHash: await bcrypt.hash(SENHA, 12), papel: Papel.ADMIN, permissoes: ['roteirizador', 'sac', 'relatorios'], verticais: [Vertical.VEICULAR, Vertical.PATRIMONIAL], criadoPor: 'teste' } });
  const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: SENHA }) })).json()).accessToken;
  const h = { Authorization: `Bearer ${tok}` };
  const alvos = ['/roteirizador/relatorio.pdf', '/roteirizador/relatorio.xlsx', '/sac/relatorio.pdf', '/sac/relatorio.xlsx'];
  let fail = 0;
  for (const u of alvos) {
    const r = await fetch(API + u, { headers: h });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    const magic = buf.slice(0, 4).toString('latin1');
    const okPdf = u.endsWith('.pdf') && magic.startsWith('%PDF');
    const okXlsx = u.endsWith('.xlsx') && magic.startsWith('PK');
    const bom = r.status === 200 && buf.length > 300 && (okPdf || okXlsx);
    if (!bom) fail++;
    console.log(`${bom ? 'OK ' : 'FALHA'} ${u} — ${r.status} · ${ct.slice(0, 30)} · ${buf.length} bytes · magic:${magic.replace(/[^ -~]/g, '.')}`);
  }
  await prisma.adminUser.deleteMany({ where: { email: EMAIL } });
  console.log(fail ? `\n${fail} falhas` : '\nTodos os relatórios geraram arquivo válido');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
