import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';
import { EmailService } from '../email/email.module';
import { ipReal } from '../seguranca/seguranca';
import { nivelRisco } from '../seguranca/painel-seguranca.module';

/**
 * Informação de riscos aos trabalhadores (NR-1 — "informar os trabalhadores sobre os riscos
 * e as medidas de prevenção"), 18/09/2026.
 *
 * Segurança dos dados:
 *  - cada destinatário tem um link PESSOAL (código aleatório de 256 bits); o banco guarda só
 *    o hash — nem quem tem acesso ao banco reconstrói o link;
 *  - o link vale até a data de validade e pode ser revogado; reenviar gera outro código e
 *    derruba o anterior;
 *  - a página mostra SÓ: título, mensagem, função, perigo, tipo, nível e medidas. Nada de
 *    responsável, prazos, nomes de outras pessoas, dados de clientes ou da operação;
 *  - o e-mail leva só o link (nenhuma informação de risco no corpo);
 *  - pelo túnel, o único caminho aberto é /sst-info/<código> (ver seguranca.ts).
 */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NOME_TIPO: Record<string, string> = { FISICO: 'Físico', QUIMICO: 'Químico', BIOLOGICO: 'Biológico', ERGONOMICO: 'Ergonômico', ACIDENTE: 'Acidente', PSICOSSOCIAL: 'Psicossocial' };
const NOME_NIVEL: Record<string, string> = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo', TRIVIAL: 'Trivial' };

/** Endereço público do link: LINK_PUBLICO_URL (servidor definitivo) ou o túnel atual. */
export function enderecoPublico(): string | null {
  if (process.env.LINK_PUBLICO_URL) return process.env.LINK_PUBLICO_URL.replace(/\/+$/, '');
  const arq = join(process.env.TEMP ?? process.env.TMP ?? '', 'tunel-url.txt');
  try { return existsSync(arq) ? readFileSync(arq, 'utf8').replace(/^﻿/, '').trim() || null : null; } catch { return null; }
}

type NovoComunicado = { titulo?: string; mensagem?: string; funcoes?: string[]; usuarios?: string[]; externos?: { nome?: string; email?: string }[]; validadeDias?: number };

