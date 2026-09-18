import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ListAtendimentosDto } from '../atendimentos/list-atendimentos.dto';
import { Protegido, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { PrismaService } from '../prisma/prisma.service';
import { gerarRelatorioPdf } from './relatorio-pdf';
import { AuditoriaService } from '../seguranca/seguranca.module';

@Protegido('relatorios')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService, private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  @Get('atendimentos.xlsx')
  async atendimentosXlsx(@Query() filters: ListAtendimentosDto, @Req() req: { user: UsuarioLogado; ip?: string }, @Res() res: Response) {
    const buffer = await this.reportsService.buildAtendimentosWorkbook(filters, verticaisPermitidas(req.user));
    // Saída de dados fica na auditoria: quem baixou, quando e com quais filtros
    this.auditoria.registrar('EXPORTACAO', { ip: req.ip, usuario: req.user.email, detalhe: `planilha de atendimentos · filtros ${JSON.stringify(filters).slice(0, 200)} · ${((buffer as unknown as { byteLength: number }).byteLength / 1024).toFixed(0)} KB` });

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="atendimentos.xlsx"',
    });
    res.send(buffer);
  }

  /** Relatório do atendimento em PDF (com fotos) para o fechamento com o cliente */
  @Get('atendimentos/:id/relatorio.pdf')
  async relatorioPdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: UsuarioLogado; ip?: string }, @Res() res: Response) {
    const { buffer, nome } = await gerarRelatorioPdf(this.prisma, id, verticaisPermitidas(req.user));
    this.auditoria.registrar('EXPORTACAO', { ip: req.ip, usuario: req.user.email, detalhe: `PDF ${nome}` });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}"` });
    res.send(buffer);
  }
}
