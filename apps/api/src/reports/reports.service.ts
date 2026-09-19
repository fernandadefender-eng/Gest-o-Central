import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { AtendimentosService } from '../atendimentos/atendimentos.service';
import { ListAtendimentosDto } from '../atendimentos/list-atendimentos.dto';
import { Vertical } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly atendimentosService: AtendimentosService) {}

  /** Excel dos atendimentos. Valores só entram quando `incluirValores` (permissão do usuário). */
  async buildAtendimentosWorkbook(filters: ListAtendimentosDto, verticais: Vertical[], incluirValores = false): Promise<ExcelJS.Buffer> {
    const atendimentos = await this.atendimentosService.list(filters, verticais);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Atendimentos');

    const colunas = [
      { header: 'ID', key: 'ref', width: 14 },
      { header: 'Data', key: 'createdAt', width: 20 },
      { header: 'Cliente', key: 'clientName', width: 28 },
      { header: 'Telefone', key: 'clientPhone', width: 18 },
      { header: 'Remota/Conta', key: 'contaCodigo', width: 16 },
      { header: 'Estabelecimento', key: 'estabelecimento', width: 24 },
      { header: 'Ocorrência', key: 'ocorrencia', width: 16 },
      { header: 'Categoria', key: 'category', width: 22 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Prestador', key: 'providerName', width: 24 },
      { header: 'Resumo', key: 'summary', width: 50 },
      { header: 'Resultado', key: 'resultado', width: 30 },
    ];
    // Colunas de valor só para quem pode ver (Excel interno)
    if (incluirValores) colunas.push(
      { header: 'Valor ao prestador', key: 'valorPrestador', width: 18 },
      { header: 'Valor do cliente', key: 'valorCliente', width: 18 },
    );
    sheet.columns = colunas;
    sheet.getRow(1).font = { bold: true };

    for (const a of atendimentos as Record<string, any>[]) {
      const linha: Record<string, unknown> = {
        ref: a.idPR7 ?? a.idInterno ?? '',
        createdAt: (a.solicitadoEm ?? a.createdAt)?.toLocaleString('pt-BR'),
        clientName: a.client?.name, clientPhone: a.client?.phone,
        contaCodigo: a.conta?.codigo ?? '', estabelecimento: a.conta?.estabelecimento ?? '',
        ocorrencia: a.ocorrencia ?? '', category: a.category ?? '', status: a.status,
        providerName: a.provider?.name ?? '', summary: a.summary ?? '', resultado: a.resultado ?? '',
      };
      if (incluirValores) { linha.valorPrestador = a.valorPrestador != null ? Number(a.valorPrestador) : ''; linha.valorCliente = a.valorCliente != null ? Number(a.valorCliente) : ''; }
      sheet.addRow(linha);
    }

    return workbook.xlsx.writeBuffer();
  }

  /** Linhas para o PDF de lista — SEM valores, sempre. */
  async linhasParaPdf(filters: ListAtendimentosDto, verticais: Vertical[]) {
    const atendimentos = await this.atendimentosService.list(filters, verticais);
    return (atendimentos as Record<string, any>[]).map((a) => ({
      ref: a.idPR7 ?? a.idInterno ?? '',
      data: (a.solicitadoEm ?? a.createdAt)?.toLocaleDateString('pt-BR') ?? '',
      cliente: a.empresa?.nomeFantasia || a.client?.name || '',
      local: a.conta?.estabelecimento || (a.vertical === 'VEICULAR' ? a.placa : '') || '',
      categoria: a.category ?? (a.vertical === 'VEICULAR' ? 'Veicular' : 'Patrimonial'),
      status: a.status, resultado: a.resultado ?? '',
    }));
  }
}
