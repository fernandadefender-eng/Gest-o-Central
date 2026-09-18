/**
 * Busca dirigida (só leitura) de nomes de operadores nas planilhas de atendimento já
 * mapeadas pela revisão (logs/revisao-planilhas-*.json). Mostra onde o nome aparece:
 * na coluna de operador (Help Desk) ou em outra coluna (agente, cliente...).
 * Uso: npx ts-node -T scripts/buscar-operadores-planilhas.ts "lucas" "tha?l[iy]n|talin"
 */
import * as ExcelJS from 'exceljs';
import { readFileSync } from 'fs';
import { join } from 'path';

const AREA = 'C:/Users/ferna/OneDrive/Área de Trabalho';
const texto = (v: any): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' && 'richText' in v ? v.richText.map((r: any) => r.text).join('') : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : typeof v === 'object' && 'text' in v ? String(v.text) : String(v)).trim();
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const R_OPERADOR = /^(operador|op\.?\s*pr7|operador\s*pr7|atendente|help\s*desk|operador\s*\(a\)|respons[aá]vel\s*pr7)/i;

(async () => {
  const padroes = process.argv.slice(2).map((p) => new RegExp(`(^|\\s)(${p})`, 'i'));
  const rev = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'logs', 'revisao-planilhas-2026-09-18.json'), 'utf8'));
  const arquivos: string[] = rev.arquivos.map((a: any) => (a.arquivo.startsWith('../') ? join(AREA, a.arquivo) : join(AREA, a.arquivo)));
  const achados: Record<string, { comoOperador: Map<string, number>; outraColuna: Map<string, number>; exemplos: string[] }> = {};
  for (const p of padroes) achados[p.source] = { comoOperador: new Map(), outraColuna: new Map(), exemplos: [] };
  for (const arq of arquivos) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.readFile(arq); } catch { continue; }
    for (const ws of wb.worksheets) {
      let colOp = -1;
      ws.eachRow({ includeEmpty: false }, (row, i) => {
        const vals = (row.values as unknown[]).map(texto);
        const op = vals.findIndex((v, j) => j > 0 && R_OPERADOR.test(v));
        if (op > 0) { colOp = op; return; }
        vals.forEach((v, j) => {
          if (j === 0 || !v) return;
          for (const p of padroes) {
            if (!p.test(semAcento(v))) continue;
            const a = achados[p.source];
            const chave = `${arq.split(/[\\/]/).pop()} · ${ws.name}`;
            const alvo = j === colOp ? a.comoOperador : a.outraColuna;
            alvo.set(chave, (alvo.get(chave) ?? 0) + 1);
            if (j === colOp && a.exemplos.length < 8) a.exemplos.push(`${chave} L${i}: "${v}" · ${vals.filter(Boolean).slice(1, 7).join(' | ')}`);
          }
        });
      });
    }
  }
  for (const [p, a] of Object.entries(achados)) {
    console.log(`\n=== /${p}/`);
    console.log('Na coluna de OPERADOR:', a.comoOperador.size ? '' : 'nenhuma');
    for (const [k, n] of [...a.comoOperador].sort((x, y) => y[1] - x[1])) console.log(`  ${n}× ${k}`);
    for (const e of a.exemplos) console.log('   ex.', e);
    console.log('Em outras colunas (agente, cliente...):', [...a.outraColuna.values()].reduce((s, n) => s + n, 0), 'células em', a.outraColuna.size, 'abas');
  }
})();