@Injectable()
export class ComunicadosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly auditoria: AuditoriaService,
  ) {}

  statusEnvio() {
    const base = enderecoPublico();
    return {
      emailConfigurado: this.email.configurado,
      remetente: this.email.configurado ? (process.env.SMTP_FROM ?? process.env.SMTP_USER) : null,
      linkPublico: base,
      linkProvisorio: !process.env.LINK_PUBLICO_URL,
    };
  }

  /** Equipe do painel para escolher destinatários: só nome e função (o e-mail fica no servidor). */
  async equipe() {
    const us = await this.prisma.adminUser.findMany({ where: { ativo: true }, select: { id: true, nome: true, funcao: true, papel: true }, orderBy: { nome: 'asc' } });
    return us.map((u) => ({ id: u.id, nome: u.nome, funcao: u.papel === 'ADMIN' ? 'ADMIN' : u.funcao }));
  }

  async funcoesDoInventario() {
    // Só funções da equipe interna (riscos fora do escopo não são comunicados)
    const r = await this.prisma.riscoOcupacional.groupBy({ by: ['funcao'], where: { foraDoEscopo: false }, _count: true, _max: { atualizadoEm: true }, orderBy: { funcao: 'asc' } });
    return r.map((x) => ({ funcao: x.funcao, riscos: x._count, atualizadoEm: x._max.atualizadoEm }));
  }

  async listar() {
    const [lista, funcoes] = await Promise.all([
      this.prisma.comunicadoSst.findMany({ orderBy: { criadoEm: 'desc' }, take: 100, include: { destinatarios: { select: { id: true, nome: true, email: true, enviadoEm: true, envioErro: true, abertoEm: true, aberturas: true, cienteEm: true } } } }),
      this.funcoesDoInventario(),
    ]);
    const mudouEm = new Map(funcoes.map((f) => [f.funcao, f.atualizadoEm]));
    return lista.map((c) => {
      // Risco alterado depois da ciência: a pessoa precisa ser informada de novo
      const ultimaMudanca = Math.max(0, ...c.funcoes.map((f) => +(mudouEm.get(f) ?? 0)));
      const destinatarios = c.destinatarios.map((d) => ({ ...d, desatualizado: !!d.cienteEm && ultimaMudanca > +d.cienteEm }));
      return {
        ...c, destinatarios,
        situacao: c.revogadoEm ? 'REVOGADO' : c.expiraEm < new Date() ? 'VENCIDO' : 'ATIVO',
        riscosMudaramEm: ultimaMudanca ? new Date(ultimaMudanca) : null,
        totais: {
          destinatarios: destinatarios.length, enviados: destinatarios.filter((d) => d.enviadoEm).length,
          abertos: destinatarios.filter((d) => d.abertoEm).length, cientes: destinatarios.filter((d) => d.cienteEm).length,
          desatualizados: destinatarios.filter((d) => d.desatualizado).length, falhas: destinatarios.filter((d) => d.envioErro).length,
        },
      };
    });
  }

  async criar(dto: NovoComunicado, quem: UsuarioLogado) {
    const titulo = String(dto.titulo ?? '').trim().slice(0, 150);
    const mensagem = String(dto.mensagem ?? '').trim().slice(0, 3000);
    if (!titulo) throw new BadRequestException('Informe o título');
    const inventario = new Set((await this.funcoesDoInventario()).map((f) => f.funcao));
    const funcoes = [...new Set((dto.funcoes ?? []).map(String))].filter((f) => inventario.has(f));
    if (!funcoes.length) throw new BadRequestException('Escolha ao menos uma função do inventário de riscos');
    const dias = Math.min(Math.max(Math.round(Number(dto.validadeDias ?? 30)) || 30, 1), 90);

    // Destinatários: equipe do painel (e-mail resolvido aqui) + e-mails informados
    const pessoas = new Map<string, string>();
    if (dto.usuarios?.length) {
      const us = await this.prisma.adminUser.findMany({ where: { id: { in: dto.usuarios.map(String) }, ativo: true }, select: { nome: true, email: true } });
      for (const u of us) pessoas.set(u.email.toLowerCase(), u.nome);
    }
    for (const e of dto.externos ?? []) {
      const email = String(e.email ?? '').trim().toLowerCase();
      const nome = String(e.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!EMAIL.test(email)) throw new BadRequestException(`E-mail inválido: ${email || '(vazio)'}`);
      if (!nome) throw new BadRequestException(`Informe o nome de ${email}`);
      pessoas.set(email, nome);
    }
    if (!pessoas.size) throw new BadRequestException('Escolha ao menos um destinatário');
    if (pessoas.size > 300) throw new BadRequestException('No máximo 300 destinatários por comunicado');

    const tokens = new Map<string, string>();
    const comunicado = await this.prisma.comunicadoSst.create({
      data: {
        titulo, mensagem, funcoes, criadoPor: quem.email, expiraEm: new Date(Date.now() + dias * 864e5),
        destinatarios: {
          create: [...pessoas].map(([email, nome]) => {
            const token = randomBytes(32).toString('base64url');
            tokens.set(email, token);
            return { nome, email, tokenHash: hash(token) };
          }),
        },
      },
      include: { destinatarios: true },
    });
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `NR-1 comunicado "${titulo.slice(0, 60)}" criado: ${funcoes.join(', ')} · ${pessoas.size} destinatários · ${dias} dias` });
    const envios = await Promise.all(comunicado.destinatarios.map((d) => this.enviar(comunicado, d, tokens.get(d.email)!)));
    return { id: comunicado.id, ...this.resumoEnvio(envios) };
  }

  private resumoEnvio(envios: { nome: string; email: string; enviado: boolean; link: string | null; motivo?: string }[]) {
    return {
      enviados: envios.filter((e) => e.enviado).length,
      // Sem e-mail: devolve o link UMA vez para quem criou repassar pessoalmente (não fica guardado)
      pendentes: envios.filter((e) => !e.enviado).map((e) => ({ nome: e.nome, email: e.email, link: e.link, motivo: e.motivo })),
    };
  }

  private async enviar(c: { titulo: string; expiraEm: Date }, d: { id: string; nome: string; email: string }, token: string) {
    const base = enderecoPublico();
    const link = base ? `${base}/sst-info/${token}` : null;
    if (!link) {
      await this.prisma.comunicadoDestinatario.update({ where: { id: d.id }, data: { envioErro: 'Sem endereço público para o link' } });
      return { nome: d.nome, email: d.email, enviado: false, link: null, motivo: 'Sem endereço público para o link (túnel fora do ar)' };
    }
    const validade = c.expiraEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const primeiro = esc(d.nome.split(' ')[0]);
    const r = await this.email.enviar(
      d.email,
      'PR7 · Informações de segurança do trabalho',
      `Olá, ${d.nome.split(' ')[0]}.\n\nA PR7 disponibilizou as informações sobre os riscos da sua atividade e as medidas de prevenção (NR-1).\n\nAcesse: ${link}\n\nO link é pessoal, vale até ${validade} e não deve ser repassado. Ao final, confirme a leitura em "Li e estou ciente".`,
      `<p>Olá, <b>${primeiro}</b>.</p><p>A PR7 disponibilizou as informações sobre os <b>riscos da sua atividade e as medidas de prevenção</b> (NR-1).</p>` +
        `<p><a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver as informações</a></p>` +
        `<p style="color:#555;font-size:13px">O link é pessoal, vale até ${validade} e não deve ser repassado. Ao final, confirme a leitura em "Li e estou ciente".</p>`,
    );
    await this.prisma.comunicadoDestinatario.update({ where: { id: d.id }, data: r.enviado ? { enviadoEm: new Date(), envioErro: null } : { envioErro: String(r.motivo).slice(0, 300) } });
    return { nome: d.nome, email: d.email, enviado: r.enviado, link: r.enviado ? null : link, motivo: r.enviado ? undefined : r.motivo };
  }

  /** Reenvia (novo código; o link anterior deixa de valer). Serve para falha de envio e risco atualizado. */
  async reenviar(id: string, destinatarioId: string, quem: UsuarioLogado) {
    const c = await this.prisma.comunicadoSst.findUnique({ where: { id }, include: { destinatarios: { where: { id: destinatarioId } } } });
    const d = c?.destinatarios[0];
    if (!c || !d) throw new NotFoundException('Destinatário não encontrado');
    if (c.revogadoEm) throw new ConflictException('Comunicado revogado');
    // Vencido: renova a validade pelo mesmo prazo original
    const expiraEm = c.expiraEm < new Date() ? new Date(Date.now() + Math.max(+c.expiraEm - +c.criadoEm, 864e5)) : c.expiraEm;
    if (expiraEm !== c.expiraEm) await this.prisma.comunicadoSst.update({ where: { id }, data: { expiraEm } });
    const token = randomBytes(32).toString('base64url');
    // Nova ciência é exigida: a pessoa confirma de novo a versão atual dos riscos
    await this.prisma.comunicadoDestinatario.update({ where: { id: d.id }, data: { tokenHash: hash(token), enviadoEm: null, envioErro: null, cienteEm: null, cienteIp: null } });
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `NR-1 comunicado "${c.titulo.slice(0, 60)}" reenviado para ${d.email}${d.cienteEm ? ` (ciente anterior em ${d.cienteEm.toISOString()})` : ''}` });
    return this.resumoEnvio([await this.enviar({ titulo: c.titulo, expiraEm }, d, token)]);
  }

  async revogar(id: string, quem: UsuarioLogado) {
    const c = await this.prisma.comunicadoSst.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Comunicado não encontrado');
    if (c.revogadoEm) return { ok: true };
    await this.prisma.comunicadoSst.update({ where: { id }, data: { revogadoEm: new Date(), revogadoPor: quem.email } });
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `NR-1 comunicado "${c.titulo.slice(0, 60)}" revogado (links desativados)` });
    return { ok: true };
  }

  // ---------------- Página pública (link do e-mail) ----------------
  private async porToken(token: string) {
    if (!TOKEN.test(token)) return null;
    const d = await this.prisma.comunicadoDestinatario.findUnique({ where: { tokenHash: hash(token) }, include: { comunicado: true } });
    if (!d || d.comunicado.revogadoEm || d.comunicado.expiraEm < new Date()) return null;
    return d;
  }

  async pagina(token: string, ip: string) {
    const d = await this.porToken(token);
    if (!d) return paginaHtml('Link indisponível', '<p>Este link venceu, foi substituído por um mais recente ou foi desativado.</p><p>Se precisar das informações, fale com o técnico de Segurança do Trabalho da PR7.</p>');
    await this.prisma.comunicadoDestinatario.update({ where: { id: d.id }, data: { aberturas: { increment: 1 }, ...(d.abertoEm ? {} : { abertoEm: new Date() }) } });
    if (!d.abertoEm) this.auditoria.registrar('SEGURANCA', { ip, usuario: d.email, detalhe: `NR-1 comunicado aberto: "${d.comunicado.titulo.slice(0, 60)}"` });
    // Só o necessário: perigo, tipo, nível e medidas das funções do comunicado
    const riscos = await this.prisma.riscoOcupacional.findMany({ where: { funcao: { in: d.comunicado.funcoes }, foraDoEscopo: false }, select: { funcao: true, perigo: true, tipo: true, severidade: true, probabilidade: true, medidas: true }, orderBy: [{ funcao: 'asc' }, { severidade: 'desc' }] });
    const porFuncao = d.comunicado.funcoes.map((f) => ({ f, lista: riscos.filter((r) => r.funcao === f) }));
    const COR: Record<string, string> = { ALTO: '#dc2626', MEDIO: '#d97706', BAIXO: '#0f766e', TRIVIAL: '#64748b' };
    const corpo = `
      <p>Olá, <b>${esc(d.nome.split(' ')[0])}</b>.</p>
      ${d.comunicado.mensagem ? `<p style="white-space:pre-line">${esc(d.comunicado.mensagem)}</p>` : ''}
      ${porFuncao.map(({ f, lista }) => `<h2>${esc(f)}</h2>${lista.length ? lista.map((r) => {
        const n = nivelRisco(r.severidade, r.probabilidade);
        return `<div class="r"><div class="t"><span class="n" style="background:${COR[n]}">${NOME_NIVEL[n]}</span> <span class="tipo">${esc(NOME_TIPO[r.tipo] ?? r.tipo)}</span></div><div class="p">${esc(r.perigo)}</div><div class="m"><b>Como se prevenir:</b> ${esc(r.medidas)}</div></div>`;
      }).join('') : '<p class="vazio">Sem riscos cadastrados para esta função.</p>'}`).join('')}
      ${d.cienteEm
        ? `<div class="ok">✓ Leitura confirmada em ${d.cienteEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</div>`
        : `<form method="post" action="/sst-info/${esc(token)}/ciente"><button type="submit">Li e estou ciente</button></form>`}
      <p class="rod">Informação de uso pessoal e restrito · não repasse este link · válido até ${d.comunicado.expiraEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>`;
    return paginaHtml(d.comunicado.titulo, corpo);
  }

  async ciente(token: string, ip: string) {
    const d = await this.porToken(token);
    if (!d) return false;
    if (!d.cienteEm) {
      await this.prisma.comunicadoDestinatario.update({ where: { id: d.id }, data: { cienteEm: new Date(), cienteIp: ip.slice(0, 60) } });
      this.auditoria.registrar('SEGURANCA', { ip, usuario: d.email, detalhe: `NR-1 ciência confirmada: "${d.comunicado.titulo.slice(0, 60)}" (${d.comunicado.funcoes.join(', ').slice(0, 120)})` });
    }
    return true;
  }

  /** Para o checklist NR1-05: quantas pessoas confirmaram a ciência da versão atual dos riscos. */
  async indicador() {
    const lista = await this.listar();
    const ativos = lista.filter((c) => c.situacao !== 'REVOGADO');
    const pessoas = new Map<string, boolean>();
    for (const c of ativos) for (const d of c.destinatarios) pessoas.set(d.email, (pessoas.get(d.email) ?? false) || (!!d.cienteEm && !d.desatualizado));
    return { pessoas: pessoas.size, cientes: [...pessoas.values()].filter(Boolean).length };
  }
}

