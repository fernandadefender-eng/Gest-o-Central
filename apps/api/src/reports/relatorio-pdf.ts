import { NotFoundException } from '@nestjs/common';
import { Vertical } from '@prisma/client';
import { existsSync } from 'fs';
import { resolve } from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { PASTA_MIDIAS } from '../midias/midias.module';

/**
 * Relatório do atendimento em PDF, para enviar ao cliente no fechamento.
 *
 * Entra: identificação (ID, Remota/Conta, validação, SAP), local, serviço, horários,
 * quem atendeu, relato e as fotos marcadas "vai para o relatório" (Midia.noRelatorio).
 * NÃO entra: valores, Pix, observação interna, conversa do WhatsApp — o documento
 * é do cliente.
 */
const FUSO = 'America/Sao_Paulo';
const dataHora = (d?: Date | null) =>
  d ? d.toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const minutos = (a?: Date | null, b?: Date | null) => {
  if (!a || !b || b < a) return null;
  const m = Math.round((+b - +a) / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const STATUS: Record<string, string> = {
  NOVO: 'Novo', EM_ANDAMENTO: 'Em andamento', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado', NAO_ATENDIDO: 'Não atendido',
};

const COR = { titulo: '#0f3d3a', texto: '#1f2933', suave: '#6b7a86', linha: '#d7e0e5', faixa: '#e8f5f3', destaque: '#0d9488' };

export async function gerarRelatorioPdf(prisma: PrismaService, id: string, verticais: Vertical[]): Promise<{ buffer: Buffer; nome: string }> {
  const a = await prisma.atendimento.findFirst({
    where: { id, vertical: { in: verticais } },
    include: {
      client: { select: { name: true } },
      empresa: { select: { nomeFantasia: true, razaoSocial: true } },
      conta: { select: { codigo: true, estabelecimento: true, endereco: true, cidade: true, estado: true } },
      provider: { select: { name: true } },
      midias: {
        where: { tipo: 'FOTO', status: 'SALVA', noRelatorio: true },
        orderBy: { recebidaEm: 'asc' },
        select: { arquivo: true, legenda: true, recebidaEm: true, mimeType: true },
      },
    },
  });
  if (!a) throw new NotFoundException('Atendimento não encontrado');

  const det = (a.detalhes ?? {}) as Record<string, any>;
  const ret = (det.retornoPrestador ?? {}) as Record<string, any>;
  const ident = a.idPR7 ?? a.idInterno ?? a.id.slice(0, 8);
  const cliente = a.empresa?.nomeFantasia || a.empresa?.razaoSocial || a.client?.name || '—';
  const cidade = a.conta?.cidade || det.cidade || '';
  const uf = a.conta?.estado || det.estado || '';

  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: `Relatório do atendimento ${ident}`, Author: 'PR7' } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const pronto = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));

  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;

  // ---------- Cabeçalho ----------
  doc.rect(0, 0, doc.page.width, 78).fill(COR.titulo);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('PR7', L, 24);
  doc.font('Helvetica').fontSize(10).fillColor('#bfe7e1').text('Relatório de atendimento', L, 50);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#ffffff').text(`ID ${ident}`, L, 26, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#bfe7e1').text(STATUS[a.status] ?? a.status, L, 50, { width: W, align: 'right' });
  doc.y = 98;

  const secao = (titulo: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(L, y, W, 20).fill(COR.faixa);
    doc.fillColor(COR.titulo).font('Helvetica-Bold').fontSize(10.5).text(titulo.toUpperCase(), L + 8, y + 5, { characterSpacing: 0.6 });
    doc.y = y + 28;
  };
  // Pares rótulo/valor em duas colunas
  const campos = (pares: [string, string | null | undefined][]) => {
    const validos = pares.filter(([, v]) => v && String(v).trim() && v !== '—');
    const col = W / 2;
    for (let i = 0; i < validos.length; i += 2) {
      if (doc.y > doc.page.height - 90) doc.addPage();
      const y = doc.y;
      let fim = y;
      validos.slice(i, i + 2).forEach(([rot, val], j) => {
        const x = L + j * col;
        doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(rot.toUpperCase(), x, y, { width: col - 12, characterSpacing: 0.4 });
        doc.font('Helvetica').fontSize(10.5).fillColor(COR.texto).text(String(val), x, doc.y + 1, { width: col - 12 });
        fim = Math.max(fim, doc.y);
      });
      doc.y = fim + 8;
    }
  };

  secao('Cliente e local');
  campos([
    ['Cliente', cliente],
    ['Estabelecimento', a.conta?.estabelecimento || ret.estabelecimento],
    ['Remota/Conta', a.conta?.codigo || a.ocorrencia],
    ['Nº da ocorrência', a.conta?.codigo && a.ocorrencia && a.ocorrencia !== a.conta.codigo ? a.ocorrencia : null],
    ['Endereço', a.conta?.endereco],
    ['Cidade/UF', [cidade, uf].filter(Boolean).join('/')],
    ['Placa', a.placa],
    ['Responsável no local', [a.responsavelLocalNome, a.responsavelLocalTelefone].filter(Boolean).join(' · ')],
  ]);

  secao('Serviço');
  campos([
    ['Tipo de serviço', a.category],
    ['Linha', a.vertical === 'VEICULAR' ? 'Veicular' : 'Patrimonial'],
    ['Validação', a.codigoValidacao],
    ['SAP', a.sap],
    ['Help Desk', a.operadorPR7],
    ['Agente / técnico', a.agenteNome || ret.agente],
    ['Prestador', a.provider?.name],
  ]);

  secao('Horários');
  campos([
    ['Solicitado', dataHora(a.solicitadoEm)],
    ['Prestador acionado', dataHora(a.acionadoEm)],
    ['Chegada no local', dataHora(a.chegadaEm)],
    ['Término', dataHora(a.concluidoEm)],
    ['Tempo até a chegada', minutos(a.solicitadoEm, a.chegadaEm)],
    ['Tempo no local', minutos(a.chegadaEm, a.concluidoEm)],
  ]);

  const relato = [ret.relato, a.resultado, a.summary].find((t) => t && String(t).trim());
  if (relato || a.detalheNaoAtendimento) {
    secao('Relato');
    doc.font('Helvetica').fontSize(10.5).fillColor(COR.texto).text(String(relato ?? ''), L, doc.y, { width: W, lineGap: 2 });
    if (a.detalheNaoAtendimento) {
      doc.moveDown(0.4).font('Helvetica-Oblique').fillColor(COR.suave).text(a.detalheNaoAtendimento, { width: W });
    }
  }

  // ---------- Fotos: 2 por linha, com horário ----------
  const fotos = a.midias
    .map((m) => ({ ...m, caminho: m.arquivo ? resolve(PASTA_MIDIAS, m.arquivo) : '' }))
    .filter((m) => m.caminho.startsWith(PASTA_MIDIAS) && existsSync(m.caminho) && /jpe?g|png/i.test(m.mimeType ?? m.caminho));
  if (fotos.length) {
    secao(`Fotos (${fotos.length})`);
    const gap = 12, larg = (W - gap) / 2, alt = larg * 0.75;
    for (let i = 0; i < fotos.length; i++) {
      const col = i % 2;
      if (col === 0 && doc.y + alt + 30 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const y = doc.y, x = L + col * (larg + gap);
      try {
        doc.rect(x, y, larg, alt).fill('#f1f5f7');
        doc.image(fotos[i].caminho, x, y, { fit: [larg, alt], align: 'center', valign: 'center' });
      } catch {
        doc.fillColor(COR.suave).fontSize(9).text('(foto não pôde ser lida)', x, y + alt / 2, { width: larg, align: 'center' });
      }
      const legenda = [dataHora(fotos[i].recebidaEm), fotos[i].legenda].filter(Boolean).join(' · ');
      doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(legenda, x, y + alt + 3, { width: larg, height: 22, ellipsis: true });
      if (col === 1 || i === fotos.length - 1) doc.y = y + alt + 28;
      else doc.y = y;
    }
  }

  // ---------- Rodapé em todas as páginas ----------
  const paginas = doc.bufferedPageRange();
  for (let p = 0; p < paginas.count; p++) {
    doc.switchToPage(paginas.start + p);
    // Sem margem inferior enquanto escreve o rodapé (senão o pdfkit abre página nova)
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 30;
    doc.moveTo(L, y - 6).lineTo(L + W, y - 6).lineWidth(0.5).strokeColor(COR.linha).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave)
      .text(`PR7 · Atendimento ${ident} · gerado em ${dataHora(new Date())}`, L, y, { width: W / 2, lineBreak: false })
      .text(`Página ${p + 1} de ${paginas.count}`, L + W / 2, y, { width: W / 2, align: 'right', lineBreak: false });
  }
  doc.end();

  const buffer = await pronto;
  return { buffer, nome: `relatorio-atendimento-${ident}.pdf` };
}
