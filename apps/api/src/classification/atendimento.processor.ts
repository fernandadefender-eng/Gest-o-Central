import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ClassificationService } from './classification.service';
import { CLASSIFICATION_QUEUE } from './classification.constants';

@Processor(CLASSIFICATION_QUEUE)
export class AtendimentoProcessor extends WorkerHost {
  private readonly logger = new Logger(AtendimentoProcessor.name);

  constructor(private readonly classificationService: ClassificationService) {
    super();
  }

  async process(job: Job<{ conversationId: string }>) {
    this.logger.log(`Classificando conversa ${job.data.conversationId}`);
    await this.classificationService.classifyConversation(job.data.conversationId);
  }
}
