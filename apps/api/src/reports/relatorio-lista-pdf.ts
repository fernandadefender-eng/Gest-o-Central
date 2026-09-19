/**
 * Relatório de atendimentos em PDF (lista/tabela), para impressão/envio.
 * NUNCA traz valores (regra do usuário: "algumas informações não vêm no PDF, no caso valores").
 * Logo da PR7 no topo, rodapé com data e total.
 */
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { join } from 'path';

const LOGO = [join(__dirname, '..', '..', 'assets', 'logo-pr7.png'), join(process.cwd(), 'assets', 'logo-pr7.png')].find((p) => existsSync(p));

export type LinhaRelatorio = {
  ref: string; data: string; cliente: string; local: string; categoria: string; status: string; resultado: string;
};

export function gerarRelatorioListaPdf(titulo: string, subtitulo: string, linhas: LinhaRelatorio[]): Promise<Buffer> {
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

    // Colunas — SEM valores
    const cols: { t: string; w: number }[] = [
      { t: 'ID', w: 70 }, { t: 'Data', w: 70 }, { t: 'Cliente', w: 150 }, { t: 'Local', w: 150 },
      { t: 'Serviço', w: 110 }, { t: 'Status', w: 80 }, { t: 'Resultado', w: 0 },
    ];
    const usada = cols.reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w = W - M * 2 - usada;
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
      const valores = [l.ref, l.data, l.cliente, l.local, l.categoria, l.status, l.resultado];
      const alturas = valores.map((v, i) => doc.heightOfString(String(v ?? ''), { width: cols[i].w - 4 }));
      const alt = Math.max(linhaAltura, ...alturas) + 2;
      if (y + alt > doc.page.height - 40) { doc.addPage({ layout: 'landscape', margin: M }); y = 40; cabecalho(); doc.font('Helvetica').fontSize(8).fillColor('#1c1a17'); }
      let x = M;
      for (let i = 0; i < cols.length; i++) { doc.text(String(valores[i] ?? ''), x + 2, y, { width: cols[i].w - 4 }); x += cols[i].w; }
      y += alt;
      doc.moveTo(M, y - 1).lineTo(W - M, y - 1).lineWidth(0.3).strokeColor('#eee').stroke();
    }

    // Rodapé em todas as páginas
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7.5).fillColor('#78716c')
        .text(`PR7 Inteligência em Segurança · ${linhas.length} atendimentos · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · sem valores`, M, doc.page.height - 26, { width: W - M * 2, align: 'left' })
        .text(`Página ${i + 1} de ${range.count}`, M, doc.page.height - 26, { width: W - M * 2, align: 'right' });
    }
    doc.end();
  });
}
