import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { execFile } from 'child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, SomenteAdmin, UsuarioLogado } from '../auth/permissoes';
import { AuditoriaService } from './seguranca.module';
import { BackupModule, BackupService } from '../backup/backup.module';
import { ITENS_COMPLIANCE, RISCOS_INICIAIS, INVENTARIO_DADOS, SERVICOS_EXTERNOS } from './compliance-base';

/**
 * Aba Segurança — só o ADMINISTRADOR. Junta num lugar:
 *  - proteção dos dados: backup (idade, verificação do arquivo), integridade (tabela que
 *    diminuiu = possível perda), travas do banco, exposição de portas e segredos;
 *  - acessos: logins, bloqueios, IPs, usuários com poder demais, encerrar sessões;
 *  - compliance: LGPD (Lei 13.709/2018) e NR-1 (GRO/PGR, inclusive riscos psicossociais);
 *  - registro de incidentes (dados e ocupacionais).
 * Tudo o que é alterado aqui fica na auditoria (que o banco não deixa apagar).
 */
type Nivel = 'ok' | 'atencao' | 'critico';
type Verificacao = { grupo: string; item: string; nivel: Nivel; detalhe: string; acao?: string };

// Tabelas cuja diminuição é suspeita. Mensagem e auditoria têm trava no banco: diminuir = crítico.
const TABELAS: { tabela: string; modelo: string; critica: boolean; explicacao?: string }[] = [
  { tabela: 'Message', modelo: 'message', critica: true },
  { tabela: 'EventoSeguranca', modelo: 'eventoSeguranca', critica: true },
  { tabela: 'Atendimento', modelo: 'atendimento', critica: false, explicacao: 'pode ser mesclagem de duplicado ou reimportação da planilha' },
  { tabela: 'Pagamento', modelo: 'pagamento', critica: false },
  { tabela: 'Midia', modelo: 'midia', critica: false },
  { tabela: 'Conta', modelo: 'conta', critica: false },
  { tabela: 'Provider', modelo: 'provider', critica: false, explicacao: 'pode ser limpeza de cadastro inválido' },
  { tabela: 'AdminUser', modelo: 'adminUser', critica: false },
  { tabela: 'Evento', modelo: 'evento', critica: false },
];

const TRAVAS = ['mensagem_nunca_apagada', 'mensagem_conteudo_original', 'auditoria_imutavel'];
const PASTA_BACKUP = process.env.BACKUP_PASTA || join(__dirname, '..', '..', '..', '..', '..', 'backups');

const docker = (args: string[]) => new Promise<string>((ok) => execFile('docker', args, { timeout: 8000, windowsHide: true }, (err, out) => ok(err ? '' : String(out))));

