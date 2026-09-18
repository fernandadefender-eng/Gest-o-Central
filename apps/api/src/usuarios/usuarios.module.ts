import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Papel, Prisma, Vertical } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../seguranca/seguranca.module';
import { FUNCOES, FUNCOES_DA_OPERACAO, Permissao, PERMISSOES, PERMISSOES_DA_OPERACAO, Protegido, SomenteAdmin, UsuarioLogado } from '../auth/permissoes';
import { EmailService } from '../email/email.module';

const CHAVES = Object.keys(PERMISSOES);
const CHAVES_FUNCAO = Object.keys(FUNCOES);
// Senha forte: 10+ caracteres, com letra e número
const SENHA = /^(?=.*[A-Za-z])(?=.*\d).{10,}$/;
const MSG_SENHA = 'Senha com pelo menos 10 caracteres, letras e números';

class NovoUsuarioDto {
  @Transform(({ value }) => String(value ?? '').replace(/\s+/g, ' ').trim())
  @Matches(/^\S{2,}(\s+\S+)+$/, { message: 'Informe nome e sobrenome' }) nome!: string;
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase()) @IsEmail() email!: string;
  @IsString() @Matches(SENHA, { message: MSG_SENHA }) senha!: string;
  @IsOptional() @IsEnum(Papel) papel?: Papel;
  @IsOptional() @IsIn(CHAVES_FUNCAO, { message: 'Função inválida' }) funcao?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(CHAVES, { each: true }) permissoes?: Permissao[];
  @IsOptional() @IsArray() @ArrayUnique() @IsEnum(Vertical, { each: true }) verticais?: Vertical[];
}

class EditarUsuarioDto {
  @IsOptional() @Transform(({ value }) => String(value ?? '').replace(/\s+/g, ' ').trim())
  @Matches(/^\S{2,}(\s+\S+)+$/, { message: 'Informe nome e sobrenome' }) nome?: string;
  @IsOptional() @IsString() @Matches(SENHA, { message: MSG_SENHA }) senha?: string;
  @IsOptional() @IsEnum(Papel) papel?: Papel;
  @IsOptional() @IsIn(CHAVES_FUNCAO, { message: 'Função inválida' }) funcao?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(CHAVES, { each: true }) permissoes?: Permissao[];
  @IsOptional() @IsArray() @ArrayUnique() @IsEnum(Vertical, { each: true }) verticais?: Vertical[];
  @IsOptional() @IsBoolean() ativo?: boolean;
}

const PUBLICO = { id: true, nome: true, email: true, papel: true, funcao: true, permissoes: true, verticais: true, ativo: true, ultimoAcesso: true, createdAt: true } as const;

