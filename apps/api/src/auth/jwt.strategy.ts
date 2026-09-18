import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { segredoObrigatorio } from '../seguranca/seguranca';
import { Permissao, UsuarioLogado } from './permissoes';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: segredoObrigatorio('JWT_SECRET', 32),
    });
  }

  /**
   * Relê o usuário a cada requisição: desativar alguém ou mudar permissões vale
   * na hora, sem esperar o token expirar. Token emitido antes de uma troca de
   * senha também deixa de valer.
   */
  // Lido do banco no máximo a cada 15 s (vale para todas as requisições)
  private corte: { valor: number | null; lidoEm: number } = { valor: null, lidoEm: 0 };
  private async corteDeSessoes(): Promise<number | null> {
    if (Date.now() - this.corte.lidoEm > 15_000) {
      const c = await this.prisma.configSistema.findUnique({ where: { chave: 'sessoesValidasDesde' } });
      this.corte = { valor: c ? Date.parse(c.valor) : null, lidoEm: Date.now() };
    }
    return this.corte.valor;
  }
  /** A aba Segurança zera o cache ao encerrar as sessões (vale na hora). */
  esquecerCorte() { this.corte.lidoEm = 0; }

  async validate(payload: { sub: string; iat?: number }): Promise<UsuarioLogado> {
    const u = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!u || !u.ativo) throw new UnauthorizedException('Usuário inativo');
    // "Encerrar todas as sessões" (aba Segurança): token emitido antes do corte não vale
    const corte = await this.corteDeSessoes();
    if (corte && payload.iat && payload.iat * 1000 < corte) throw new UnauthorizedException('Sessão encerrada pela segurança — entre novamente');
    if (u.senhaAlteradaEm && payload.iat && payload.iat * 1000 < u.senhaAlteradaEm.getTime() - 1000) {
      throw new UnauthorizedException('Senha alterada — entre novamente');
    }
    return {
      userId: u.id, email: u.email, nome: u.nome, papel: u.papel, funcao: u.funcao,
      permissoes: u.permissoes as Permissao[], verticais: u.verticais,
    };
  }
}
