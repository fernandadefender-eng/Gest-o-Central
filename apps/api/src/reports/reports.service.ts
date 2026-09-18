import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { AtendimentosService } from '../atendimentos/atendimentos.service';
import { ListAtendimentosDto } from '../atendimentos/list-atendimentos.dto';
import { Vertical } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly atendimentosService: AtendimentosService) {}

  async buildAtendimentosWorkbook(filters: ListAtendimentosDto, verticais: Vertical[]): Promise<ExcelJS.Buffer> {
    const atendimentos = await this.atendimentosService.list(filters, verticais);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Atendimentos');

    sheet.columns = [
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
    sheet.getRow(1).font = { bold: true };

    for (const atendimento of atendimentos) {
      sheet.addRow({
        createdAt: atendimento.createdAt.toLocaleString('pt-BR'),
        clientName: atendimento.client.name,
        clientPhone: atendimento.client.phone,
        contaCodigo: atendimento.conta?.codigo ?? '',
        estabelecimento: atendimento.conta?.estabelecimento ?? '',
        ocorrencia: atendimento.ocorrencia ?? '',
        category: atendimento.category ?? '',
        status: atendimento.status,
        providerName: atendimento.provider?.name ?? '',
        summary: atendimento.summary ?? '',
        resultado: atendimento.resultado ?? '',
      });
    }

    return workbook.xlsx.writeBuffer();
  }
}