@Injectable()
class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // Administrador vê todos; quem cuida da Operação vê só a equipe do setor dele
  listar(quem: UsuarioLogado) {
    return this.prisma.adminUser.findMany({
      where: quem.papel === Papel.ADMIN ? {} : { papel: Papel.OPERADOR, funcao: { in: FUNCOES_DA_OPERACAO } },
      select: PUBLICO, orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });
  }

  /**
   * Regra da equipe da Operação para quem NÃO é administrador: só Help Desk/Operador de
   * monitoramento e só telas da operação. O que sair disso não é recusado: vira pedido
   * de aprovação para o administrador (regra de 18/09/2026: "sempre que ela cadastrar a
   * equipe e algo sair da regra, peça a minha permissão ou a do Mendes").
   * Mexer em administrador continua proibido.
   */
  private foraDaRegra(quem: UsuarioLogado, dto: { funcao?: string | null; permissoes?: Permissao[] }, alvo?: { id: string; funcao: string | null; papel: Papel }): string[] {
    if (quem.papel === Papel.ADMIN) return [];
    if (alvo?.papel === Papel.ADMIN) throw new ForbiddenException('Só um administrador altera administradores');
    const motivos: string[] = [];
    if (alvo && !FUNCOES_DA_OPERACAO.includes(alvo.funcao ?? '')) motivos.push('usuário fora da equipe da Operação');
    if (alvo && alvo.id === quem.userId && dto.permissoes) motivos.push('alteração das próprias permissões');
    const funcao = dto.funcao === undefined ? alvo?.funcao : dto.funcao;
    if (!funcao || !FUNCOES_DA_OPERACAO.includes(funcao)) motivos.push(`função ${funcao ? FUNCOES[funcao]?.nome ?? funcao : 'não informada'} (a regra é Help Desk ou Operador de monitoramento)`);
    const fora = (dto.permissoes ?? []).filter((p) => !PERMISSOES_DA_OPERACAO.includes(p));
    if (fora.length) motivos.push(`telas fora da Operação: ${fora.map((p) => PERMISSOES[p]).join(', ')}`);
    return motivos;
  }

  private async pedir(tipo: 'USUARIO_CRIAR' | 'USUARIO_EDITAR', quem: UsuarioLogado, alvoDescricao: string, dados: Record<string, unknown>, motivos: string[], alvoId?: string) {
    const pedido = await this.prisma.pedidoAprovacao.create({
      data: { tipo, solicitante: quem.email, alvoId, alvoDescricao, dados: dados as Prisma.InputJsonValue, motivos },
    });
    // Avisa os administradores por e-mail (sem senha, sem dados além do necessário)
    const admins = await this.prisma.adminUser.findMany({ where: { papel: Papel.ADMIN, ativo: true }, select: { email: true } });
    const url = process.env.PAINEL_URL ?? 'http://localhost:3000/painel/';
    for (const a of admins) {
      void this.email.enviar(a.email, `PR7 · Aprovação pendente: ${tipo === 'USUARIO_CRIAR' ? 'novo usuário' : 'alteração de usuário'}`,
        `${quem.nome} (${quem.email}) pediu para ${tipo === 'USUARIO_CRIAR' ? 'cadastrar' : 'alterar'} ${alvoDescricao}.\n\nFora da regra da Operação:\n- ${motivos.join('\n- ')}\n\nNada foi aplicado. Aprove ou recuse no painel: ${url} → Usuários → Pedidos fora da regra.`);
    }
    return { pendente: true as const, pedidoId: pedido.id, motivos, mensagem: `Fora da regra — enviado para aprovação do administrador: ${motivos.join('; ')}` };
  }

  async criar(dto: NovoUsuarioDto, quem: UsuarioLogado) {
    this.checarEscalada(dto.papel, quem);
    const permissoesPedidas = dto.permissoes ?? (dto.funcao ? FUNCOES[dto.funcao]?.permissoes : ['atendimentos']);
    if (await this.prisma.adminUser.findUnique({ where: { email: dto.email } })) throw new ConflictException('E-mail já cadastrado');
    const motivos = this.foraDaRegra(quem, { funcao: dto.funcao ?? null, permissoes: permissoesPedidas });
    if (motivos.length) {
      if (await this.prisma.pedidoAprovacao.findFirst({ where: { status: 'PENDENTE', tipo: 'USUARIO_CRIAR', alvoDescricao: dto.email } })) throw new ConflictException('Já existe um pedido de aprovação pendente para este e-mail');
      // Senha: só o hash fica no pedido
      return this.pedir('USUARIO_CRIAR', quem, dto.email, {
        nome: dto.nome, email: dto.email, funcao: dto.funcao ?? null, permissoes: permissoesPedidas,
        verticais: dto.verticais ?? [Vertical.PATRIMONIAL], passwordHash: await bcrypt.hash(dto.senha, 12),
      }, motivos);
    }
    const usuario = await this.prisma.adminUser.create({
      data: {
        nome: dto.nome, email: dto.email, passwordHash: await bcrypt.hash(dto.senha, 12),
        papel: dto.papel ?? Papel.OPERADOR, funcao: dto.funcao ?? null,
        permissoes: dto.permissoes ?? (dto.funcao ? FUNCOES[dto.funcao].permissoes : ['atendimentos']),
        verticais: dto.verticais ?? [Vertical.PATRIMONIAL], criadoPor: quem.email, senhaAlteradaEm: new Date(),
      },
      select: PUBLICO,
    });
    // O usuário novo recebe o acesso por e-mail; sem SMTP configurado a tela avisa
    const envio = await this.email.enviarSenha(usuario.nome, usuario.email, dto.senha);
    return { ...usuario, email_enviado: envio.enviado, email_erro: envio.enviado ? undefined : envio.motivo };
  }

  async editar(id: string, dto: EditarUsuarioDto, quem: UsuarioLogado) {
    const alvo = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!alvo) throw new NotFoundException('Usuário não encontrado');
    // Operador com permissão de usuários não mexe em admin nem promove ninguém
    this.checarEscalada(dto.papel ?? alvo.papel, quem);
    if (id === quem.userId && (dto.ativo === false || (dto.papel && dto.papel !== alvo.papel))) {
      throw new ForbiddenException('Você não pode desativar nem trocar o próprio papel');
    }
    const { senha, ...resto } = dto;
    const motivos = this.foraDaRegra(quem, { funcao: dto.funcao, permissoes: dto.permissoes }, alvo);
    if (motivos.length) {
      const { papel: _papel, ...semPapel } = resto;
      return this.pedir('USUARIO_EDITAR', quem, `${alvo.nome} <${alvo.email}>`, {
        ...semPapel, ...(senha ? { passwordHash: await bcrypt.hash(senha, 12) } : {}),
      }, motivos, alvo.id);
    }
    const usuario = await this.prisma.adminUser.update({
      where: { id },
      data: { ...resto, ...(senha ? { passwordHash: await bcrypt.hash(senha, 12), senhaAlteradaEm: new Date() } : {}) },
      select: PUBLICO,
    });
    if (!senha) return usuario;
    const envio = await this.email.enviarSenha(usuario.nome, usuario.email, senha, true);
    return { ...usuario, email_enviado: envio.enviado, email_erro: envio.enviado ? undefined : envio.motivo };
  }

  async pedidos(status?: string) {
    const lista = await this.prisma.pedidoAprovacao.findMany({ where: status ? { status } : undefined, orderBy: { criadoEm: 'desc' }, take: 200 });
    // Hash de senha nunca sai da API
    return lista.map((p) => {
      const { passwordHash, ...dados } = (p.dados ?? {}) as Record<string, unknown>;
      return { ...p, dados: { ...dados, ...(passwordHash ? { senha: 'definida por quem pediu' } : {}) } };
    });
  }

  /** Administrador decide. Aprovado: aplica o que foi pedido, conferindo de novo o que pode ter mudado. */
  async decidir(id: string, aprovar: boolean, quem: UsuarioLogado, observacao?: string) {
    const pedido = await this.prisma.pedidoAprovacao.findUnique({ where: { id } });
    if (!pedido) throw new NotFoundException('Pedido não encontrado');
    if (pedido.status !== 'PENDENTE') throw new ConflictException(`Pedido já ${pedido.status === 'APROVADO' ? 'aprovado' : 'recusado'} por ${pedido.decididoPor}`);
    const dados = pedido.dados as Record<string, any>;
    let usuario: unknown = null;
    if (aprovar) {
      if (pedido.tipo === 'USUARIO_CRIAR') {
        if (await this.prisma.adminUser.findUnique({ where: { email: dados.email } })) throw new ConflictException('E-mail já cadastrado — o pedido não pode mais ser aplicado');
        usuario = await this.prisma.adminUser.create({
          data: {
            nome: dados.nome, email: dados.email, passwordHash: dados.passwordHash, papel: Papel.OPERADOR, funcao: dados.funcao ?? null,
            permissoes: dados.permissoes, verticais: dados.verticais, criadoPor: `${pedido.solicitante} (aprovado por ${quem.email})`, senhaAlteradaEm: new Date(),
          },
          select: PUBLICO,
        });
      } else if (pedido.tipo === 'USUARIO_EDITAR') {
        const alvo = pedido.alvoId ? await this.prisma.adminUser.findUnique({ where: { id: pedido.alvoId } }) : null;
        if (!alvo) throw new NotFoundException('O usuário do pedido não existe mais');
        if (alvo.papel === Papel.ADMIN) throw new ForbiddenException('Pedido sobre administrador não pode ser aplicado');
        const { passwordHash, nome, funcao, permissoes, verticais, ativo } = dados;
        usuario = await this.prisma.adminUser.update({
          where: { id: alvo.id },
          data: { nome, funcao, permissoes, verticais, ativo, ...(passwordHash ? { passwordHash, senhaAlteradaEm: new Date() } : {}) },
          select: PUBLICO,
        });
      } else throw new BadRequestException('Tipo de pedido desconhecido');
    }
    await this.prisma.pedidoAprovacao.update({
      where: { id },
      data: { status: aprovar ? 'APROVADO' : 'RECUSADO', decididoPor: quem.email, decididoEm: new Date(), observacao: observacao?.slice(0, 500) || null },
    });
    // E-mails: quem pediu fica sabendo da decisão; usuário novo aprovado recebe o aviso de acesso
    // (a senha NÃO vai no e-mail — só existe o hash; quem cadastrou repassa pessoalmente)
    const url = process.env.PAINEL_URL ?? 'http://localhost:3000/painel/';
    void this.email.enviar(pedido.solicitante, `PR7 · Pedido ${aprovar ? 'aprovado' : 'recusado'}: ${pedido.alvoDescricao}`,
      `Seu pedido para ${pedido.tipo === 'USUARIO_CRIAR' ? 'cadastrar' : 'alterar'} ${pedido.alvoDescricao} foi ${aprovar ? 'APROVADO' : 'RECUSADO'} por ${quem.nome}.${observacao ? `\n\nObservação: ${observacao.slice(0, 500)}` : ''}`);
    if (aprovar && pedido.tipo === 'USUARIO_CRIAR') {
      void this.email.enviar(dados.email, 'Seu acesso ao painel PR7',
        `Olá, ${String(dados.nome).split(' ')[0]}.\n\nSeu acesso ao painel PR7 foi liberado.\n\nEndereço: ${url}\nE-mail: ${dados.email}\nSenha: a que foi definida no seu cadastro — peça a ${pedido.solicitante}.\n\nNão compartilhe seu acesso. O uso do painel é monitorado e restrito.`);
    }
    return { ok: true, status: aprovar ? 'APROVADO' : 'RECUSADO', pedido: { tipo: pedido.tipo, alvo: pedido.alvoDescricao, solicitante: pedido.solicitante, motivos: pedido.motivos }, usuario };
  }

  private checarEscalada(papel: Papel | undefined, quem: UsuarioLogado) {
    if (papel === Papel.ADMIN && quem.papel !== Papel.ADMIN) throw new ForbiddenException('Só um administrador cria ou edita administradores');
  }
}

