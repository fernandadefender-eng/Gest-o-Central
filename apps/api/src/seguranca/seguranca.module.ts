import { Controller, Get, Global, Injectable, Logger, Module, Query } from '@nestjs/common';
import { SomenteAdmin } from '../auth/permissoes';
import { PrismaService } from '../prisma/prisma.service';

export type TipoEvento =
  | 'LOGIN_OK' | 'LOGIN_FALHA' | 'LOGIN_BLOQUEADO'
  | 'WEBHOOK_RECUSADO' | 'LIMITE_EXCEDIDO' | 'CADASTRO_ALTERADO'
  // Saída de dados (planilha, PDF, backup) e ações da aba Segurança
  | 'EXPORTACAO' | 'SEGURANCA' | 'SESSAO_RECUSADA'
  // Usuário da equipe confirmou o aviso "acesso monitorado, uso restrito" ao entrar
  | 'CIENCIA_MONITORAMENTO'
  // Pedido fora da regra (cadastro da equipe) aberto, aprovado ou recusado pelo administrador
  | 'APROVACAO';

/** Grava a trilha de auditoria (tabela EventoSeguranca). Nunca derruba a requisição se falhar. */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger('Auditoria');

  constructor(private readonly prisma: PrismaService) {}

  registrar(tipo: TipoEvento, dados: { ip?: string; usuario?: string; detalhe?: string } = {}) {
    this.prisma.eventoSeguranca
      .create({ data: { tipo, ip: dados.ip, usuario: dados.usuario, detalhe: dados.detalhe?.slice(0, 500) } })
      .catch((err) => this.logger.error(`Falha ao gravar evento ${tipo}: ${err.message}`));
  }

  ultimos(tipo?: string) {
    return this.prisma.eventoSeguranca.findMany({
      where: tipo ? { tipo } : undefined,
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
  }
}

// Trilha de auditoria: só o administrador (quem cuida da equipe da Operação não vê)
@SomenteAdmin()
@Controller('seguranca')
class SegurancaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get('eventos')
  eventos(@Query('tipo') tipo?: string) {
    return this.auditoria.ultimos(tipo);
  }
}

@Global()
@Module({
  controllers: [SegurancaController],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class SegurancaModule {}
