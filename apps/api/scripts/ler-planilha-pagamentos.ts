/** Leitura exploratória das planilhas de pagamento (só mostra estrutura, não grava nada). */
import * as ExcelJS from 'exceljs';

async function main() {
  for (const caminho of process.argv.slice(2)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(caminho);
    console.log(`\n===== ${caminho.split(/[\\/]/).pop()} =====`);
    for (const ws of wb.worksheets) {
      const linhas = ws.actualRowCount;
      console.log(`\n--- aba "${ws.name}" · ${linhas} linhas × ${ws.actualColumnCount} colunas`);
      if (linhas < 2) continue;
      // Cabeçalho: primeira linha com 3+ células preenchidas
      let iCab = 1;
      for (let i = 1; i <= Math.min(10, linhas); i++) {
        const preenchidas = (ws.getRow(i).values as unknown[]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length;
        if (preenchidas >= 3) { iCab = i; break; }
      }
      const cab = (ws.getRow(iCab).values as unknown[]).slice(1).map((v) => String(v ?? '').replace(/\s+/g, ' ').trim());
      console.log(`cabeçalho (linha ${iCab}): ${cab.join(' | ')}`);
      for (let i = iCab + 1; i <= Math.min(iCab + 2, linhas); i++) {
        const v = (ws.getRow(i).values as unknown[]).slice(1).map((c) => {
          if (c && typeof c === 'object' && 'result' in (c as object)) return String((c as { result: unknown }).result);
          if (c instanceof Date) return c.toISOString().slice(0, 10);
          return String(c ?? '').replace(/\s+/g, ' ').trim();
        });
        console.log(`  linha ${i}: ${v.join(' | ').slice(0, 400)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
