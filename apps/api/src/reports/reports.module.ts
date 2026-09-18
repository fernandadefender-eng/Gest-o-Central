import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AtendimentosModule } from '../atendimentos/atendimentos.module';

@Module({
  imports: [AtendimentosModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
