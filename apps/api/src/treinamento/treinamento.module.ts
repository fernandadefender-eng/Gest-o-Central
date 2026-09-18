import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, temPermissao, UsuarioLogado } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';
import { CENARIOS, MODULOS, RANQUES, XP_POR_DIFICULDADE, modulo, questao } from './conteudo';

/**
 * Academia PR7 (aba Treinamento), 18/09/2026.
 * Mecânicas dos jogos atuais (genéricas, sem marca de nenhum jogo): XP e níveis, ranques,
 * temporada com trilha de recompensas, missões diárias, ofensiva de dias seguidos,
 * conquistas, ranking semanal e o simulador "Plantão ao vivo" contra o relógio.
 * Gabarito só no servidor. No fim, certificado em PDF com o logo da PR7.
 */
const TRILHA = 'Formação Operacional PR7 · Temporada 2026';
const XP_POR_NIVEL = 100;
const NIVEIS_TEMPORADA = 30;
// Recompensas da trilha da temporada: títulos que aparecem no perfil
const RECOMPENSAS: Record<number, string> = { 2: 'Título "Plantonista"', 5: 'Moldura Bronze', 8: 'Título "Olho de Águia"', 10: 'Moldura Prata', 13: 'Título "Mestre da Fila"', 15: 'Moldura Ouro', 18: 'Título "Reflexo Rápido"', 20: 'Moldura Platina', 25: 'Título "Guardião da Central"', 30: 'Moldura Lenda' };
const LOGO = [join(__dirname, '..', '..', 'assets', 'logo-pr7.png'), join(process.cwd(), 'assets', 'logo-pr7.png')].find((p) => existsSync(p));
const dataBr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
const modulosComConteudo = () => MODULOS.filter((m) => !m.aguardandoMaterial && m.questoes.length);
const ranqueDe = (xp: number) => {
  const i = RANQUES.reduce((acc, r, k) => (xp >= r.xp ? k : acc), 0);
  return { ...RANQUES[i], proximo: RANQUES[i + 1] ?? null };
};
const nomeCurto = (nome: string) => { const p = nome.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };

