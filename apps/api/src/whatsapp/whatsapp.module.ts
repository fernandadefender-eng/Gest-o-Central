import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { CLASSIFICATION_QUEUE } from '../classification/classification.constants';
import { MidiasModule } from '../midias/midias.module';

@Module({
  imports: [BullModule.registerQueue({ name: CLASSIFICATION_QUEUE }), MidiasModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
