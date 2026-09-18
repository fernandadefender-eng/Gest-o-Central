import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Vertical } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Permissões liberáveis por usuário. O operador só vê o que estiver marcado;
 * o ADMIN tem todas. A checagem é no servidor — esconder no painel não basta.
 */
export const PERMISSOES = {
  visao_geral: 'Visão geral (BI e mapa)',
  mapa: 'Mapa operacional (sem a visão geral)',
  painel_mes: 'Painel do mês: total de ocorrências e os meus',
  monitoramento: 'Monitoramento: tratar eventos veiculares',
  sac: 'SAC: atender prestadores',
  atendimentos: 'Ver atendimentos',
  atendimentos_criar: 'Registrar ocorrências',
  prestadores: 'Ver prestadores e contatos',
  prestadores_editar: 'Editar prestadores e organograma',
  valores: 'Ver valores financeiros',
  pagamentos: 'Pagamentos: comprovantes e fechamento',
  equipe: 'Ver desempenho do Help Desk',
  relatorios: 'Baixar relatórios',
  custos_ia: 'Ver custo da IA',
  usuarios: 'Gerenciar usuários',
  // Só a parte NR-1 da aba Segurança (checklist NR-1, riscos, indicadores, acidentes/eSocial).
  // Proteção de dados, acessos, LGPD e auditoria continuam só do administrador.
  nr1: 'NR-1 / SST: riscos, indicadores, acidentes e eSocial',
  treinamento: 'Treinamento (Academia PR7)',
} as const;
export type Permissao = keyof typeof PERMISSOES;

/**
 * Função do usuário na operação. Serve para marcar as permissões iniciais ao
 * cadastrar — o administrador pode ajustar caixa a caixa depois. O que vale no
 * servidor são sempre as permissões gravadas, nunca a função.
 */
export const FUNCOES: Record<string, { nome: string; permissoes: Permissao[] }> = {
  HELP_DESK: {
    nome: 'Help Desk',
    // Sem visão geral: vê o mapa operacional e o total do mês (geral e os seus)
    // "Todos da equipe têm ciência dos valores e datas de pagamento" (18/09/2026)
    permissoes: ['mapa', 'painel_mes', 'atendimentos', 'atendimentos_criar', 'monitoramento', 'valores', 'pagamentos', 'treinamento'],
  },
  OPERADOR_MONITORAMENTO: {
    nome: 'Operador de monitoramento',
    permissoes: ['mapa', 'painel_mes', 'monitoramento', 'atendimentos', 'valores', 'pagamentos', 'treinamento'],
  },
  AUXILIAR_ADM: {
    nome: 'Auxiliar Adm.',
    permissoes: ['painel_mes', 'atendimentos', 'prestadores', 'valores', 'pagamentos', 'relatorios', 'treinamento'],
  },
  ANALISTA: {
    nome: 'Analista',
    permissoes: ['visao_geral', 'mapa', 'painel_mes', 'atendimentos', 'prestadores', 'equipe', 'relatorios', 'treinamento'],
  },
  SUPERVISAO: {
    nome: 'Supervisão',
    permissoes: ['visao_geral', 'mapa', 'painel_mes', 'monitoramento', 'sac', 'atendimentos', 'atendimentos_criar', 'prestadores', 'prestadores_editar', 'valores', 'pagamentos', 'equipe', 'relatorios', 'treinamento'],
  },
  // Técnico responsável pela NR-1 (GRO/PGR) e pelos eventos de SST no eSocial (18/09/2026)
  TECNICO_SST: {
    nome: 'Técnico de Segurança do Trabalho (NR-1)',
    permissoes: ['nr1'],
  },
};
export type Funcao = keyof typeof FUNCOES;

/**
 * Setor da Operação: quem NÃO é administrador e tem "Gerenciar usuários" só cuida
 * destas funções e só pode dar estas telas (regra da operação, 18/09/2026:
 * "somente para a equipe da Operação e dentro do setor deles, nos demais não").
 */
export const FUNCOES_DA_OPERACAO = ['HELP_DESK', 'OPERADOR_MONITORAMENTO'];
// Valores e datas de pagamento: a equipe toda conhece (18/09/2026). Auditoria, usuários,
// custo da IA, relatórios e edição de cadastro: só o administrador libera.
export const PERMISSOES_DA_OPERACAO: Permissao[] = ['mapa', 'painel_mes', 'atendimentos', 'atendimentos_criar', 'monitoramento', 'sac', 'prestadores', 'valores', 'pagamentos', 'treinamento'];

export interface UsuarioLogado {
  userId: string;
  email: string;
  nome: string;
  papel: 'ADMIN' | 'OPERADOR';
  funcao?: string | null;
  permissoes: Permissao[];
  verticais: Vertical[];
}

export function temPermissao(u: UsuarioLogado | undefined, p: Permissao) {
  return !!u && (u.papel === 'ADMIN' || u.permissoes.includes(p));
}

const CHAVE = 'permissoes';

@Injectable()
export class PermissaoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const exigidas = this.reflector.getAllAndOverride<Permissao[]>(CHAVE, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const user = ctx.switchToHttp().getRequest().user as UsuarioLogado | undefined;
    // Basta ter UMA das permissões listadas
    if (exigidas.length === 0 || exigidas.some((p) => temPermissao(user, p))) return true;
    throw new ForbiddenException('Seu usuário não tem acesso a esta área');
  }
}

/**
 * Área exclusiva do ADMINISTRADOR (aba Segurança): não é permissão que se libera a
 * um operador — só o papel ADMIN entra, conferido no servidor.
 */
@Injectable()
export class SomenteAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const user = ctx.switchToHttp().getRequest().user as UsuarioLogado | undefined;
    if (user?.papel === 'ADMIN') return true;
    throw new ForbiddenException('Área exclusiva do administrador');
  }
}
export const SomenteAdmin = () => applyDecorators(UseGuards(JwtAuthGuard, SomenteAdminGuard));

/** Exige login e (opcionalmente) uma das permissões informadas. */
export const Protegido = (...permissoes: Permissao[]) =>
  applyDecorators(SetMetadata(CHAVE, permissoes), UseGuards(JwtAuthGuard, PermissaoGuard));

/** Filtro SQL/Prisma de vertical conforme o que foi liberado ao usuário. */
export function verticaisPermitidas(u: UsuarioLogado, pedida?: Vertical): Vertical[] {
  const liberadas = u.papel === 'ADMIN' ? [Vertical.PATRIMONIAL, Vertical.VEICULAR] : u.verticais;
  return pedida ? liberadas.filter((v) => v === pedida) : liberadas;
}