@Controller()
class UsuariosController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Perfil do usuário logado: o painel monta o menu a partir daqui. */
  @Protegido()
  @Get('auth/me')
  me(@Req() req: { user: UsuarioLogado }) {
    const u = req.user;
    const permissoes = u.papel === 'ADMIN' ? (CHAVES as Permissao[]) : u.permissoes;
    return { ...u, permissoes, catalogo: PERMISSOES, funcoes: FUNCOES };
  }

  /**
   * Aviso de acesso monitorado (18/09/2026): a cada entrada, quem não é administrador
   * confirma que o acesso é monitorado e que os dados são de uso restrito, sem divulgação.
   * A confirmação fica na trilha de auditoria (prova de ciência — LGPD / sigilo).
   */
  @Protegido()
  @Post('auth/ciencia-monitoramento')
  ciencia(@Req() req: { user: UsuarioLogado; ip: string }) {
    this.auditoria.registrar('CIENCIA_MONITORAMENTO', { ip: req.ip, usuario: req.user.email, detalhe: 'confirmou: acesso monitorado, uso restrito e sem divulgação' });
    return { ok: true };
  }

  @Protegido('usuarios')
  @Get('usuarios')
  listar(@Req() req: { user: UsuarioLogado }) {
    return this.usuarios.listar(req.user);
  }

  @Protegido('usuarios')
  @Post('usuarios')
  async criar(@Body() dto: NovoUsuarioDto, @Req() req: { user: UsuarioLogado; ip: string }) {
    const r = await this.usuarios.criar(dto, req.user);
    if ('pendente' in r) {
      this.auditoria.registrar('APROVACAO', { ip: req.ip, usuario: req.user.email, detalhe: `pedido aberto: criar ${dto.email} — ${r.motivos.join('; ')}` });
      return r;
    }
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `usuário criado: ${r.email} (${r.papel}${r.funcao ? ' · ' + r.funcao : ''}) permissões=${r.permissoes.join(',')} verticais=${r.verticais.join(',')}` });
    return r;
  }

  @Protegido('usuarios')
  @Patch('usuarios/:id')
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarUsuarioDto, @Req() req: { user: UsuarioLogado; ip: string }) {
    const r = await this.usuarios.editar(id, dto, req.user);
    if ('pendente' in r) {
      this.auditoria.registrar('APROVACAO', { ip: req.ip, usuario: req.user.email, detalhe: `pedido aberto: alterar ${id} — ${r.motivos.join('; ')}` });
      return r;
    }
    const campos = Object.keys(dto).map((k) => (k === 'senha' ? 'senha (redefinida)' : k)).join(', ');
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `usuário ${r.email}: ${campos}` });
    return r;
  }

  /** Pedidos fora da regra: quem pediu vê só os próprios; o administrador vê todos. */
  @Protegido('usuarios')
  @Get('usuarios/aprovacoes')
  async aprovacoes(@Req() req: { user: UsuarioLogado }, @Query('status') status?: string) {
    const lista = await this.usuarios.pedidos(status && ['PENDENTE', 'APROVADO', 'RECUSADO'].includes(status) ? status : undefined);
    return req.user.papel === Papel.ADMIN ? lista : lista.filter((p) => p.solicitante === req.user.email);
  }

  @SomenteAdmin()
  @HttpCode(200)
  @Post('usuarios/aprovacoes/:id/:decisao')
  async decidir(@Param('id', ParseUUIDPipe) id: string, @Param('decisao') decisao: string, @Body() body: { observacao?: string }, @Req() req: { user: UsuarioLogado; ip: string }) {
    if (decisao !== 'aprovar' && decisao !== 'recusar') throw new BadRequestException('Use aprovar ou recusar');
    const r = await this.usuarios.decidir(id, decisao === 'aprovar', req.user, typeof body?.observacao === 'string' ? body.observacao : undefined);
    this.auditoria.registrar('APROVACAO', { ip: req.ip, usuario: req.user.email, detalhe: `pedido ${r.status.toLowerCase()}: ${r.pedido.tipo === 'USUARIO_CRIAR' ? 'criar' : 'alterar'} ${r.pedido.alvo} (pedido por ${r.pedido.solicitante}) — ${r.pedido.motivos.join('; ')}` });
    return r;
  }
}

@Module({ controllers: [UsuariosController], providers: [UsuariosService] })
export class UsuariosModule {}
