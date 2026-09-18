import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LimiteDeTentativas } from '../seguranca/seguranca';
import { AuditoriaService } from '../seguranca/seguranca.module';

// Hash qualquer para comparar quando o e-mail não existe: assim a resposta
// demora o mesmo tempo e não revela quais e-mails estão cadastrados.
const HASH_FALSO = bcrypt.hashSync('senha-que-nao-existe', 10);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly limite = new LimiteDeTentativas();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async login(email: string, password: string, ip: string) {
    const minutos = this.limite.bloqueio(ip, email);
    if (minutos > 0) {
      this.auditoria.registrar('LOGIN_BLOQUEADO', { ip, usuario: email, detalhe: `bloqueado por ${minutos} min` });
      throw new HttpException(`Muitas tentativas. Tente novamente em ${minutos} min.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    const valid = await bcrypt.compare(password, user?.passwordHash ?? HASH_FALSO);
    if (user && valid && !user.ativo) {
      this.auditoria.registrar('LOGIN_FALHA', { ip, usuario: email, detalhe: 'usuário desativado' });
      throw new UnauthorizedException('Usuário desativado. Fale com o administrador.');
    }
    if (!user || !valid) {
      this.limite.registrarFalha(ip, email);
      this.logger.warn(`Login recusado para ${email} (IP ${ip})`);
      this.auditoria.registrar('LOGIN_FALHA', { ip, usuario: email, detalhe: user ? 'senha incorreta' : 'e-mail não cadastrado' });
      throw new UnauthorizedException('Credenciais inválidas');
    }

    this.limite.limpar(ip, email);
    this.auditoria.registrar('LOGIN_OK', { ip, usuario: email });
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { ultimoAcesso: new Date() } });
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken };
  }
}