@Injectable()
export class TreinamentoService {
  constructor(private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  private async dados(userId: string) {
    const [respostas, simulacoes, validacoes, certificados] = await Promise.all([
      this.prisma.treinoResposta.findMany({ where: { userId }, orderBy: { criadoEm: 'asc' } }),
      this.prisma.treinoSimulacao.findMany({ where: { userId }, orderBy: { criadoEm: 'asc' } }),
      this.prisma.treinoValidacao.findMany(),
      this.prisma.treinoCertificado.findMany({ where: { userId }, orderBy: { emitidoEm: 'desc' } }),
    ]);
    return { respostas, simulacoes, validadas: new Map(validacoes.map((v) => [v.moduloCodigo, v])), certificados };
  }

  private calcular(d: Awaited<ReturnType<TreinamentoService['dados']>>) {
    const xp = d.respostas.reduce((s, r) => s + r.xp, 0) + d.simulacoes.reduce((s, r) => s + r.xp, 0);
    const certas = new Set(d.respostas.filter((r) => r.correta).map((r) => r.questaoId));
    const modulos = MODULOS.map((m) => {
      const primeiras = d.respostas.filter((r) => r.moduloCodigo === m.codigo && r.primeira);
      const acertos = m.questoes.filter((q) => certas.has(q.id)).length;
      const nota = primeiras.length ? Math.round((primeiras.filter((r) => r.correta).length / primeiras.length) * 100) : null;
      return {
        codigo: m.codigo, titulo: m.titulo, area: m.area, icone: m.icone, resumo: m.resumo,
        total: m.questoes.length, acertos, nota, concluido: m.questoes.length > 0 && acertos === m.questoes.length,
        perfeito: m.questoes.length > 0 && primeiras.length === m.questoes.length && primeiras.every((r) => r.correta),
        validado: d.validadas.has(m.codigo), aguardandoMaterial: m.aguardandoMaterial ?? null,
      };
    });
    const melhorSim = new Map<string, { acertos: number; total: number; tempoMs: number }>();
    for (const s of d.simulacoes) {
      const a = melhorSim.get(s.cenarioId);
      if (!a || s.acertos > a.acertos || (s.acertos === a.acertos && s.tempoMs < a.tempoMs)) melhorSim.set(s.cenarioId, { acertos: s.acertos, total: s.total, tempoMs: s.tempoMs });
    }
    const cenarios = CENARIOS.map((c) => ({ id: c.id, titulo: c.titulo, area: c.area, tempoSeg: c.tempoSeg, etapas: c.etapas.length, melhor: melhorSim.get(c.id) ?? null }));
    // Ofensiva: dias seguidos (horário de Brasília) com alguma atividade
    const dias = new Set([...d.respostas, ...d.simulacoes].map((r) => dataBr(r.criadoEm)));
    let ofensiva = 0;
    const cursor = new Date();
    if (!dias.has(dataBr(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (dias.has(dataBr(cursor))) { ofensiva++; cursor.setDate(cursor.getDate() - 1); }
    // Missões do dia
    const hoje = dataBr(new Date());
    const rHoje = d.respostas.filter((r) => dataBr(r.criadoEm) === hoje);
    const missoes = [
      { id: 'responder', titulo: 'Responda 5 questões', progresso: Math.min(rHoje.length, 5), meta: 5 },
      { id: 'primeira', titulo: 'Acerte 3 de primeira', progresso: Math.min(rHoje.filter((r) => r.primeira && r.correta).length, 3), meta: 3 },
      { id: 'plantao', titulo: 'Complete 1 Plantão ao vivo', progresso: Math.min(d.simulacoes.filter((s) => dataBr(s.criadoEm) === hoje).length, 1), meta: 1 },
    ];
    const conquistas = [
      { id: 'primeiro', titulo: 'Primeiro passo', desc: 'Acertou a primeira questão', ok: certas.size > 0, icone: '👣' },
      { id: 'fila', titulo: 'Mestre da fila', desc: 'Concluiu todos os módulos de tratativa de eventos disponíveis', ok: modulos.filter((m) => m.area === 'MONITORAMENTO' && m.total > 0).every((m) => m.concluido), icone: '🛰️' },
      { id: 'perfeito', titulo: 'Sem erro', desc: 'Um módulo inteiro de primeira', ok: modulos.some((m) => m.perfeito), icone: '🎯' },
      { id: 'plantao', titulo: 'Plantão perfeito', desc: '100% num Plantão ao vivo', ok: d.simulacoes.some((s) => s.acertos === s.total), icone: '🏆' },
      { id: 'reflexo', titulo: 'Reflexo rápido', desc: 'Plantão 100% em menos da metade do tempo', ok: d.simulacoes.some((s) => { const c = CENARIOS.find((x) => x.id === s.cenarioId); return !!c && s.acertos === s.total && s.tempoMs < c.tempoSeg * 500; }), icone: '⚡' },
      { id: 'ofensiva7', titulo: 'Ofensiva de 7 dias', desc: 'Treinou 7 dias seguidos', ok: ofensiva >= 7, icone: '🔥' },
      { id: 'formado', titulo: 'Formado', desc: 'Recebeu o certificado da PR7', ok: d.certificados.length > 0, icone: '🎓' },
    ];
    return { xp, modulos, cenarios, ofensiva, missoes, conquistas };
  }

  /** O que falta para o certificado (lista vazia = pode emitir). */
  private faltas(c: ReturnType<TreinamentoService['calcular']>) {
    const f: string[] = [];
    for (const m of c.modulos.filter((x) => !x.aguardandoMaterial && x.total)) {
      if (!m.concluido) f.push(`Concluir "${m.titulo}" (${m.acertos}/${m.total})`);
      if (!m.validado) f.push(`Conteúdo de "${m.titulo}" aguardando validação da supervisão`);
    }
    for (const s of c.cenarios) if (!s.melhor || s.melhor.acertos / s.melhor.total < 2 / 3) f.push(`Plantão ao vivo "${s.titulo}" com pelo menos 2/3 de acerto`);
    return f;
  }

  async perfil(u: UsuarioLogado) {
    const [d, eu] = await Promise.all([this.dados(u.userId), this.prisma.adminUser.findUnique({ where: { id: u.userId }, select: { avatar: true } })]);
    const c = this.calcular(d);
    const nivel = Math.min(Math.floor(c.xp / XP_POR_NIVEL) + 1, NIVEIS_TEMPORADA);
    return {
      nome: u.nome, avatar: eu?.avatar ?? null, xp: c.xp, ranque: ranqueDe(c.xp), ranques: RANQUES,
      temporada: { nome: TRILHA, nivel, maximo: NIVEIS_TEMPORADA, xpNoNivel: c.xp % XP_POR_NIVEL, xpPorNivel: XP_POR_NIVEL, recompensas: RECOMPENSAS },
      ofensiva: c.ofensiva, missoes: c.missoes, conquistas: c.conquistas, modulos: c.modulos, cenarios: c.cenarios,
      certificado: { faltas: this.faltas(c), emitidos: d.certificados.map((x) => ({ codigo: x.codigo, trilha: x.trilha, emitidoEm: x.emitidoEm, nota: x.nota })) },
      podeGerir: temPermissao(u, 'equipe'),
      podeValidar: u.papel === 'ADMIN' || u.funcao === 'SUPERVISAO',
    };
  }

  /** Lições e perguntas SEM gabarito. */
  moduloParaEstudo(codigo: string) {
    const m = modulo(codigo);
    if (!m) throw new NotFoundException('Módulo não encontrado');
    return { codigo: m.codigo, titulo: m.titulo, icone: m.icone, resumo: m.resumo, licoes: m.licoes, aguardandoMaterial: m.aguardandoMaterial ?? null, questoes: m.questoes.map((q) => ({ id: q.id, enunciado: q.enunciado, opcoes: q.opcoes, dificuldade: q.dificuldade, xp: XP_POR_DIFICULDADE[q.dificuldade] })) };
  }

  async responder(u: UsuarioLogado, dto: { questaoId?: string; resposta?: number; tempoMs?: number }) {
    const achado = questao(String(dto.questaoId ?? ''));
    if (!achado) throw new NotFoundException('Questão não encontrada');
    const { m, q } = achado;
    const resp = Number(dto.resposta);
    if (!Number.isInteger(resp) || resp < 0 || resp >= q.opcoes.length) throw new BadRequestException('Resposta inválida');
    const anteriores = await this.prisma.treinoResposta.findMany({ where: { userId: u.userId, questaoId: q.id }, select: { correta: true } });
    const correta = resp === q.certa;
    // XP só no primeiro acerto de cada questão (não dá para "farmar" repetindo)
    const xp = correta && !anteriores.some((a) => a.correta) ? XP_POR_DIFICULDADE[q.dificuldade] : 0;
    await this.prisma.treinoResposta.create({ data: { userId: u.userId, questaoId: q.id, moduloCodigo: m.codigo, correta, primeira: anteriores.length === 0, xp, tempoMs: Number.isFinite(dto.tempoMs) ? Math.min(Math.max(Math.round(Number(dto.tempoMs)), 0), 3600e3) : null } });
    return { correta, certa: q.certa, explicacao: q.explicacao, xp };
  }

  cenario(id: string) {
    const c = CENARIOS.find((x) => x.id === id);
    if (!c) throw new NotFoundException('Cenário não encontrado');
    return { id: c.id, titulo: c.titulo, area: c.area, alerta: c.alerta, tempoSeg: c.tempoSeg, etapas: c.etapas.map((e) => ({ pergunta: e.pergunta, opcoes: e.opcoes })) };
  }

  async jogarCenario(u: UsuarioLogado, id: string, dto: { respostas?: number[]; tempoMs?: number }) {
    const c = CENARIOS.find((x) => x.id === id);
    if (!c) throw new NotFoundException('Cenário não encontrado');
    const respostas = Array.isArray(dto.respostas) ? dto.respostas.map(Number) : [];
    if (respostas.length !== c.etapas.length) throw new BadRequestException('Responda todas as etapas');
    const tempoMs = Math.min(Math.max(Math.round(Number(dto.tempoMs) || 0), 0), 3600e3);
    const noTempo = tempoMs <= c.tempoSeg * 1000;
    // Estourou o tempo: as etapas contam, mas sem bônus de velocidade
    const resultado = c.etapas.map((e, i) => ({ correta: respostas[i] === e.certa, certa: e.certa, explicacao: e.explicacao }));
    const acertos = resultado.filter((r) => r.correta).length;
    const pontos = acertos * 15 + (acertos === c.etapas.length && noTempo ? 10 + Math.round(20 * (1 - tempoMs / (c.tempoSeg * 1000))) : 0);
    // XP só pela melhora sobre o melhor resultado anterior neste cenário
    const anteriores = await this.prisma.treinoSimulacao.aggregate({ where: { userId: u.userId, cenarioId: id }, _sum: { xp: true } });
    const xp = Math.max(0, pontos - (anteriores._sum.xp ?? 0));
    await this.prisma.treinoSimulacao.create({ data: { userId: u.userId, cenarioId: id, acertos, total: c.etapas.length, tempoMs, xp, respostas } });
    return { acertos, total: c.etapas.length, tempoMs, noTempo, pontos, xp, resultado };
  }

  /** Ranking da semana (segunda a domingo, Brasília): primeiro nome + inicial. */
  async ranking(u: UsuarioLogado) {
    // Meia-noite de Brasília (03:00 UTC) da segunda-feira desta semana
    const hoje = new Date(`${dataBr(new Date())}T03:00:00Z`);
    const seg = new Date(+hoje - ((hoje.getUTCDay() + 6) % 7) * 864e5);
    const [r, s] = await Promise.all([
      this.prisma.treinoResposta.groupBy({ by: ['userId'], where: { criadoEm: { gte: seg } }, _sum: { xp: true } }),
      this.prisma.treinoSimulacao.groupBy({ by: ['userId'], where: { criadoEm: { gte: seg } }, _sum: { xp: true } }),
    ]);
    const tot = new Map<string, number>();
    for (const x of [...r, ...s]) tot.set(x.userId, (tot.get(x.userId) ?? 0) + (x._sum.xp ?? 0));
    const us = await this.prisma.adminUser.findMany({ where: { id: { in: [...tot.keys()] } }, select: { id: true, nome: true, avatar: true } });
    const lista = us.map((x) => ({ id: x.id, nome: nomeCurto(x.nome), avatar: x.avatar, xp: tot.get(x.id) ?? 0 })).sort((a, b) => b.xp - a.xp);
    return { desde: seg, top: lista.slice(0, 10).map(({ id, ...x }, i) => ({ posicao: i + 1, ...x, eu: id === u.userId })), minhaPosicao: lista.findIndex((x) => x.id === u.userId) + 1 || null };
  }

  /** Avatar do jogo: masculino (M) ou feminino (F), escolhido pela própria pessoa. */
  async escolherAvatar(u: UsuarioLogado, avatar: unknown) {
    if (avatar !== 'M' && avatar !== 'F') throw new BadRequestException('Escolha o avatar M ou F');
    await this.prisma.adminUser.update({ where: { id: u.userId }, data: { avatar } });
    return { avatar };
  }

  // ---------------- Supervisão ----------------
  async equipe() {
    const us = await this.prisma.adminUser.findMany({ where: { ativo: true, papel: 'OPERADOR', permissoes: { has: 'treinamento' } }, select: { id: true, nome: true, funcao: true }, orderBy: { nome: 'asc' } });
    return Promise.all(us.map(async (x) => {
      const d = await this.dados(x.id);
      const c = this.calcular(d);
      const ultima = [...d.respostas, ...d.simulacoes].reduce<Date | null>((a, r) => (!a || r.criadoEm > a ? r.criadoEm : a), null);
      const comNota = c.modulos.filter((m) => m.nota !== null);
      const fraco = comNota.sort((a, b) => (a.nota ?? 0) - (b.nota ?? 0))[0];
      return {
        nome: x.nome, funcao: x.funcao, xp: c.xp, ranque: ranqueDe(c.xp).nome, ofensiva: c.ofensiva,
        concluidos: c.modulos.filter((m) => m.concluido).length, totalModulos: modulosComConteudo().length,
        ultimaAtividade: ultima, pontoFraco: fraco && (fraco.nota ?? 100) < 70 ? `${fraco.titulo} (${fraco.nota}% de primeira)` : null,
        certificado: d.certificados[0]?.codigo ?? null,
      };
    }));
  }

  async validacoes() {
    const v = await this.prisma.treinoValidacao.findMany();
    return MODULOS.map((m) => ({ codigo: m.codigo, titulo: m.titulo, aguardandoMaterial: m.aguardandoMaterial ?? null, validacao: v.find((x) => x.moduloCodigo === m.codigo) ?? null }));
  }

  async validar(u: UsuarioLogado, codigo: string, validar: boolean, observacao?: string) {
    if (!(u.papel === 'ADMIN' || u.funcao === 'SUPERVISAO')) throw new ForbiddenException('Só a supervisão ou o administrador valida o conteúdo');
    const m = modulo(codigo);
    if (!m) throw new NotFoundException('Módulo não encontrado');
    if (m.aguardandoMaterial) throw new BadRequestException('Módulo sem conteúdo ainda');
    if (validar) await this.prisma.treinoValidacao.upsert({ where: { moduloCodigo: codigo }, create: { moduloCodigo: codigo, validadoPor: u.email, observacao: observacao?.slice(0, 300) || null }, update: { validadoPor: u.email, validadoEm: new Date(), observacao: observacao?.slice(0, 300) || null } });
    else await this.prisma.treinoValidacao.deleteMany({ where: { moduloCodigo: codigo } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Treinamento: conteúdo "${m.titulo}" ${validar ? 'validado' : 'voltou para revisão'}${observacao ? ' — ' + observacao.slice(0, 120) : ''}` });
    return { ok: true };
  }

  // ---------------- Certificado ----------------
  async emitir(u: UsuarioLogado) {
    const d = await this.dados(u.userId);
    const c = this.calcular(d);
    const faltas = this.faltas(c);
    if (faltas.length) throw new BadRequestException(`Ainda falta: ${faltas.slice(0, 3).join('; ')}${faltas.length > 3 ? ` (+${faltas.length - 3})` : ''}`);
    const modulos = modulosComConteudo().map((m) => m.titulo);
    // Mesma trilha e mesmos módulos: devolve o certificado já emitido
    const existente = d.certificados.find((x) => x.trilha === TRILHA && x.modulos.join('|') === modulos.join('|'));
    if (existente) return { codigo: existente.codigo, novo: false };
    const primeiras = d.respostas.filter((r) => r.primeira);
    const nota = primeiras.length ? Math.round((primeiras.filter((r) => r.correta).length / primeiras.length) * 100) : 0;
    const user = await this.prisma.adminUser.findUnique({ where: { id: u.userId }, select: { nome: true, email: true } });
    const codigo = `PR7-TR-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    await this.prisma.treinoCertificado.create({ data: { codigo, userId: u.userId, nome: user!.nome, email: user!.email, trilha: TRILHA, modulos, nota, xp: c.xp, ranque: ranqueDe(c.xp).nome } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { usuario: u.email, detalhe: `Treinamento: certificado ${codigo} emitido (${modulos.length} módulos, nota ${nota}%)` });
    return { codigo, novo: true };
  }

  async certificado(u: UsuarioLogado, codigo: string) {
    const cert = await this.prisma.treinoCertificado.findUnique({ where: { codigo } });
    if (!cert) throw new NotFoundException('Certificado não encontrado');
    // Cada um baixa o seu; supervisão/administrador conferem os da equipe
    if (cert.userId !== u.userId && !temPermissao(u, 'equipe')) throw new ForbiddenException('Certificado de outra pessoa');
    return cert;
  }

  pdf(cert: { codigo: string; nome: string; trilha: string; modulos: string[]; nota: number; ranque: string; emitidoEm: Date }): Promise<Buffer> {
    return new Promise((ok, erro) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificado ${cert.codigo}`, Author: 'PR7 Inteligência em Segurança' } });
      const partes: Buffer[] = [];
      doc.on('data', (b: Buffer) => partes.push(b));
      doc.on('end', () => ok(Buffer.concat(partes)));
      doc.on('error', erro);
      const W = doc.page.width, H = doc.page.height;
      const OURO = '#b8892b', ESCURO = '#1c1a17';
      doc.rect(0, 0, W, H).fill('#fffdf7');
      doc.lineWidth(3).strokeColor(OURO).rect(22, 22, W - 44, H - 44).stroke();
      doc.lineWidth(0.8).strokeColor(OURO).rect(30, 30, W - 60, H - 60).stroke();
      if (LOGO) doc.image(LOGO, W / 2 - 75, 14, { fit: [150, 150], align: 'center' });
      else doc.font('Times-Bold').fontSize(40).fillColor(OURO).text('PR7', 0, 60, { width: W, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(30).fillColor(ESCURO).text('CERTIFICADO', 0, 160, { width: W, align: 'center', characterSpacing: 6 });
      doc.font('Helvetica').fontSize(13).fillColor('#57534e').text('A PR7 Inteligência em Segurança certifica que', 0, 205, { width: W, align: 'center' });
      doc.font('Times-BoldItalic').fontSize(32).fillColor(OURO).text(cert.nome, 60, 228, { width: W - 120, align: 'center' });
      doc.font('Helvetica').fontSize(13).fillColor('#57534e').text(`concluiu a trilha ${cert.trilha}, com aproveitamento de ${cert.nota}% nas respostas de primeira tentativa, alcançando o ranque ${cert.ranque}, nos módulos:`, 90, 278, { width: W - 180, align: 'center' });
      doc.font('Helvetica').fontSize(11).fillColor(ESCURO).text(cert.modulos.map((m) => '• ' + m).join('     '), 90, 322, { width: W - 180, align: 'center' });
      const data = cert.emitidoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
      doc.moveTo(W / 2 - 150, H - 120).lineTo(W / 2 + 150, H - 120).lineWidth(0.8).strokeColor('#78716c').stroke();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(ESCURO).text('PR7 Inteligência em Segurança', 0, H - 112, { width: W, align: 'center' });
      doc.font('Helvetica').fontSize(10).fillColor('#57534e').text(`Emitido em ${data}`, 0, H - 96, { width: W, align: 'center' });
      doc.font('Helvetica').fontSize(8.5).fillColor('#78716c').text(`Código de verificação: ${cert.codigo} · conferível pela administração da PR7`, 0, H - 62, { width: W, align: 'center' });
      doc.end();
    });
  }

  async verificar(codigo: string) {
    const c = await this.prisma.treinoCertificado.findUnique({ where: { codigo } });
    return c ? { valido: true, nome: c.nome, trilha: c.trilha, modulos: c.modulos, nota: c.nota, emitidoEm: c.emitidoEm } : { valido: false };
  }
}

type Req = { user: UsuarioLogado };

@Protegido('treinamento')
@Controller('treinamento')
class TreinamentoController {
  constructor(private readonly s: TreinamentoService) {}

  @Get('perfil') perfil(@Req() r: Req) { return this.s.perfil(r.user); }
  @Get('modulos/:codigo') modulo(@Param('codigo') c: string) { return this.s.moduloParaEstudo(c); }
  @HttpCode(200) @Post('responder') responder(@Body() dto: { questaoId?: string; resposta?: number; tempoMs?: number }, @Req() r: Req) { return this.s.responder(r.user, dto); }
  @Get('cenarios/:id') cenario(@Param('id') id: string) { return this.s.cenario(id); }
  @HttpCode(200) @Post('cenarios/:id') jogar(@Param('id') id: string, @Body() dto: { respostas?: number[]; tempoMs?: number }, @Req() r: Req) { return this.s.jogarCenario(r.user, id, dto); }
  @Get('ranking') ranking(@Req() r: Req) { return this.s.ranking(r.user); }
  @HttpCode(200) @Post('avatar') avatar(@Body() b: { avatar?: string }, @Req() r: Req) { return this.s.escolherAvatar(r.user, b?.avatar); }
  @HttpCode(200) @Post('certificado') emitir(@Req() r: Req) { return this.s.emitir(r.user); }

  @Get('certificado/:codigo/pdf')
  async baixar(@Param('codigo') codigo: string, @Req() r: Req, @Res() res: { setHeader(n: string, v: string): void; send(b: Buffer): void }) {
    const cert = await this.s.certificado(r.user, codigo);
    const pdf = await this.s.pdf(cert);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificado-${cert.codigo}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}

/** Supervisão: progresso da equipe, validação do conteúdo e conferência de certificados. */
@Protegido('equipe')
@Controller('treinamento/gestao')
class TreinamentoGestaoController {
  constructor(private readonly s: TreinamentoService) {}

  @Get('equipe') equipe() { return this.s.equipe(); }
  @Get('validacoes') validacoes() { return this.s.validacoes(); }
  @HttpCode(200) @Post('validacoes/:codigo') validar(@Param('codigo') c: string, @Body() b: { validar?: boolean; observacao?: string }, @Req() r: Req) { return this.s.validar(r.user, c, b?.validar !== false, typeof b?.observacao === 'string' ? b.observacao : undefined); }
  @Get('verificar/:codigo') verificar(@Param('codigo') c: string) { return this.s.verificar(c); }
}

@Module({ controllers: [TreinamentoController, TreinamentoGestaoController], providers: [TreinamentoService] })
export class TreinamentoModule {}
