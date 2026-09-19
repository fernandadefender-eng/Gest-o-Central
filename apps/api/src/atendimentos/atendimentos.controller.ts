import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { EncerramentoDto, MarcoDto } from './encerramento.dto';
import { EdicaoAtendimentoDto } from './edicao.dto';
import { AtendimentosService } from './atendimentos.service';
import { ListAtendimentosDto } from './list-atendimentos.dto';
import { NovaOcorrenciaDto } from './nova-ocorrencia.dto';
import { Protegido, temPermissao, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { AuditoriaService } from '../seguranca/seguranca.module';

type Req = { user: UsuarioLogado; ip?: string };

@Protegido('atendimentos')
@Controller('atendimentos')
export class AtendimentosController {
  constructor(
    private readonly atendimentosService: AtendimentosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  list(@Query() filters: ListAtendimentosDto, @Req() req: Req) {
    // Lista resumida não traz valores; eles só aparecem no detalhe, conforme permissão
    return this.atendimentosService.listaResumida(filters, verticaisPermitidas(req.user), 300);
  }

  @Get('acionamentos')
  acionamentos(@Query('desde') desde: string | undefined, @Req() req: Req) {
    // Sem data válida: últimos 10 minutos (evita despejar o histórico inteiro)
    const d = desde && !isNaN(Date.parse(desde)) ? new Date(desde) : new Date(Date.now() - 10 * 60000);
    return this.atendimentosService.acionamentosDesde(d, verticaisPermitidas(req.user));
  }

  /** Alertas de veículo divulgados ("DIVULGAÇÃO FURTO"): não são chamados, só aviso para a rede */
  @Get('alertas-veiculares')
  alertas(@Query('busca') busca: string | undefined, @Req() req: Req) {
    return this.atendimentosService.alertasVeiculares(verticaisPermitidas(req.user), busca);
  }

  @Get('pendencias-motivo')
  pendenciasMotivo(@Req() req: Req) {
    return this.atendimentosService.pendenciasMotivo(verticaisPermitidas(req.user));
  }

  @Get('pendencias-cliente')
  pendenciasCliente(@Req() req: Req) {
    return this.atendimentosService.pendenciasCliente(verticaisPermitidas(req.user));
  }

  @Get('resumo')
  resumo(@Query() filters: ListAtendimentosDto, @Req() req: Req) {
    return this.atendimentosService.resumo(filters, verticaisPermitidas(req.user));
  }

  // ---------- Apoio ao formulário de nova ocorrência ----------
  @Protegido('atendimentos_criar')
  @Get('busca/contas')
  buscarContas(@Query('q') q = '') {
    return this.atendimentosService.buscarContas(q);
  }

  @Protegido('atendimentos_criar')
  @Get('busca/clientes')
  buscarClientes(@Query('q') q = '') {
    return this.atendimentosService.buscarClientes(q);
  }

  @Protegido('atendimentos_criar')
  @Get('busca/placa')
  historicoPlaca(@Query('placa') placa = '') {
    return this.atendimentosService.historicoPlaca(placa);
  }

  @Protegido('atendimentos_criar')
  @Get('sugestao-prestadores')
  sugerirPrestadores(@Query('uf') uf = '', @Query('cidade') cidade?: string) {
    if (!/^[A-Za-z]{2}$/.test(uf)) return { escopo: 'estado', itens: [] };
    return this.atendimentosService.sugerirPrestadores(cidade || undefined, uf);
  }

  @Protegido('atendimentos_criar')
  @Post()
  async criar(@Body() dto: NovaOcorrenciaDto, @Req() req: Req) {
    const r = await this.atendimentosService.criar(dto, req.user);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `ocorrência registrada ${r.id} (${r.vertical})` });
    return r;
  }

  @Protegido('atendimentos_criar')
  @Patch(':id/encerramento')
  async encerrar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EncerramentoDto, @Req() req: Req) {
    const r = await this.atendimentosService.encerrar(id, dto, req.user);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `atendimento ${id} encerrado: ${dto.status}${dto.motivo ? ' / ' + dto.motivo : ''}` });
    return r;
  }

  /** Edição direta na linha expandida do painel */
  @Protegido('atendimentos_criar')
  @Patch(':id')
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EdicaoAtendimentoDto, @Req() req: Req) {
    const r = await this.atendimentosService.editar(id, dto, req.user);
    if (r.mudancas.length) {
      this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `atendimento ${id} editado: ${r.mudancas.join(' · ')}`.slice(0, 500) });
    }
    return r;
  }

  @Protegido('atendimentos_criar')
  @Patch(':id/linha-do-tempo')
  marcar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarcoDto, @Req() req: Req) {
    return this.atendimentosService.marcar(id, dto, req.user);
  }

  /** Observações peculiares em aberto — notificação da supervisão e lista da aba Fechamentos. */
  @Get('observacoes-peculiares/abertas')
  observacoesPeculiares(@Req() req: Req) {
    return this.atendimentosService.observacoesPeculiares(false);
  }

  /** Marca uma observação peculiar (ex.: valor acordado no momento) — vai para a supervisão/Fechamentos. */
  @Protegido('atendimentos_criar')
  @Post(':id/observacao-peculiar')
  async marcarObs(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { texto?: string }, @Req() req: Req) {
    const r = await this.atendimentosService.marcarObservacaoPeculiar(id, dto?.texto ?? '', req.user);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `atendimento ${id}: observação peculiar registrada (supervisão notificada) — ${(dto?.texto ?? '').slice(0, 160)}` });
    return r;
  }

  /** Supervisão/ADM marca a observação peculiar como resolvida. */
  @Post(':id/observacao-peculiar/resolver')
  async resolverObs(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    if (req.user.papel !== 'ADMIN' && req.user.funcao !== 'SUPERVISAO' && !temPermissao(req.user, 'equipe')) {
      return { erro: 'Só a supervisão ou o administrador resolve observações peculiares' };
    }
    const r = await this.atendimentosService.resolverObservacaoPeculiar(id, req.user);
    this.auditoria.registrar('CADASTRO_ALTERADO', { ip: req.ip, usuario: req.user.email, detalhe: `atendimento ${id}: observação peculiar resolvida` });
    return r;
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    const a = await this.atendimentosService.findOne(id, verticaisPermitidas(req.user));
    return this.atendimentosService.ocultarValores(a, temPermissao(req.user, 'valores'));
  }
}
