/** Compara a leitura antiga (cabeçalho da linha 1) com a nova (por bloco). Só mede, não grava. */
import * as ExcelJS from 'exceljs';
const texto = (v: any): string => (v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' && 'text' in v ? String(v.text) : typeof v === 'object' && 'result' in v ? String(v.result) : String(v)).trim();
const ROTULOS = [/^id$/i, /^cliente$/i, /^placa$/i, /^data$/i, /^motivo$/i, /^agente$/i, /^cidade$/i, /^estado$/i, /recuperado/i, /hora/i, /^conta$/i, /estabelecimento/i, /tipo de servi/i];
const ehPlaca = (t: string) => /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(t.toUpperCase().replace(/\s/g, ''));

async function ver(caminho: string) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(caminho);
  console.log(`\n### ${caminho.split('/').pop()}`);
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible') continue;
    const cabs: number[] = [];
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      const vals = (row.values as unknown[]).map(texto);
      if (ROTULOS.filter((r) => vals.some((v, j) => j > 0 && r.test(v))).length >= 5) cabs.push(i);
    });
    if (cabs.length < 2) continue;
    // Para cada bloco, a ordem das colunas é a mesma da linha 1?
    const assinatura = (n: number) => (ws.getRow(n).values as unknown[]).map(texto).join('|').toLowerCase();
    const base = assinatura(cabs[0]);
    const diferentes = cabs.slice(1).filter((n) => assinatura(n) !== base);
    // Quantas linhas cada bloco tem
    let linhas = 0;
    ws.eachRow({ includeEmpty: false }, (r, i) => { if (i > cabs[0] && !r.hidden && !cabs.includes(i)) linhas++; });
    const afetadas = diferentes.reduce((soma, n) => {
      const ate = cabs[cabs.indexOf(n) + 1] ?? ws.rowCount;
      let q = 0; ws.eachRow({ includeEmpty: false }, (r, i) => { if (i > n && i <= ate && !r.hidden) q++; });
      return soma + q;
    }, 0);
    console.log(`  ${ws.name}: ${cabs.length} blocos · ${linhas} linhas · blocos com ordem DIFERENTE do primeiro: ${diferentes.length} (${afetadas} linhas afetadas)`);
    for (const n of diferentes.slice(0, 3)) {
      const a = assinatura(n).split('|').filter(Boolean).slice(0, 12).join(' · ');
      console.log(`     L${n}: ${a}`);
    }
  }
}
async function main() {
  await ver('C:/Users/ferna/OneDrive/PAGAMENTOS DE JAN A DEZEMBRO 2024.xlsx');
  await ver('C:/Users/ferna/OneDrive/De Mattos-PAGAMENTOS DE JAN A DEZEMBRO 2025.xlsx');
}
main().catch((e) => { console.error(e); process.exit(1); });
