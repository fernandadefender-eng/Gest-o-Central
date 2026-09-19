/**
 * Importa a aba "CHAVES E SENHAS CADEADOS" do arquivo EQUIPE para AcessoPosto.
 * A senha do cadeado é segredo: fica em `segredo` (campo restrito/auditado no painel),
 * NUNCA na observação. Trocas conhecidas (nova senha, cadeado trocado, outra empresa)
 * viram entrada no histórico. Idempotente: casa pelo posto (nome) + cliente.
 *
 *   npx ts-node -T scripts/importar-cadeados.ts "<arquivo EQUIPE.xlsx>" [--aplicar]
 *
 * Sem --aplicar só mostra o que faria.
 */
import * as ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ABA = 'CHAVES E SENHAS CADEADOS';

const txt = (c: unknown): string => {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toLocaleDateString('pt-BR');
  if (typeof c === 'object') {
    const o = c as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    return '';
  }
  return String(c).trim();
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const arquivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!arquivo) throw new Error('Informe o arquivo EQUIPE .xlsx');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const ws = wb.getWorksheet(ABA);
  if (!ws) throw new Error(`Aba "${ABA}" não encontrada`);

  let criados = 0, atualizados = 0, ignorados = 0;
  const linhas: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const v = (i: number) => txt(row.getCell(i).value);
    const idPosto = v(1);            // "X" ou número da conta
    const cliente = v(2);            // Segurpro
    const posto = v(3);              // estabelecimento (nome curto)
    const filial = v(4);            // nome completo
    const cidade = v(5);
    const uf = v(6);
    const dataAtualizacao = v(7);
    const apoioResp = v(10);
    const qtdChaves = v(12);         // "Quantidade de chaves"
    const senha = v(13);             // "Senha Nº do Cadeado"  <- SEGREDO
    const responsavel = v(14);
    const empresa = v(15);
    const obsEntrar = v(16);
    const obsFinalizar = v(17);

    const nomePosto = posto || filial;
    if (!nomePosto) { ignorados++; continue; }

    const temSenha = !!senha && !/^_+$/.test(senha);
    const temChaves = !!qtdChaves && !/^0(\s*unidade)?$/i.test(qtdChaves) && !/não tem/i.test(qtdChaves);
    let tipo = 'DESCONHECIDO';
    if (temSenha && temChaves) tipo = 'AMBOS';
    else if (temSenha) tipo = 'SENHA';
    else if (temChaves) tipo = 'CHAVE_FISICA';
    else if (/não tem chaves/i.test(qtdChaves) || /não tem/i.test(apoioResp)) tipo = 'NENHUM';

    // Observação (sem a senha!): junta as notas de entrada/finalização.
    const obsPartes = [obsEntrar, obsFinalizar].map((s) => s.trim()).filter(Boolean);
    const observacao = obsPartes.join(' · ') || null;

    // Histórico: registra trocas conhecidas a partir do texto das observações.
    const historico: any[] = [];
    const textoTudo = norm([obsEntrar, obsFinalizar].join(' '));
    const outraEmpresa = /outra empresa|troc/.test(textoTudo) && /senha/.test(textoTudo);
    if (/nova senha atualizada|cadeado foi trocado|senha do cadeado incorreta|senha incorreta|não temos ela|nao temos ela/.test(textoTudo)) {
      historico.push({
        em: dataAtualizacao || null,
        por: 'importação planilha EQUIPE',
        tipo,
        segredoTrocado: /trocad|nova senha/.test(textoTudo),
        motivo: obsPartes.join(' · '),
        outraEmpresa,
      });
    }

    linhas.push(`${criados + atualizados + 1}. [${tipo}] ${nomePosto} (${cidade || '?'}/${uf || '?'}) — ${cliente || empresa || '?'}${temSenha ? ' · senha ****' : ''}${temChaves ? ` · chaves:${qtdChaves}` : ''}${observacao ? ` · obs: ${observacao.slice(0, 60)}` : ''}`);

    if (!aplicar) { criados++; continue; }

    // Tenta ligar a uma Conta pelo código (idPosto numérico) para preencher contaId.
    let contaId: string | null = null;
    if (idPosto && /^\d+$/.test(idPosto)) {
      const conta = await prisma.conta.findFirst({ where: { codigo: idPosto } });
      if (conta) contaId = conta.id;
    }

    // Chave natural: mesmo posto (nome normalizado) + cliente. Evita duplicar.
    const existentes = await prisma.acessoPosto.findMany({
      where: { posto: { equals: nomePosto, mode: 'insensitive' } },
    });
    const alvo = existentes.find((e) => norm(e.posto) === norm(nomePosto) && norm(e.cliente || '') === norm(cliente || empresa || ''));

    const dados = {
      posto: nomePosto,
      cidade: cidade || null,
      uf: uf || null,
      cliente: cliente || empresa || null,
      tipo,
      segredo: temSenha ? senha : null,
      observacao,
      historico: historico.length ? historico : (alvo ? (alvo.historico as any) : []),
      atualizadoPor: `apoio: ${apoioResp || responsavel || '—'}`,
      ...(contaId ? { contaId } : {}),
    };

    if (alvo) {
      await prisma.acessoPosto.update({ where: { id: alvo.id }, data: dados });
      atualizados++;
    } else {
      // contaId é @unique: só usa se ainda não existir outro AcessoPosto com ela.
      if (contaId) {
        const jaTem = await prisma.acessoPosto.findUnique({ where: { contaId } });
        if (jaTem) delete (dados as any).contaId;
      }
      await prisma.acessoPosto.create({ data: dados });
      criados++;
    }
  }

  console.log(linhas.join('\n'));
  console.log(`\n${aplicar ? 'APLICADO' : 'PRÉVIA (use --aplicar)'}: ${criados} criados, ${atualizados} atualizados, ${ignorados} linhas vazias ignoradas.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
