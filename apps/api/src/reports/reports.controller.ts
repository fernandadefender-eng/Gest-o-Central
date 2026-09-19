import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ListAtendimentosDto } from '../atendimentos/list-atendimentos.dto';
import { Protegido, temPermissao, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { PrismaService } from '../prisma/prisma.service';
import { gerarRelatorioPdf } from './relatorio-pdf';
import { gerarRelatorioListaPdf } from './relatorio-lista-pdf';
import { AuditoriaService } from '../seguranca/seguranca.module';

@Protegido('relatorios')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService, private readonly prisma: PrismaService, private readonly auditoria: AuditoriaService) {}

  @Get('atendimentos.xlsx')
  async atendimentosXlsx(@Query() filters: ListAtendimentosDto, @Req() req: { user: UsuarioLogado; ip?: string }, @Res() res: Response) {
    // Excel é o relatório interno: valores só para quem tem acesso a valores (ou ADM)
    const incluirValores = temPermissao(req.user, 'valores');
    const buffer = await this.reportsService.buildAtendimentosWorkbook(filters, verticaisPermitidas(req.user), incluirValores);
    this.auditoria.registrar('EXPORTACAO', { ip: req.ip, usuario: req.user.email, detalhe: `planilha de atendimentos${incluirValores ? ' (com valores)' : ''} · filtros ${JSON.stringify(filters).slice(0, 200)} · ${((buffer as unknown as { byteLength: number }).byteLength / 1024).toFixed(0)} KB` });

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="atendimentos.xlsx"',
    });
    res.send(buffer);
  }

  /** Relatório da LISTA de atendimentos em PDF — sem valores (regra do usuário). */
  @Get('atendimentos.pdf')
  async atendimentosPdf(@Query() filters: ListAtendimentosDto, @Req() req: { user: UsuarioLogado; ip?: string }, @Res() res: Response) {
    const linhas = await this.reportsService.linhasParaPdf(filters, verticaisPermitidas(req.user));
    const partes = [filters.from ? `de ${filters.from}` : null, filters.to ? `até ${filters.to}` : null, filters.status, filters.category].filter(Boolean).join(' · ');
    const buffer = await gerarRelatorioListaPdf('Relatório de atendimentos', partes || 'todos os atendimentos do filtro atual', linhas);
    this.auditoria.registrar('EXPORTACAO', { ip: req.ip, usuario: req.user.email, detalhe: `PDF de atendimentos (${linhas.length} linhas, sem valores) · filtros ${JSON.stringify(filters).slice(0, 160)}` });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="relatorio-atendimentos.pdf"' });
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
