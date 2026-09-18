/** Busca um termo em todas as abas de uma planilha (só leitura, não grava nada). */
import * as ExcelJS from 'exceljs';

async function main() {
  const [arquivo, ...termos] = process.argv.slice(2);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const alvos = termos.map((t) => t.toLowerCase());
  const vistos = new Set<string>();
  for (const ws of wb.worksheets) {
    ws.eachRow((row, i) => {
      const celulas = (row.values as unknown[]).slice(1).map((c) => {
        if (c && typeof c === 'object' && 'result' in (c as object)) return String((c as { result: unknown }).result ?? '');
        if (c && typeof c === 'object' && 'text' in (c as object)) return String((c as { text: unknown }).text ?? '');
        return String(c ?? '');
      });
      const linha = celulas.join(' | ').replace(/\s+/g, ' ').trim();
      const baixa = linha.toLowerCase();
      if (!alvos.some((t) => baixa.includes(t))) return;
      const chave = linha.slice(0, 200);
      if (vistos.has(chave)) return;
      vistos.add(chave);
      console.log(`[${ws.name} L${i}] ${linha.slice(0, 260)}`);
    });
  }
  console.log(`\n${vistos.size} linha(s) distintas`);
}

main().catch((e) => { console.error(e); process.exit(1); });