function paginaHtml(titulo: string, corpo: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(titulo)} · PR7</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7f8;--card:#fff;--tx:#10212a;--mu:#5b6b73;--ln:#dfe6ea}
@media (prefers-color-scheme:dark){:root{--bg:#0b1418;--card:#12222a;--tx:#e3eef3;--mu:#94a9b3;--ln:#23363f}}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 40px}
.cab{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mu)}h1{font-size:22px;margin:4px 0 18px}
h2{font-size:16px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ln)}
.r{background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.n{color:#fff;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:700}.tipo{font-size:12px;color:var(--mu)}
.p{font-weight:600;margin:6px 0}.m{font-size:14px}.vazio{color:var(--mu)}
button{margin-top:22px;background:#0f766e;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer;width:100%}
.ok{margin-top:22px;padding:12px;border-radius:10px;background:rgba(15,118,110,.15);color:#0f766e;font-weight:700;text-align:center}
.rod{margin-top:26px;font-size:12px;color:var(--mu);text-align:center}
</style></head><body><main><div class="cab">PR7 · Segurança do trabalho · NR-1</div><h1>${esc(titulo)}</h1>${corpo}</main></body></html>`;
}

@Protegido('nr1')
@Controller('sst')
class ComunicadosController {
  constructor(private readonly s: ComunicadosService) {}

  @Get('status') status() { return this.s.statusEnvio(); }
  @Get('equipe') equipe() { return this.s.equipe(); }
  @Get('funcoes') funcoes() { return this.s.funcoesDoInventario(); }
  @Get('comunicados') listar() { return this.s.listar(); }
  @Post('comunicados') criar(@Body() dto: NovoComunicado, @Req() req: { user: UsuarioLogado }) { return this.s.criar(dto, req.user); }
  @HttpCode(200) @Post('comunicados/:id/destinatarios/:did/reenviar')
  reenviar(@Param('id', ParseUUIDPipe) id: string, @Param('did', ParseUUIDPipe) did: string, @Req() req: { user: UsuarioLogado }) { return this.s.reenviar(id, did, req.user); }
  @HttpCode(200) @Post('comunicados/:id/revogar') revogar(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: UsuarioLogado }) { return this.s.revogar(id, req.user); }
}

type Resposta = { status(n: number): Resposta; setHeader(n: string, v: string): void; send(b: string): void; redirect(code: number, url: string): void };

/** Link do e-mail: sem login, só com o código pessoal. Único caminho aberto pelo túnel além do webhook. */
@Controller('sst-info')
class ComunicadoPublicoController {
  constructor(private readonly s: ComunicadosService) {}

  @Get(':token')
  async ver(@Param('token') token: string, @Req() req: Parameters<typeof ipReal>[0], @Res() res: Resposta) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(await this.s.pagina(token, ipReal(req)));
  }

  @Post(':token/ciente')
  async ciente(@Param('token') token: string, @Req() req: Parameters<typeof ipReal>[0], @Res() res: Resposta) {
    await this.s.ciente(token, ipReal(req));
    res.redirect(303, `/sst-info/${TOKEN.test(token) ? token : ''}`);
  }
}

@Module({ controllers: [ComunicadosController, ComunicadoPublicoController], providers: [ComunicadosService], exports: [ComunicadosService] })
export class ComunicadosModule {}
