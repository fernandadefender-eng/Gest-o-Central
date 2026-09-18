import { BadRequestException, Body, Controller, Get, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Req, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';

// storage/midias na raiz do projeto (fora do código, no .gitignore)
export const PASTA_MIDIAS = resolve(__dirname, '..', '..', '..', '..', '..', 'storage', 'midias');
const LIMITE_BYTES = 50 * 1024 * 1024;
const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'application/pdf': 'pdf',
};
const TIPO_POR_PREFIXO: [RegExp, string][] = [[/^image\//, 'FOTO'], [/^video\//, 'VIDEO'], [/^audio\//, 'AUDIO']];

export interface MidiaRecebida {
  tipo: 'FOTO' | 'VIDEO' | 'AUDIO' | 'DOCUMENTO';
  url: string;
  mimeType?: string;
  legenda?: string;
  nomeOriginal?: string;
}

/**
 * Janela de horário em que uma foto pode ser deste chamado: de 15 min antes do pedido
 * até 30 min depois do encerramento. Sem encerramento, o chamado NÃO fica aberto para
 * sempre — vai até 4 h depois da chegada ou, no máximo, 12 h depois do pedido. Antes a
 * ronda do dia 15 que ficou "em andamento" recebia as fotos dos dias 16 e 17.
 */
export function janelaDoChamado(a: { solicitadoEm: Date | null; createdAt: Date; chegadaEm?: Date | null; concluidoEm: Date | null; encerradoEm: Date | null }) {
  const pedido = +(a.solicitadoEm ?? a.createdAt);
  const fimReal = a.encerradoEm ?? a.concluidoEm;
  const fim = fimReal ? +fimReal : a.chegadaEm ? Math.min(+a.chegadaEm + 4 * 3600e3, pedido + 24 * 3600e3) : pedido + 12 * 3600e3;
  return { inicio: pedido - 15 * 60000, fim: fim + 30 * 60000 };
}

@Injectable()
export class MidiasService {
  private readonly logger = new Logger('Midias');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra a mídia e baixa em segundo plano (o link da Z-API expira).
   * Liga ao chamado aberto da conversa só quando há UM aberto: em grupo com várias
   * ocorrências ao mesmo tempo (ORSEGUPS, SEGURPRO) a foto fica solta e a regra da
   * janela/nº da ocorrência decide — ou o Help Desk liga pela ficha.
   */
  async registrar(m: MidiaRecebida, messageId: string, conversationId: string) {
    const abertos = await this.prisma.atendimento.findMany({
      where: { conversationId, status: { in: ['NOVO', 'EM_ANDAMENTO'] } },
      select: { id: true },
      take: 2,
    });
    const aberto = abertos.length === 1 ? abertos[0] : null;
    const midia = await this.prisma.midia.create({
      data: {
        tipo: m.tipo, mimeType: m.mimeType, legenda: m.legenda, nomeOriginal: m.nomeOriginal, urlOrigem: m.url,
        messageId, conversationId, atendimentoId: aberto?.id, noRelatorio: m.tipo === 'FOTO',
      },
    });
    this.baixar(midia.id).catch((err) => this.logger.error(`Download da mídia ${midia.id}: ${err.message}`));
    return midia;
  }

  async baixar(id: string, tentativa = 1): Promise<void> {
    const midia = await this.prisma.midia.findUnique({ where: { id } });
    if (!midia?.urlOrigem || midia.status === 'SALVA') return;
    try {
      // Só http(s): nunca caminhos locais ou outros protocolos vindos do webhook
      if (!/^https?:\/\//i.test(midia.urlOrigem)) throw new Error('URL inválida');
      const res = await fetch(midia.urlOrigem, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const declarado = Number(res.headers.get('content-length') ?? 0);
      if (declarado > LIMITE_BYTES) throw new Error(`arquivo acima de 50 MB (${declarado} bytes)`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > LIMITE_BYTES) throw new Error('arquivo acima de 50 MB');
      const mime = (midia.mimeType || res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = EXTENSOES[mime];
      if (!ext) throw new Error(`tipo de arquivo não aceito: ${mime || 'desconhecido'}`);
      const agora = new Date();
      const relativo = join(String(agora.getFullYear()), String(agora.getMonth() + 1).padStart(2, '0'), `${id}.${ext}`);
      await mkdir(join(PASTA_MIDIAS, String(agora.getFullYear()), String(agora.getMonth() + 1).padStart(2, '0')), { recursive: true });
      await writeFile(join(PASTA_MIDIAS, relativo), buf);
      const tipo = TIPO_POR_PREFIXO.find(([re]) => re.test(mime))?.[1] ?? 'DOCUMENTO';
      await this.prisma.midia.update({
        where: { id },
        data: { arquivo: relativo.replace(/\\/g, '/'), tamanhoBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), mimeType: mime, tipo, status: 'SALVA', erro: null },
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (tentativa < 3 && !/não aceito|acima de 50|inválida/.test(msg)) {
        await new Promise((r) => setTimeout(r, 5000 * tentativa));
        return this.baixar(id, tentativa + 1);
      }
      await this.prisma.midia.update({ where: { id }, data: { status: 'FALHOU', erro: msg.slice(0, 300) } });
      this.logger.warn(`Mídia ${id} não salva: ${msg}`);
    }
  }

  /** Liga mídias ainda soltas da conversa ao chamado (chamado nasceu depois das fotos). */
  async vincularSoltas(conversationId: string, atendimentoId: string, desde: Date, remetente?: string | null, ate?: Date) {
    // Sem remetente pegaria as fotos de todo o grupo (outras ocorrências): usa a janela
    if (!remetente) return this.vincularPelaJanela(conversationId);
    // O Help Desk inteiro posta do mesmo número da PR7, então o remetente sozinho não
    // separa ocorrências: a janela é curta e fechada (fotos mandadas junto do retorno)
    const r = await this.prisma.midia.updateMany({
      where: {
        conversationId, atendimentoId: null, recebidaEm: { gte: desde, ...(ate ? { lte: ate } : {}) },
        ...(remetente ? { message: { senderName: remetente } } : {}),
      },
      data: { atendimentoId },
    });
    return r.count;
  }

  /** Arquivo da mídia em base64, para a leitura da print (null se não estiver salva). */
  async arquivoBase64(midiaId: string) {
    const m = await this.prisma.midia.findUnique({ where: { id: midiaId }, select: { arquivo: true, status: true, mimeType: true } });
    if (!m?.arquivo || m.status !== 'SALVA') return null;
    const caminho = resolve(PASTA_MIDIAS, m.arquivo);
    if (!caminho.startsWith(PASTA_MIDIAS) || !existsSync(caminho)) return null;
    return { base64: (await readFile(caminho)).toString('base64'), mimeType: m.mimeType ?? null };
  }

  /**
   * Foto que ficou solta no grupo (a print do pedido, o laudo do prestador) entra no
   * chamado que estava aberto naquele horário. Só liga quando há UM chamado possível —
   * com dois abertos ao mesmo tempo no grupo, a foto fica solta em vez de ir para o errado.
   * Janela: 15 min antes do pedido até 30 min depois do encerramento (ou até agora).
   */
  async vincularPelaJanela(conversationId: string) {
    const soltas = await this.prisma.midia.findMany({
      where: { conversationId, atendimentoId: null },
      select: { id: true, recebidaEm: true, legenda: true, message: { select: { content: true } } },
      orderBy: { recebidaEm: 'asc' },
    });
    if (!soltas.length) return 0;
    const chamados = await this.prisma.atendimento.findMany({
      where: { conversationId },
      select: { id: true, ocorrencia: true, idPR7: true, solicitadoEm: true, createdAt: true, chegadaEm: true, concluidoEm: true, encerradoEm: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!chamados.length) return 0;
    let ligadas = 0;
    for (const m of soltas) {
      const t = +m.recebidaEm;
      const texto = `${m.legenda ?? ''} ${m.message?.content ?? ''}`;
      // O texto da foto costuma trazer o nº da ocorrência ("[Foto] Ocorrência #33729899"):
      // com dois chamados no mesmo grupo, é ele que diz de quem é a foto
      const numeros = [...texto.matchAll(/#?(\d{5,10})/g)].map((n) => n[1]);
      const pelaOcorrencia = numeros.length
        ? chamados.filter((a) => (a.ocorrencia && numeros.includes(a.ocorrencia)) || (a.idPR7 && numeros.includes(a.idPR7)))
        : [];
      const naJanela = chamados.filter((a) => {
        const { inicio, fim } = janelaDoChamado(a);
        return t >= inicio && t <= fim;
      });
      // Legenda cita uma ocorrência que não é de nenhum chamado daqui (ex: print da
      // "Ocorrência #33760663" de outro cliente): não é deste grupo de chamados
      const citaOutra = /ocorr[eê]ncia\s*#?\s*\d{5,}/i.test(texto) && numeros.length > 0 && !pelaOcorrencia.length;
      if (citaOutra) continue;
      // Dois chamados abertos ao mesmo tempo e nada identificando: fica solta (melhor sem foto do que na ocorrência errada)
      const candidatos = pelaOcorrencia.length === 1 ? pelaOcorrencia : naJanela;
      if (candidatos.length !== 1) continue;
      await this.prisma.midia.update({ where: { id: m.id }, data: { atendimentoId: candidatos[0].id } });
      ligadas++;
    }
    if (ligadas) this.logger.log(`${ligadas} mídia(s) solta(s) ligadas aos chamados da conversa ${conversationId}`);
    return ligadas;
  }
}

@Controller('midias')
class MidiasController {
  constructor(private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  /** Fotos soltas da conversa do chamado, perto do horário dele — para o Help Desk ligar. */
  @Protegido('atendimentos_criar')
  @Get('soltas/:atendimentoId')
  async soltas(@Param('atendimentoId', ParseUUIDPipe) atendimentoId: string, @Req() req: { user: UsuarioLogado }) {
    const a = await this.prisma.atendimento.findFirst({ where: { id: atendimentoId, vertical: { in: verticaisPermitidas(req.user) } }, select: { conversationId: true, solicitadoEm: true, createdAt: true, encerradoEm: true, concluidoEm: true } });
    if (!a?.conversationId) return [];
    const ini = new Date(+(a.solicitadoEm ?? a.createdAt) - 3 * 3600e3);
    const fim = new Date(+(a.encerradoEm ?? a.concluidoEm ?? new Date()) + 6 * 3600e3);
    return this.prisma.midia.findMany({
      where: { conversationId: a.conversationId, atendimentoId: null, status: 'SALVA', recebidaEm: { gte: ini, lte: fim } },
      orderBy: { recebidaEm: 'asc' },
      select: { id: true, tipo: true, legenda: true, recebidaEm: true, message: { select: { senderName: true } } },
      take: 80,
    });
  }

  /** Liga a foto a um chamado, ou tira (atendimentoId: null). Fica registrado na auditoria. */
  @Protegido('atendimentos_criar')
  @Patch(':id')
  async mover(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: { atendimentoId?: string | null; noRelatorio?: boolean }, @Req() req: { user: UsuarioLogado; ip: string }) {
    const m = await this.prisma.midia.findUnique({ where: { id }, select: { id: true, conversationId: true, atendimentoId: true } });
    if (!m) throw new NotFoundException('Mídia não encontrada');
    const data: { atendimentoId?: string | null; noRelatorio?: boolean } = {};
    if (corpo.atendimentoId !== undefined) {
      if (corpo.atendimentoId !== null) {
        const alvo = await this.prisma.atendimento.findFirst({ where: { id: String(corpo.atendimentoId), vertical: { in: verticaisPermitidas(req.user) } }, select: { id: true, conversationId: true } });
        if (!alvo) throw new NotFoundException('Chamado não encontrado');
        // Só entre chamados da mesma conversa: a foto não viaja de um cliente para outro
        if (m.conversationId && alvo.conversationId && alvo.conversationId !== m.conversationId) throw new BadRequestException('A foto é de outro grupo/conversa');
        data.atendimentoId = alvo.id;
      } else data.atendimentoId = null;
    }
    if (typeof corpo.noRelatorio === 'boolean') data.noRelatorio = corpo.noRelatorio;
    const r = await this.prisma.midia.update({ where: { id }, data, select: { id: true, atendimentoId: true, noRelatorio: true } });
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `mídia ${id}: ${m.atendimentoId ?? 'solta'} → ${r.atendimentoId ?? 'solta'}${typeof corpo.noRelatorio === 'boolean' ? ` · no relatório: ${corpo.noRelatorio ? 'sim' : 'não'}` : ''}` });
    return r;
  }

  /** Arquivo da mídia — só com login e respeitando a linha de negócio liberada ao usuário. */
  @Protegido('atendimentos', 'monitoramento')
  @Get(':id/arquivo')
  async arquivo(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: UsuarioLogado }, @Res() res: Response) {
    const m = await this.prisma.midia.findUnique({ where: { id }, include: { atendimento: { select: { vertical: true } } } });
    if (!m || m.status !== 'SALVA' || !m.arquivo) throw new NotFoundException('Mídia não disponível');
    if (m.atendimento && !verticaisPermitidas(req.user).includes(m.atendimento.vertical)) throw new NotFoundException('Mídia não disponível');
    const caminho = resolve(PASTA_MIDIAS, m.arquivo);
    // Nunca sai da pasta de mídias
    if (!caminho.startsWith(PASTA_MIDIAS) || !existsSync(caminho)) throw new NotFoundException('Arquivo não encontrado');
    res.setHeader('Content-Type', m.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename="${m.id}"`);
    createReadStream(caminho).pipe(res);
  }
}

@Module({ controllers: [MidiasController], providers: [MidiasService], exports: [MidiasService] })
export class MidiasModule {}
