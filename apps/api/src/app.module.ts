import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { QueueConfigModule } from './queue/queue-config.module';
import { AuthModule } from './auth/auth.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { ClassificationModule } from './classification/classification.module';
import { AtendimentosModule } from './atendimentos/atendimentos.module';
import { ReportsModule } from './reports/reports.module';
import { CostsModule } from './costs/costs.module';
import { MapaModule } from './mapa/mapa.module';
import { GeoModule } from './geo/geo.module';
import { BiModule } from './bi/bi.module';
import { SegurancaModule } from './seguranca/seguranca.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { EquipeModule } from './equipe/equipe.module';
import { MonitoramentoModule } from './monitoramento/monitoramento.module';
import { SacModule } from './sac/sac.module';
import { EmailModule } from './email/email.module';
import { PagamentosModule } from './pagamentos/pagamentos.module';
import { MidiasModule } from './midias/midias.module';
import { PainelModule } from './painel/painel.module';
import { BackupModule } from './backup/backup.module';
import { PainelSegurancaModule } from './seguranca/painel-seguranca.module';
import { ComunicadosModule } from './sst/comunicados.module';
import { TreinamentoModule } from './treinamento/treinamento.module';
import { RoteirizadorAbaModule } from './roteirizador/roteirizador-aba.module';
import { FechamentosModule } from './fechamentos/fechamentos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SegurancaModule,
    QueueConfigModule,
    AuthModule,
    WhatsappModule,
    ClassificationModule,
    AtendimentosModule,
    ReportsModule,
    CostsModule,
    MapaModule,
    GeoModule,
    BiModule,
    UsuariosModule,
    EquipeModule,
    MonitoramentoModule,
    SacModule,
    EmailModule,
    PagamentosModule,
    MidiasModule,
    PainelModule,
    BackupModule,
    PainelSegurancaModule,
    ComunicadosModule,
    TreinamentoModule,
    RoteirizadorAbaModule,
    FechamentosModule,
  ],
})
export class AppModule {}
