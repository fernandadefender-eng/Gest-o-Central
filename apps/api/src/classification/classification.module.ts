import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClassificationService } from './classification.service';
import { AtendimentoProcessor } from './atendimento.processor';
import { CLASSIFICATION_QUEUE } from './classification.constants';
import { CostsModule } from '../costs/costs.module';
import { MidiasModule } from '../midias/midias.module';
import { SacModule } from '../sac/sac.module';

@Module({
  imports: [BullModule.registerQueue({ name: CLASSIFICATION_QUEUE }), CostsModule, MidiasModule, SacModule],
  providers: [ClassificationService, AtendimentoProcessor],
})
export class ClassificationModule {}
