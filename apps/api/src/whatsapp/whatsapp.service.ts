import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ehGrupoFinanceiro } from '../sac/sac';
import { ZApiWebhookDto } from './dto/zapi-webhook.dto';
import { CLASSIFICATION_QUEUE, CLASSIFY_CONVERSATION_JOB } from '../classification/classification.constants';
import { MidiasService } from '../midias/midias.module';

@Injectable()
export class WhatsappService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CLASSIFICATION_QUEUE) private readonly classificationQueue: Queue,
    private readonly midias: MidiasService,
  ) {}

  /**
   * Converte qualquer tipo de mensagem em texto legível para o histórico e a IA.
   * Mídia não é baixada: guarda-se a legenda e uma marca do tipo (as fotos do
   * relatório em PDF virão de um fluxo próprio, com armazenamento).
   */
  private conteudo(p: ZApiWebhookDto): string | null {
    if (p.text?.message) return p.text.message;
    if (p.image) return `[Foto]${p.image.caption ? ' ' + p.image.caption : ''}`;
    if (p.video) return `[Vídeo]${p.video.caption ? ' ' + p.video.caption : ''}`;
    if (p.document) return `[Documento ${p.document.fileName ?? p.document.title ?? ''}]${p.document.caption ? ' ' + p.document.caption : ''}`;
    if (p.audio) return `[Áudio${p.audio.seconds ? ` ${p.audio.seconds}s` : ''} — não transcrito]`;
    if (p.location) {
      const { latitude, longitude, address, name } = p.location;
      return `[Localização] ${[name, address].filter(Boolean).join(' - ')} (${latitude}, ${longitude})`;
    }
    if (p.contact) return `[Contato compartilhado] ${p.contact.displayName ?? ''}`;
    return null; // figurinha, reação, evento de sistema
  }

  async handleIncoming(payload: ZApiWebhookDto) {
    // Apagada no WhatsApp: a mensagem continua no nosso registro, só fica marcada
    // (o banco ainda tem trigger que impede apagar). Vem antes do filtro de eventos.
    if (payload.isDeleted || /revok|delet|apag/i.test(payload.notification ?? '')) {
      const alvo = payload.referenceMessageId ?? payload.messageId;
      if (alvo) {
        const r = await this.prisma.message.updateMany({ where: { externalId: alvo, apagadaNoWhatsappEm: null }, data: { apagadaNoWhatsappEm: new Date(payload.momment || Date.now()) } });
        this.logger.warn(`Mensagem apagada no WhatsApp — mantida no registro e marcada (${r.count ? 'encontrada' : 'não estava no registro'})`);
      }
      return { mantida: true };
    }
    // Editada no WhatsApp: guarda a versão nova sem trocar o texto original
    if (payload.isEdit) {
      const alvo = payload.editMessageId ?? payload.referenceMessageId ?? payload.messageId;
      const original = alvo ? await this.prisma.message.findUnique({ where: { externalId: alvo } }) : null;
      const novo = this.conteudo(payload);
      if (original && novo && novo !== original.content) {
        const edicoes = Array.isArray(original.edicoes) ? (original.edicoes as { em: string; conteudo: string }[]) : [];
        await this.prisma.message.update({ where: { id: original.id }, data: { edicoes: [...edicoes, { em: new Date(payload.momment || Date.now()).toISOString(), conteudo: novo }] } });
        this.logger.log('Mensagem editada no WhatsApp — original mantido, edição guardada');
        return { editada: true };
      }
    }
    // Status, canais, listas de transmissão e eventos de sistema não são operação
    const telefone = payload.phone ?? '';
    if (payload.isStatusReply || payload.isNewsletter || payload.broadcast || payload.notification || /status@broadcast|@newsletter/.test(telefone)) {
      return { ignored: true };
    }
    const conteudo = this.conteudo(payload);
    if (!conteudo) {
      this.logger.debug('Webhook sem conteúdo útil (figurinha/reação) ignorado');
      return { ignored: true };
    }

    const isGroup = Boolean(payload.isGroup) || telefone.endsWith('-group');
    // Só metadados no log (nunca o conteúdo): serve para acompanhar a chegada real
    this.logger.log(`WhatsApp recebido: ${isGroup ? 'grupo' : 'individual'} · ${payload.fromMe ? 'enviada pelo PR7' : 'recebida'} · ${conteudo.startsWith('[') ? conteudo.slice(1, conteudo.indexOf(']')) : 'texto'}`);
    // Em grupo, `phone` é o id do grupo (não um telefone), então preserva-se
    // como veio; em 1-a-1 normaliza-se para só dígitos.
    const externalId = isGroup ? payload.phone : payload.phone.replace(/\D/g, '');

    // Num grupo, o cliente não é quem mandou a mensagem — é o dono do grupo.
    // Enquanto não existir a tela para vincular grupo ↔ Conta (Fase 3), cria-se
    // um Client provisório identificado pelo próprio grupo, para o atendimento
    // não ficar órfão. O operador corrige o vínculo depois.
    const client = await this.prisma.client.upsert({
      where: { phone: externalId },
      create: { phone: externalId, name: payload.chatName ?? externalId },
      update: payload.chatName ? { name: payload.chatName } : {},
    });

    const conversation = await this.prisma.conversation.upsert({
      where: { externalId },
      create: {
        externalId,
        clientId: client.id,
        isGroup,
        groupName: isGroup ? payload.chatName : null,
      },
      update: {
        status: 'ABERTA',
        ...(isGroup && payload.chatName ? { groupName: payload.chatName } : {}),
      },
    });

    if (payload.messageId) {
      const existing = await this.prisma.message.findUnique({
        where: { externalId: payload.messageId },
      });
      if (existing) {
        return { duplicated: true };
      }
    }

    const mensagem = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: payload.fromMe ? MessageDirection.SAINTE : MessageDirection.ENTRANTE,
        content: conteudo,
        senderPhone: payload.participantPhone?.replace(/\D/g, '') ?? null,
        senderName: payload.senderName ?? null,
        externalId: payload.messageId,
        sentAt: new Date(payload.momment),
      },
    });

    // Foto/vídeo/áudio/documento: guarda o arquivo (o link da Z-API expira)
    const midia = payload.image?.imageUrl ? { tipo: 'FOTO' as const, url: payload.image.imageUrl, mimeType: payload.image.mimeType, legenda: payload.image.caption }
      : payload.video?.videoUrl ? { tipo: 'VIDEO' as const, url: payload.video.videoUrl, mimeType: payload.video.mimeType, legenda: payload.video.caption }
      : payload.audio?.audioUrl ? { tipo: 'AUDIO' as const, url: payload.audio.audioUrl, mimeType: payload.audio.mimeType }
      : payload.document?.documentUrl ? { tipo: 'DOCUMENTO' as const, url: payload.document.documentUrl, mimeType: payload.document.mimeType, legenda: payload.document.caption, nomeOriginal: payload.document.fileName ?? payload.document.title }
      : null;
    if (midia) {
      await this.midias.registrar(midia, mensagem.id, conversation.id).catch((err) => this.logger.error(`Mídia não registrada: ${err.message}`));
    }

    // A operação acontece em grupos. Conversas individuais ficam gravadas, mas só
    // vão para a IA se liberado no .env — economiza e não envia conversa pessoal.
    const classificarIndividuais = process.env.CLASSIFICAR_CONVERSAS_INDIVIDUAIS === 'true';
    // Grupo interno (ex: Suporte): só formulário de retorno interessa (correções encaminhadas);
    // a classificação lê o formulário sem chamar a IA. Mensagem comum de grupo interno é só registrada.
    const formularioNoInterno = isGroup && conversation.tipoGrupo === 'INTERNO' && /\b(id|conta|remota)s?\s*:/i.test(conteudo);
    // Grupo de comprovantes/pagamentos: toda mensagem importa. O comprovante chega como
    // "Nome/ Cidade/ IDs 36575" — sem dois-pontos — e é ele que quita o atendimento.
    const grupoFinanceiro = isGroup && ehGrupoFinanceiro(conversation.groupName);
    if ((isGroup && conversation.tipoGrupo !== 'INTERNO') || formularioNoInterno || grupoFinanceiro || (!isGroup && classificarIndividuais)) {
      await this.scheduleClassification(conversation.id, conversation.lastClassifiedAt);
    }

    return { ok: true };
  }

  /**
   * A mensagem em si já está gravada e visível neste ponto — o agendamento
   * abaixo é só do enriquecimento por IA (categoria/resumo/status).
   *
   * Primeira classificação roda rápido, para o atendimento aparecer no painel
   * quase imediatamente. As atualizações seguintes são agrupadas numa janela
   * maior, porque numa vistoria longa o técnico manda muitas mensagens e
   * classificar cada rajada multiplicaria o custo sem mudar muito o resultado.
   */
  private async scheduleClassification(conversationId: string, lastClassifiedAt: Date | null) {
    const firstDelay = Number(process.env.CLASSIFY_FIRST_DELAY_SECONDS ?? '20') * 1000;
    const updateDelay = Number(process.env.CLASSIFY_UPDATE_DELAY_SECONDS ?? '300') * 1000;
    const maxWait = Number(process.env.CLASSIFY_MAX_WAIT_SECONDS ?? '1800') * 1000;

    let delay = lastClassifiedAt ? updateDelay : firstDelay;

    // Trava: numa conversa com mensagens contínuas o debounce reiniciaria
    // indefinidamente. Passado o tempo máximo sem classificar, roda logo.
    if (lastClassifiedAt && Date.now() - lastClassifiedAt.getTime() > maxWait) {
      delay = 5_000;
    }

    // Remove o job pendente para reiniciar a contagem (debounce de verdade):
    // sem isso, uma rajada de mensagens dispararia uma classificação por rajada.
    // Job que FALHOU também sai: com o mesmo jobId ele bloqueava para sempre qualquer
    // novo agendamento da conversa (ORSEGUPS/SEGURPRO ficaram parados por uma queda de
    // internet de minutos). Job em andamento fica: a varredura pega o que chegar depois.
    const pending = await this.classificationQueue.getJob(conversationId);
    if (pending) {
      const state = await pending.getState();
      if (state === 'active') return;
      if (['delayed', 'waiting', 'failed', 'completed'].includes(state)) {
        await pending.remove().catch(() => undefined);
      }
    }

    await this.classificationQueue.add(
      CLASSIFY_CONVERSATION_JOB,
      { conversationId },
      {
        jobId: conversationId, delay, removeOnComplete: true, removeOnFail: 50,
        // Falha passageira (internet, banco reiniciando, IA fora): tenta de novo sozinho
        attempts: 5, backoff: { type: 'exponential', delay: 30_000 },
      },
    );
  }

  /**
   * Varredura de segurança (a cada 2 min): nenhuma conversa pode ficar com mensagem
   * parada. Se passou do prazo normal e não há job agendado/rodando, agenda agora.
   * Custo de IA igual — só garante que o que já deveria ter rodado rode.
   */
  async varrerPendentes(): Promise<number> {
    const updateDelay = Number(process.env.CLASSIFY_UPDATE_DELAY_SECONDS ?? '300') * 1000;
    const firstDelay = Number(process.env.CLASSIFY_FIRST_DELAY_SECONDS ?? '20') * 1000;
    const classificarIndividuais = process.env.CLASSIFICAR_CONVERSAS_INDIVIDUAIS === 'true';
    const atrasadas = await this.prisma.$queryRaw<{ id: string; lastClassifiedAt: Date | null; tipoGrupo: string | null; groupName: string | null; temFormulario: boolean }[]>`
      SELECT c.id, c."lastClassifiedAt", c."tipoGrupo"::text "tipoGrupo", c."groupName",
             EXISTS (SELECT 1 FROM "Message" f WHERE f."conversationId" = c.id AND f."sentAt" > coalesce(c."lastClassifiedAt", '1970-01-01')
                     AND f.content ~* '(id|conta|remota)s?[[:space:]*]*:') "temFormulario"
        FROM "Conversation" c
        JOIN LATERAL (SELECT max(m."sentAt") ultima FROM "Message" m WHERE m."conversationId" = c.id) u ON true
       WHERE u.ultima > coalesce(c."lastClassifiedAt", '1970-01-01')
         AND (c."isGroup" OR ${classificarIndividuais})
         AND u.ultima < now() - (CASE WHEN c."lastClassifiedAt" IS NULL THEN ${firstDelay + 60_000} ELSE ${updateDelay + 60_000} END) * interval '1 millisecond'`;
    let agendadas = 0;
    for (const c of atrasadas) {
      // Mesma regra do webhook: grupo interno só com formulário; grupo de pagamento sempre
      if (c.tipoGrupo === 'INTERNO' && !c.temFormulario && !ehGrupoFinanceiro(c.groupName)) continue;
      const job = await this.classificationQueue.getJob(c.id);
      const estado = job ? await job.getState() : null;
      if (estado === 'active' || estado === 'waiting' || estado === 'delayed') continue;
      await this.scheduleClassification(c.id, c.lastClassifiedAt);
      agendadas++;
    }
    if (agendadas) this.logger.warn(`Varredura: ${agendadas} conversa(s) com mensagem parada reagendada(s)`);
    return agendadas;
  }

  onApplicationBootstrap() {
    if (process.env.VARREDURA_FILA === 'off') return;
    // Primeira passada 90 s depois de subir (pega o que ficou parado durante o reinício)
    setTimeout(() => this.varrerPendentes().catch((e) => this.logger.error(`Varredura: ${e.message}`)), 90_000);
    this.varredura = setInterval(() => this.varrerPendentes().catch((e) => this.logger.error(`Varredura: ${e.message}`)), 120_000);
  }

  onApplicationShutdown() {
    if (this.varredura) clearInterval(this.varredura);
  }
  private varredura?: NodeJS.Timeout;
}
