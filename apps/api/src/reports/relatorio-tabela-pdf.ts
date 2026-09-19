/**
 * Gerador de PDF de tabela genérico, reutilizável por qualquer aba (Roteirizador, SAC…).
 * Logo PR7 no topo, cabeçalho de colunas, quebra de página automática e rodapé.
 * Regra do usuário: valores (pagamento a cliente/apoio) NÃO entram no PDF — quem chama
 * decide as colunas e simplesmente não passa colunas de valor. O rodapé marca "sem valores".
 */
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { join } from 'path';

const LOGO = [join(__dirname, '..', '..', 'assets', 'logo-pr7.png'), join(process.cwd(), 'assets', 'logo-pr7.png')].find((p) => existsSync(p));

export type ColunaPdf = { t: string; w: number };

export function gerarTabelaPdf(opts: {
  titulo: string; subtitulo: string; colunas: ColunaPdf[]; linhas: (string | number | null)[][];
  rodape?: string; totais?: string[];
}): Promise<Buffer> {
  const { titulo, subtitulo, colunas, linhas } = opts;
  return new Promise((ok, erro) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: titulo, Author: 'PR7 Inteligência em Segurança' } });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', erro);

    const W = doc.page.width, M = 32;
    if (LOGO) doc.image(LOGO, M, 24, { fit: [90, 44] });
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#10212a').text(titulo, M + 100, 28);
    doc.font('Helvetica').fontSize(9.5).fillColor('#57534e').text(subtitulo, M + 100, 48);
    doc.moveTo(M, 74).lineTo(W - M, 74).lineWidth(1).strokeColor('#b8892b').stroke();

    // Ajusta a última coluna para ocupar a largura restante
    const cols = colunas.map((c) => ({ ...c }));
    const usada = cols.reduce((s, c) => s + c.w, 0);
    if (cols.length) cols[cols.length - 1].w = Math.max(60, W - M * 2 - (usada - cols[cols.length - 1].w));
    let y = 84;
    const linhaAltura = 16;

    const cabecalho = () => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f766e');
      let x = M;
      for (const c of cols) { doc.text(c.t, x + 2, y + 2, { width: c.w - 4 }); x += c.w; }
      y += linhaAltura;
      doc.moveTo(M, y - 2).lineTo(W - M, y - 2).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    };
    cabecalho();

    doc.font('Helvetica').fontSize(8).fillColor('#1c1a17');
    for (const l of linhas) {
      const alturas = l.map((v, i) => doc.heightOfString(String(v ?? ''), { width: (cols[i]?.w ?? 80) - 4 }));
      const alt = Math.max(linhaAltura, ...alturas) + 2;
      if (y + alt > doc.page.height - 40) { doc.addPage({ layout: 'landscape', margin: M }); y = 40; cabecalho(); doc.font('Helvetica').fontSize(8).fillColor('#1c1a17'); }
      let x = M;
      for (let i = 0; i < cols.length; i++) { doc.text(String(l[i] ?? ''), x + 2, y, { width: cols[i].w - 4 }); x += cols[i].w; }
      y += alt;
      doc.moveTo(M, y - 1).lineTo(W - M, y - 1).lineWidth(0.3).strokeColor('#eee').stroke();
    }

    if (opts.totais?.length) {
      y += 6;
      if (y > doc.page.height - 50) { doc.addPage({ layout: 'landscape', margin: M }); y = 40; }
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#10212a').text(opts.totais.join('    ·    '), M, y, { width: W - M * 2 });
    }

    const nota = opts.rodape ?? `${linhas.length} registros · sem valores`;
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7.5).fillColor('#78716c')
        .text(`PR7 Inteligência em Segurança · ${nota} · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, M, doc.page.height - 26, { width: W - M * 2, align: 'left' })
        .text(`Página ${i + 1} de ${range.count}`, M, doc.page.height - 26, { width: W - M * 2, align: 'right' });
    }
    doc.end();
  });
}

/** Excel genérico: cabeçalho em negrito e linhas. Retorna o buffer .xlsx. */
export async function gerarTabelaXlsx(aba: string, cabecalho: string[], linhas: (string | number | null)[][]): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(aba.slice(0, 31));
  ws.addRow(cabecalho);
  ws.getRow(1).font = { bold: true };
  for (const l of linhas) ws.addRow(l);
  ws.columns.forEach((c, i) => { c.width = Math.min(40, Math.max(12, cabecalho[i]?.length ?? 12, ...linhas.map((l) => String(l[i] ?? '').length))); });
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}