@Injectable()
export class PainelSegurancaService {
  private readonly logger = new Logger('Seguranca');
  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---------------- Proteção dos dados ----------------
  async painel() {
    const v: Verificacao[] = [];

    // Backup
    const ultimo = this.backup.ultimo();
    const arquivos = existsSync(PASTA_BACKUP) ? readdirSync(PASTA_BACKUP).filter((f) => /^atendimento-.*\.sql(\.gz)?$/.test(f)) : [];
    const horas = ultimo ? (Date.now() - +ultimo.em) / 3600e3 : null;
    v.push({
      grupo: 'Backup', item: 'Último backup do banco',
      nivel: horas === null ? 'critico' : horas <= 13 ? 'ok' : horas <= 26 ? 'atencao' : 'critico',
      detalhe: ultimo ? `${ultimo.arquivo} · há ${horas! < 1 ? Math.round(horas! * 60) + ' min' : horas!.toFixed(1) + ' h'} · ${arquivos.length} cópias guardadas` : 'Nenhum backup encontrado',
      acao: horas === null || horas > 13 ? 'Fazer backup agora' : undefined,
    });
    v.push({ grupo: 'Backup', item: 'Cópia fora deste computador', nivel: 'atencao', detalhe: 'Os backups ficam na pasta do projeto (sincronizada pelo OneDrive). No servidor definitivo, manter também uma cópia em outro local.' });

    // Integridade: nenhuma tabela protegida pode diminuir
    const integridade = await this.integridade();
    for (const t of integridade) {
      if (t.diferenca >= 0) continue;
      v.push({
        grupo: 'Integridade', item: `Tabela ${t.tabela} diminuiu`, nivel: t.critica ? 'critico' : 'atencao',
        detalhe: `${t.anterior} → ${t.atual} registros (${t.diferenca}) desde ${t.anteriorEm ? new Date(t.anteriorEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}${t.explicacao ? ` — ${t.explicacao}` : ''}`,
      });
    }
    if (!integridade.some((t) => t.diferenca < 0)) v.push({ grupo: 'Integridade', item: 'Nenhuma tabela protegida perdeu registros', nivel: 'ok', detalhe: `${integridade.length} tabelas conferidas contra a medição anterior` });

    // Travas do banco
    const travas = await this.prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE tgname IN ('mensagem_nunca_apagada','mensagem_conteudo_original','auditoria_imutavel')`;
    const faltando = TRAVAS.filter((t) => !travas.some((x) => x.tgname === t));
    v.push({
      grupo: 'Integridade', item: 'Travas no banco (mensagens e auditoria não se apagam)',
      nivel: faltando.length ? 'critico' : 'ok', detalhe: faltando.length ? `Faltando: ${faltando.join(', ')}` : 'Mensagens do WhatsApp e auditoria: apagar e alterar é recusado pelo próprio banco',
    });

    // Exposição: banco e fila só aceitam conexão deste computador
    for (const [nome, container] of [['Banco de dados (Postgres)', 'projetowhatsapppr7-postgres-1'], ['Fila (Redis)', 'projetowhatsapppr7-redis-1']]) {
      const portas = await docker(['inspect', '-f', '{{json .NetworkSettings.Ports}}', container]);
      if (!portas.trim()) { v.push({ grupo: 'Acesso externo', item: nome, nivel: 'atencao', detalhe: 'Não foi possível conferir (Docker não respondeu)' }); continue; }
      const aberto = /"HostIp":"(0\.0\.0\.0|::)?"/.test(portas) && !/"HostIp":"127\.0\.0\.1"/.test(portas);
      v.push({ grupo: 'Acesso externo', item: nome, nivel: aberto ? 'critico' : 'ok', detalhe: aberto ? 'Porta aberta para a rede — qualquer um na rede pode tentar entrar' : 'Aceita conexão só deste computador (127.0.0.1)' });
    }
    const senhaBanco = decodeURIComponent((process.env.DATABASE_URL ?? '').match(/:\/\/[^:]+:([^@]*)@/)?.[1] ?? '');
    const usuarioBanco = (process.env.DATABASE_URL ?? '').match(/:\/\/([^:]+):/)?.[1] ?? '';
    v.push({
      grupo: 'Acesso externo', item: 'Senha do banco de dados',
      nivel: senhaBanco.length >= 20 && senhaBanco !== usuarioBanco ? 'ok' : 'atencao',
      detalhe: senhaBanco.length >= 20 && senhaBanco !== usuarioBanco ? 'Senha forte' : 'Senha fraca (igual ao usuário ou curta). O banco só aceita conexão local, mas a senha deve ser forte — obrigatório antes de ir para o servidor.',
    });
    v.push({ grupo: 'Acesso externo', item: 'Túnel da internet', nivel: 'ok', detalhe: 'De fora, só respondem o webhook do WhatsApp (com token) e o link pessoal dos comunicados NR-1 (código de 256 bits, com validade); painel e API ficam inacessíveis pela internet' });

    // Segredos
    const jwt = process.env.JWT_SECRET ?? '', wh = process.env.WEBHOOK_TOKEN ?? '';
    v.push({ grupo: 'Segredos', item: 'Chave das sessões (JWT)', nivel: jwt.length >= 32 ? 'ok' : 'critico', detalhe: `${jwt.length} caracteres` });
    v.push({ grupo: 'Segredos', item: 'Token do webhook do WhatsApp', nivel: wh.length >= 32 && !process.env.WEBHOOK_TOKEN_ANTERIOR ? 'ok' : 'atencao', detalhe: process.env.WEBHOOK_TOKEN_ANTERIOR ? 'Troca em andamento (token antigo ainda aceito)' : `${wh.length} caracteres · trocado em 18/09/2026` });

    // Acessos (7 dias)
    const acessos = await this.acessos();
    v.push({ grupo: 'Acessos', item: 'Tentativas de login recusadas (7 dias)', nivel: acessos.bloqueios > 0 || acessos.falhas >= 20 ? 'atencao' : 'ok', detalhe: `${acessos.falhas} senha/e-mail errados · ${acessos.bloqueios} bloqueios por tentativas · ${acessos.ipsDistintos} IPs diferentes com login` });
    v.push({ grupo: 'Acessos', item: 'Acessos de fora recusados (7 dias)', nivel: acessos.webhookRecusado > 50 ? 'atencao' : 'ok', detalhe: `${acessos.webhookRecusado} chamadas externas barradas · ${acessos.limite} bloqueios por excesso de requisições` });
    if (acessos.operadoresQueGerenciamUsuarios.length) v.push({ grupo: 'Acessos', item: 'Usuários não-administradores que gerenciam usuários', nivel: 'atencao', detalhe: `${acessos.operadoresQueGerenciamUsuarios.join(', ')} — podem criar e editar usuários (não administradores). Se não for necessário, retire a permissão "Gerenciar usuários".` });
    if (acessos.semUso.length) v.push({ grupo: 'Acessos', item: 'Usuários ativos sem entrar há 30+ dias', nivel: 'atencao', detalhe: `${acessos.semUso.join(', ')} — desative quem não usa mais` });
    v.push({ grupo: 'Acessos', item: 'Administradores', nivel: acessos.admins.length <= 2 ? 'ok' : 'atencao', detalhe: acessos.admins.join(', ') || '—' });

    const resumo = { ok: v.filter((x) => x.nivel === 'ok').length, atencao: v.filter((x) => x.nivel === 'atencao').length, critico: v.filter((x) => x.nivel === 'critico').length };
    return { geradoEm: new Date().toISOString(), resumo, verificacoes: v, acessos, integridade, servicosExternos: SERVICOS_EXTERNOS, inventarioDados: INVENTARIO_DADOS };
  }

  /** Mede as tabelas protegidas e compara com a medição anterior (grava no máximo 1 por hora). */
  async integridade() {
    const agora = await Promise.all(TABELAS.map(async (t) => ({ ...t, total: await (this.prisma as unknown as Record<string, { count: () => Promise<number> }>)[t.modelo].count() })));
    const resultado = [];
    for (const t of agora) {
      const anterior = await this.prisma.contagemTabela.findFirst({ where: { tabela: t.tabela }, orderBy: { medidoEm: 'desc' } });
      resultado.push({ tabela: t.tabela, critica: t.critica, explicacao: t.explicacao, atual: t.total, anterior: anterior?.total ?? t.total, anteriorEm: anterior?.medidoEm ?? null, diferenca: t.total - (anterior?.total ?? t.total) });
      if (!anterior || Date.now() - +anterior.medidoEm > 3600e3) await this.prisma.contagemTabela.create({ data: { tabela: t.tabela, total: t.total } });
    }
    return resultado;
  }

  async acessos() {
    const desde = new Date(Date.now() - 7 * 864e5);
    const porTipo = await this.prisma.eventoSeguranca.groupBy({ by: ['tipo'], where: { criadoEm: { gte: desde } }, _count: true });
    const n = (t: string) => porTipo.find((p) => p.tipo === t)?._count ?? 0;
    const ips = await this.prisma.eventoSeguranca.findMany({ where: { tipo: 'LOGIN_OK', criadoEm: { gte: desde } }, distinct: ['ip'], select: { ip: true } });
    const usuarios = await this.prisma.adminUser.findMany({ where: { ativo: true }, select: { nome: true, email: true, papel: true, permissoes: true, ultimoAcesso: true } });
    return {
      loginsOk: n('LOGIN_OK'), falhas: n('LOGIN_FALHA'), bloqueios: n('LOGIN_BLOQUEADO'), webhookRecusado: n('WEBHOOK_RECUSADO'),
      limite: n('LIMITE_EXCEDIDO'), exportacoes: n('EXPORTACAO'), sessoesRecusadas: n('SESSAO_RECUSADA'), ipsDistintos: ips.length,
      usuariosAtivos: usuarios.length,
      admins: usuarios.filter((u) => u.papel === 'ADMIN').map((u) => u.nome),
      operadoresQueGerenciamUsuarios: usuarios.filter((u) => u.papel !== 'ADMIN' && u.permissoes.includes('usuarios')).map((u) => u.nome),
      semUso: usuarios.filter((u) => !u.ultimoAcesso || Date.now() - +u.ultimoAcesso > 30 * 864e5).map((u) => u.nome),
    };
  }

  /** Confere se o último backup abre e está completo (sem restaurar nada). */
  async verificarBackup(quem: UsuarioLogado) {
    const u = this.backup.ultimo();
    if (!u) throw new NotFoundException('Nenhum backup encontrado');
    const caminho = join(PASTA_BACKUP, u.arquivo);
    const entrada = u.arquivo.endsWith('.gz') ? createReadStream(caminho).pipe(createGunzip()) : createReadStream(caminho);
    let tabelas = 0, completo = false, linhas = 0;
    const leitor = createInterface({ input: entrada, crlfDelay: Infinity });
    try {
      for await (const l of leitor) {
        linhas++;
        if (l.startsWith('COPY public.')) tabelas++;
        if (l.includes('PostgreSQL database dump complete')) completo = true;
      }
    } catch (e) {
      return { arquivo: u.arquivo, ok: false, detalhe: `Arquivo corrompido: ${(e as Error).message}` };
    }
    const ok = completo && tabelas >= 20;
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `backup verificado: ${u.arquivo} · ${ok ? 'íntegro' : 'COM PROBLEMA'} · ${tabelas} tabelas` });
    return { arquivo: u.arquivo, ok, tabelas, linhas, detalhe: ok ? `Íntegro: ${tabelas} tabelas, arquivo completo` : completo ? `Só ${tabelas} tabelas no arquivo` : 'Arquivo incompleto (o backup não terminou)' };
  }

  async fazerBackup(quem: UsuarioLogado) {
    const nome = await this.backup.fazer();
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `backup manual: ${nome}` });
    return { arquivo: nome };
  }

  /** Incidente de acesso: todos (inclusive quem clicou) precisam entrar de novo. */
  async encerrarSessoes(quem: UsuarioLogado, ip?: string) {
    const agora = new Date().toISOString();
    await this.prisma.configSistema.upsert({ where: { chave: 'sessoesValidasDesde' }, create: { chave: 'sessoesValidasDesde', valor: agora }, update: { valor: agora } });
    this.auditoria.registrar('SEGURANCA', { ip, usuario: quem.email, detalhe: 'todas as sessões encerradas (todos precisam entrar de novo)' });
    return { sessoesValidasDesde: agora };
  }

  // ---------------- Compliance (LGPD e NR-1) ----------------
  private async garantirBase() {
    if ((await this.prisma.itemCompliance.count()) === 0) await this.prisma.itemCompliance.createMany({ data: ITENS_COMPLIANCE, skipDuplicates: true });
    if ((await this.prisma.riscoOcupacional.count()) === 0) await this.prisma.riscoOcupacional.createMany({ data: RISCOS_INICIAIS });
  }

  async compliance() {
    await this.garantirBase();
    const [itens, riscos, painel] = await Promise.all([
      this.prisma.itemCompliance.findMany({ orderBy: { codigo: 'asc' } }),
      // NR-1 só da equipe interna: riscos fora do escopo (prestadores) não contam
      this.prisma.riscoOcupacional.findMany({ where: { foraDoEscopo: false } }),
      this.painel(),
    ]);
    // Itens conferidos pelo sistema: o status vem da realidade, não de um clique
    const nivelDe = (item: string) => painel.verificacoes.find((v) => v.item === item)?.nivel;
    const altos = riscos.filter((r) => r.severidade * r.probabilidade >= 9 && r.status !== 'CONTROLADO');
    // NR1-05: pessoas informadas pelos comunicados de risco (link pessoal com "estou ciente")
    const [info] = await this.prisma.$queryRaw<{ pessoas: number; cientes: number }[]>`
      SELECT count(DISTINCT d.email)::int pessoas, count(DISTINCT d.email) FILTER (WHERE d."cienteEm" IS NOT NULL)::int cientes
        FROM "ComunicadoDestinatario" d JOIN "ComunicadoSst" c ON c.id = d."comunicadoId" WHERE c."revogadoEm" IS NULL`;
    const auto: Record<string, { status: string; evidencia: string }> = {
      'LGPD-04': { status: painel.acessos.operadoresQueGerenciamUsuarios.length ? 'EM_ANDAMENTO' : 'ATENDIDO', evidencia: 'Perfis ADMIN/operador, permissões por tela e por linha de negócio, conferidas no servidor' },
      'LGPD-05': { status: nivelDe('Travas no banco (mensagens e auditoria não se apagam)') === 'ok' ? 'ATENDIDO' : 'PENDENTE', evidencia: 'Auditoria de logins, alterações e exportações; o banco recusa apagar ou alterar' },
      'LGPD-06': { status: nivelDe('Último backup do banco') === 'ok' ? 'EM_ANDAMENTO' : 'PENDENTE', evidencia: 'Backup automático a cada 12 h; falta cópia fora deste computador (servidor)' },
      'LGPD-11': { status: 'ATENDIDO', evidencia: 'Senha 10+ caracteres com letras e números, bcrypt, bloqueio por tentativas' },
      'LGPD-12': { status: 'EM_ANDAMENTO', evidencia: 'Internet só por HTTPS (túnel); dentro do computador em 127.0.0.1. HTTPS próprio no servidor definitivo' },
      'NR1-02': { status: riscos.length ? 'EM_ANDAMENTO' : 'PENDENTE', evidencia: `${riscos.length} riscos inventariados (validar com o profissional de SST)` },
      'NR1-03': { status: altos.every((r) => r.responsavel && r.prazo) ? (altos.length ? 'EM_ANDAMENTO' : 'ATENDIDO') : 'PENDENTE', evidencia: `${altos.filter((r) => r.responsavel && r.prazo).length} de ${altos.length} riscos médios/altos com responsável e prazo` },
      'NR1-05': { status: !info.pessoas ? 'PENDENTE' : info.cientes === info.pessoas ? 'ATENDIDO' : 'EM_ANDAMENTO', evidencia: info.pessoas ? `${info.cientes} de ${info.pessoas} trabalhadores confirmaram a ciência dos riscos (comunicados NR-1)` : 'Nenhum comunicado de riscos enviado ainda (NR-1 → Informar trabalhadores)' },
      'NR1-04': { status: riscos.some((r) => r.tipo === 'PSICOSSOCIAL') ? 'EM_ANDAMENTO' : 'PENDENTE', evidencia: `${riscos.filter((r) => r.tipo === 'PSICOSSOCIAL').length} riscos psicossociais no inventário + indicadores de jornada do Help Desk` },
    };
    return itens.map((i) => (i.automatico && auto[i.codigo] ? { ...i, ...auto[i.codigo] } : i));
  }

  async editarItem(id: string, dto: { status?: string; responsavel?: string; prazo?: string | null; evidencia?: string }, quem: UsuarioLogado) {
    const item = await this.prisma.itemCompliance.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item não encontrado');
    if (quem.papel !== 'ADMIN' && item.norma !== 'NR1') throw new ForbiddenException('Você só altera os itens da NR-1');
    if (item.automatico && dto.status) throw new BadRequestException('Este item é conferido automaticamente pelo sistema');
    if (dto.status && !['PENDENTE', 'EM_ANDAMENTO', 'ATENDIDO', 'NAO_SE_APLICA'].includes(dto.status)) throw new BadRequestException('Status inválido');
    const r = await this.prisma.itemCompliance.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.responsavel !== undefined ? { responsavel: dto.responsavel?.slice(0, 120) || null } : {}),
        ...(dto.prazo !== undefined ? { prazo: dto.prazo ? new Date(dto.prazo) : null } : {}),
        ...(dto.evidencia !== undefined ? { evidencia: dto.evidencia?.slice(0, 1000) || null } : {}),
        atualizadoPor: quem.email,
      },
    });
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `compliance ${item.codigo}: ${Object.keys(dto).join(', ')}` });
    return r;
  }

  // ---------------- NR-1: riscos e indicadores ----------------
  async riscos() {
    await this.garantirBase();
    const r = await this.prisma.riscoOcupacional.findMany({ orderBy: [{ funcao: 'asc' }, { criadoEm: 'asc' }] });
    return r.map((x) => ({ ...x, nivel: nivelRisco(x.severidade, x.probabilidade) }));
  }

  async salvarRisco(dto: Record<string, unknown>, quem: UsuarioLogado, id?: string) {
    const num = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException('Severidade e probabilidade de 1 a 5'); return n; };
    const txt = (v: unknown, max: number, obrig = false) => { const t = String(v ?? '').trim(); if (obrig && !t) throw new BadRequestException('Preencha função, perigo e medidas'); return t.slice(0, max) || null; };
    const TIPOS = ['FISICO', 'QUIMICO', 'BIOLOGICO', 'ERGONOMICO', 'ACIDENTE', 'PSICOSSOCIAL'];
    const data = {
      ...(dto.funcao !== undefined || !id ? { funcao: txt(dto.funcao, 80, true)! } : {}),
      ...(dto.perigo !== undefined || !id ? { perigo: txt(dto.perigo, 300, true)! } : {}),
      ...(dto.tipo !== undefined || !id ? { tipo: TIPOS.includes(String(dto.tipo)) ? String(dto.tipo) : (() => { throw new BadRequestException('Tipo de risco inválido'); })() } : {}),
      ...(dto.severidade !== undefined || !id ? { severidade: num(dto.severidade) } : {}),
      ...(dto.probabilidade !== undefined || !id ? { probabilidade: num(dto.probabilidade) } : {}),
      ...(dto.medidas !== undefined || !id ? { medidas: txt(dto.medidas, 2000, true)! } : {}),
      ...(dto.responsavel !== undefined ? { responsavel: txt(dto.responsavel, 120) } : {}),
      ...(dto.prazo !== undefined ? { prazo: dto.prazo ? new Date(String(dto.prazo)) : null } : {}),
      ...(dto.status !== undefined ? { status: ['ABERTO', 'EM_ANDAMENTO', 'CONTROLADO'].includes(String(dto.status)) ? String(dto.status) : 'ABERTO' } : {}),
      ...(dto.foraDoEscopo !== undefined ? { foraDoEscopo: dto.foraDoEscopo === true } : {}),
      ...(dto.motivoEscopo !== undefined ? { motivoEscopo: txt(dto.motivoEscopo, 300) } : {}),
      atualizadoPor: quem.email,
    };
    const r = id
      ? await this.prisma.riscoOcupacional.update({ where: { id }, data })
      : await this.prisma.riscoOcupacional.create({ data: data as never });
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `NR-1 risco ${id ? 'alterado' : 'incluído'}: ${r.funcao} · ${r.perigo.slice(0, 60)}` });
    return { ...r, nivel: nivelRisco(r.severidade, r.probabilidade) };
  }

  /**
   * Indicadores da operação ligados a riscos psicossociais (NR-1), últimos 30 dias:
   * carga do Help Desk (volume por dia, pico por hora, trabalho noturno) e exposição dos
   * agentes de campo a ocorrências de violência (roubo, furto, invasão, violação).
   */
  async indicadoresNr1() {
    const desde = new Date(Date.now() - 30 * 864e5);
    const helpDesk = await this.prisma.$queryRaw<{ nome: string; total: number; dias: number; noturnos: number; pico: number }[]>`
      WITH base AS (
        SELECT a."operadorPR7" nome, (coalesce(a."solicitadoEm", a."createdAt") - interval '3 hours') t
          FROM "Atendimento" a WHERE coalesce(a."solicitadoEm", a."createdAt") >= ${desde} AND coalesce(a."operadorPR7", '') <> ''
      )
      SELECT nome, count(*)::int total, count(DISTINCT t::date)::int dias,
             count(*) FILTER (WHERE extract(hour FROM t) >= 22 OR extract(hour FROM t) < 6)::int noturnos,
             (SELECT max(c)::int FROM (SELECT count(*) c FROM base b2 WHERE b2.nome = base.nome GROUP BY date_trunc('hour', b2.t)) x) pico
        FROM base GROUP BY nome ORDER BY total DESC`;
    // Agentes de campo são prestadores: fora da NR-1 por enquanto (só equipe interna, 18/09/2026)
    return {
      periodo: '30 dias',
      helpDesk: helpDesk.map((h) => ({ ...h, mediaPorDia: h.dias ? +(h.total / h.dias).toFixed(1) : 0, pctNoturno: h.total ? Math.round((h.noturnos / h.total) * 100) : 0 })),
      campo: null,
      escopo: 'NR-1 aplicada por enquanto só à equipe interna (sem serviço externo). Agentes de campo são prestadores e ficam fora destes indicadores.',
      observacao: 'Indicadores para apoiar o GRO/PGR. A avaliação e as medidas devem ser validadas pelo profissional de Segurança do Trabalho.',
    };
  }

  // ---------------- Incidentes ----------------
  // Técnico de SST (não-admin) só vê e registra acidentes/incidentes OCUPACIONAIS
  incidentes(quem: UsuarioLogado) {
    return this.prisma.incidenteSeguranca.findMany({ where: quem.papel === 'ADMIN' ? {} : { categoria: 'OCUPACIONAL' }, orderBy: { ocorridoEm: 'desc' }, take: 200 });
  }

  async salvarIncidente(dto: Record<string, unknown>, quem: UsuarioLogado, id?: string) {
    if (quem.papel !== 'ADMIN') {
      if (dto.categoria !== undefined && dto.categoria !== 'OCUPACIONAL') throw new ForbiddenException('Você registra só acidentes e incidentes ocupacionais');
      if (!id) dto = { ...dto, categoria: 'OCUPACIONAL' };
      else if ((await this.prisma.incidenteSeguranca.findUnique({ where: { id } }))?.categoria !== 'OCUPACIONAL') throw new ForbiddenException('Você altera só acidentes e incidentes ocupacionais');
      // Campos de vazamento de dados (ANPD/titulares) são do administrador
      for (const k of ['dadosAfetados', 'titularesAfetados', 'comunicadoAnpdEm', 'comunicadoTitularesEm']) delete dto[k];
    }
    const t = (k: string, max: number) => (dto[k] === undefined ? undefined : String(dto[k] ?? '').trim().slice(0, max) || null);
    const d = (k: string) => (dto[k] === undefined ? undefined : dto[k] ? new Date(String(dto[k])) : null);
    if (!id && (!t('titulo', 200) || !t('descricao', 4000) || !dto.ocorridoEm)) throw new BadRequestException('Preencha título, descrição e quando ocorreu');
    if (dto.categoria !== undefined && !['DADOS', 'OCUPACIONAL'].includes(String(dto.categoria))) throw new BadRequestException('Categoria inválida');
    if (dto.gravidade !== undefined && !['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'].includes(String(dto.gravidade))) throw new BadRequestException('Gravidade inválida');
    if (dto.status !== undefined && !['ABERTO', 'CONTIDO', 'ENCERRADO'].includes(String(dto.status))) throw new BadRequestException('Status inválido');
    const data = Object.fromEntries(Object.entries({
      categoria: dto.categoria, gravidade: dto.gravidade, status: dto.status,
      titulo: t('titulo', 200), descricao: t('descricao', 4000), dadosAfetados: t('dadosAfetados', 1000), medidas: t('medidas', 4000),
      titularesAfetados: dto.titularesAfetados === undefined ? undefined : dto.titularesAfetados === '' || dto.titularesAfetados === null ? null : Math.max(0, Number(dto.titularesAfetados) || 0),
      ocorridoEm: d('ocorridoEm'), comunicadoAnpdEm: d('comunicadoAnpdEm'), comunicadoTitularesEm: d('comunicadoTitularesEm'),
      // Acidente de trabalho: CAT no eSocial (S-2210) — data de envio e nº do recibo
      esocialEnviadoEm: d('esocialEnviadoEm'), esocialRecibo: t('esocialRecibo', 60),
    }).filter(([, v]) => v !== undefined));
    const r = id
      ? await this.prisma.incidenteSeguranca.update({ where: { id }, data })
      : await this.prisma.incidenteSeguranca.create({ data: { ...(data as Record<string, unknown>), registradoPor: quem.email } as never });
    this.auditoria.registrar('SEGURANCA', { usuario: quem.email, detalhe: `incidente ${id ? 'atualizado' : 'registrado'}: ${r.categoria} · ${r.gravidade} · ${r.titulo.slice(0, 80)}` });
    return r;
  }
}

/** Matriz 5×5 do PGR: severidade × probabilidade. */
export function nivelRisco(severidade: number, probabilidade: number) {
  const p = severidade * probabilidade;
  return p >= 15 ? 'ALTO' : p >= 9 ? 'MEDIO' : p >= 4 ? 'BAIXO' : 'TRIVIAL';
}

type Req = { user: UsuarioLogado; ip?: string };

/**
 * Proteção de dados, acessos, backup e LGPD: só ADMINISTRADOR.
 * Parte NR-1 (checklist NR-1, riscos, indicadores, incidentes OCUPACIONAIS): também quem
 * tem a permissão `nr1` (técnico de Segurança do Trabalho) — nunca vê incidente de dados.
 */
@Controller('seguranca/painel')
class PainelSegurancaController {
  constructor(private readonly s: PainelSegurancaService) {}

  @SomenteAdmin() @Get() painel() { return this.s.painel(); }
  @SomenteAdmin() @Post('backup') backup(@Req() req: Req) { return this.s.fazerBackup(req.user); }
  @SomenteAdmin() @Post('backup/verificar') verificar(@Req() req: Req) { return this.s.verificarBackup(req.user); }
  @SomenteAdmin() @Post('sessoes/encerrar') encerrar(@Req() req: Req) { return this.s.encerrarSessoes(req.user, req.ip); }

  @Protegido('nr1') @Get('compliance')
  async compliance(@Req() req: Req) {
    const itens = await this.s.compliance();
    return req.user.papel === 'ADMIN' ? itens : itens.filter((i) => i.norma === 'NR1');
  }
  @Protegido('nr1') @Patch('compliance/:id') editarItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, string>, @Req() req: Req) { return this.s.editarItem(id, dto, req.user); }

  @Protegido('nr1') @Get('nr1/riscos') riscos() { return this.s.riscos(); }
  @Protegido('nr1') @Post('nr1/riscos') novoRisco(@Body() dto: Record<string, unknown>, @Req() req: Req) { return this.s.salvarRisco(dto, req.user); }
  @Protegido('nr1') @Patch('nr1/riscos/:id') editarRisco(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>, @Req() req: Req) { return this.s.salvarRisco(dto, req.user, id); }
  @Protegido('nr1') @Get('nr1/indicadores') indicadores() { return this.s.indicadoresNr1(); }

  @Protegido('nr1') @Get('incidentes') incidentes(@Req() req: Req) { return this.s.incidentes(req.user); }
  @Protegido('nr1') @Post('incidentes') novoIncidente(@Body() dto: Record<string, unknown>, @Req() req: Req) { return this.s.salvarIncidente(dto, req.user); }
  @Protegido('nr1') @Patch('incidentes/:id') editarIncidente(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>, @Req() req: Req) { return this.s.salvarIncidente(dto, req.user, id); }
}

@Module({ imports: [BackupModule], controllers: [PainelSegurancaController], providers: [PainelSegurancaService] })
export class PainelSegurancaModule {}
