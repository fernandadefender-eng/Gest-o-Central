import * as ExcelJS from 'exceljs';

const ARQUIVOS = [
  'D:\\1001-PR7-2024-2025\\ATENDIMENTOS E PAGAMANETOS 2024\\PAGAMENTOS DE JAN A DEZEMBRO 2024.xlsx',
  'D:\\1001-PR7-2024-2025\\ATENDIMENTOS E PAGAMANETOS 2024\\PAGAMENTOS DE JAN A DEZEMBRO 2025.xlsx',
];

const txt = (c: unknown) => {
  if (c && typeof c === 'object' && 'result' in (c as object)) return String((c as { result: unknown }).result ?? '');
  if (c && typeof c === 'object' && 'text' in (c as object)) return String((c as { text: unknown }).text ?? '');
  return String(c ?? '');
};

(async () => {
  const lucasSC = new Map<string, number>();
  for (const arquivo of ARQUIVOS) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(arquivo);
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        const v = (row.values as unknown[]).slice(1).map(txt);
        const linha = v.join(' | ').replace(/\s+/g, ' ');
        if (/bertola/i.test(linha)) console.log(`BERTOLA [${ws.name}] ${linha.slice(0, 500)}`);
        const ehSC = v.some((x) => x.trim().toUpperCase() === 'SC');
        if (!ehSC) return;
        for (const c of v) {
          if (!/lucas/i.test(c)) continue;
          const nome = c.replace(/\s+/g, ' ').trim();
          lucasSC.set(nome, (lucasSC.get(nome) ?? 0) + 1);
        }
      });
    }
  }
  console.log("\n--- nomes com 'Lucas' em linhas de Santa Catarina ---");
  for (const [n, q] of [...lucasSC.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${q}x  ${n}`);
})();
