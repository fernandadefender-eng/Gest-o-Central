import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Vertical } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { temPermissao, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { ListAtendimentosDto } from './list-atendimentos.dto';
import { NovaOcorrenciaDto } from './nova-ocorrencia.dto';
import { EncerramentoDto, MarcoDto } from './encerramento.dto';
import { EdicaoAtendimentoDto } from './edicao.dto';
import { horaBrasilia } from '../classification/classification.service';
import { carregarBloqueio } from '../geo/bloqueio';
import { proximoIdInterno } from './identificador';

const CAMPOS_DE_VALOR = ['valorPrestador', 'valorTotalPrestador', 'valorCliente', 'formaPagamento'] as const;

@Injectable()
export class AtendimentosService {
  constructor(private readonly prisma: PrismaService) {}

  /** `verticais`: linhas de negócio liberadas ao usuário (restrição de acesso, não só filtro). */
  /**
   * Busca no banco (não só no que está carregado na tela). O campo escolhido limita
   * onde procurar: ID do acionamento, cliente, estabelecimento, técnico em campo,
   * operador do Help Desk (Laysla, Eliane...), cidade ou placa.
   */
  private filtroDeBusca(termo: string, campo: ListAtendimentosDto['campo']): Prisma.AtendimentoWhereInput | undefined {
    const t = termo.trim();
    if (!t) return undefined;
    const contem = { contains: t, mode: 'insensitive' as const };
    const digitos = t.replace(/\D/g, '');
    const porId: Prisma.AtendimentoWhereInput = {
      OR: [
        ...(digitos ? [{ idPR7: digitos }, { idPR7: contem }] : []),
        { idInterno: contem },
        { ocorrencia: contem },
        { codigoValidacao: contem },
        { sap: contem },
      ],
    };
    const porCliente: Prisma.AtendimentoWhereInput = {
      OR: [{ client: { name: contem } }, { empresa: { OR: [{ razaoSocial: contem }, { nomeFantasia: contem }] } }],
    };
    const porEstabelecimento: Prisma.AtendimentoWhereInput = {
      OR: [{ conta: { estabelecimento: contem } }, { conta: { codigo: contem } }],
    };
    const porTecnico: Prisma.AtendimentoWhereInput = {
      OR: [{ agenteNome: contem }, { provider: { OR: [{ name: contem }, { apelido: contem }] } }],
    };
    const porOperador: Prisma.AtendimentoWhereInput = { operadorPR7: contem };
    const porCidade: Prisma.AtendimentoWhereInput = { conta: { OR: [{ cidade: contem }, { estado: contem }] } };
    const porPlaca: Prisma.AtendimentoWhereInput = { placa: { contains: t.toUpperCase().replace(/[^A-Z0-9]/g, ''), mode: 'insensitive' } };

    switch (campo) {
      case 'id': return porId;
      case 'cliente': return porCliente;
      case 'estabelecimento': return porEstabelecimento;
      case 'tecnico': return porTecnico;
      case 'operador': return porOperador;
      case 'cidade': return porCidade;
      case 'placa': return porPlaca;
      default:
        return { OR: [porId, porCliente, porEstabelecimento, porTecnico, porOperador, porCidade, porPlaca] };
    }
  }

  buildWhere(filters: ListAtendimentosDto, verticais: Vertical[]): Prisma.AtendimentoWhereInput {
    const busca = filters.busca ? this.filtroDeBusca(filters.busca, filters.campo) : undefined;
    return {
      ...(busca ? { AND: [busca] } : {}),
      clientId: filters.clientId,
      status: filters.status,
      category: filters.category,
      vertical: { in: filters.vertical ? verticais.filter((v) => v === filters.vertical) : verticais },
      createdAt:
        filters.from || filters.to
          ? {
              gte: filters.from ? new Date(filters.from) : undefined,
              lte: filters.to ? new Date(filters.to) : undefined,
            }
          : undefined,
    };
  }

  /** Remove valores financeiros de quem não tem a permissão "valores". */
  ocultarValores<T extends Record<string, unknown>>(item: T, podeVerValores: boolean): T {
    if (podeVerValores) return item;
    const copia: Record<string, unknown> = { ...item };
    for (const c of CAMPOS_DE_VALOR) delete copia[c];
    return copia as T;
  }

  /** `limite` evita mandar a base inteira para o painel; o relatório passa sem limite. */
  list(filters: ListAtendimentosDto, verticais: Vertical[], limite?: number) {
    return this.prisma.atendimento.findMany({
      where: this.buildWhere(filters, verticais),
      include: { client: true, provider: true, conta: true },
      // Pela data do PEDIDO: um registro criado hoje de um atendimento de dias atrás
      // (reprocessamento, importação) aparece no dia em que aconteceu
      orderBy: [{ solicitadoEm: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limite,
    });
  }

  /**
   * "Quem atende nessa região" para vários atendimentos de uma vez: agrupa por
   * cidade/UF e consulta cada região uma única vez. Só para chamados em aberto
   * sem prestador — é quando a operação precisa decidir quem acionar.
   */
  async anexarQuemAtende<T extends { status: string; provider?: unknown; conta?: { cidade: string; estado: string } | null; detalhes?: unknown }>(itens: T[], porRegiao = 3) {
    const cache = new Map<string, Promise<{ escopo: string; itens: Record<string, unknown>[] }>>();
    return Promise.all(itens.map(async (a) => {
      if ((a.status !== 'NOVO' && a.status !== 'EM_ANDAMENTO') || a.provider) return a;
      const d = (a.detalhes ?? {}) as Record<string, string>;
      const cidade = a.conta?.cidade ?? d.cidade;
      const uf = (a.conta?.estado ?? d.estado ?? '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(uf)) return { ...a, quemAtende: null };
      const chave = `${(cidade ?? '').toLowerCase()}|${uf}`;
      if (!cache.has(chave)) cache.set(chave, this.sugerirPrestadores(cidade || undefined, uf));
      const r = await cache.get(chave)!;
      return { ...a, quemAtende: { escopo: r.escopo, cidade, uf, itens: r.itens.slice(0, porRegiao) } };
    }));
  }

  /** Acionamentos em aberto que chegaram depois de `desde` (painel consulta a cada poucos segundos). */
  async acionamentosDesde(desde: Date, verticais: Vertical[]) {
    const itens = await this.prisma.atendimento.findMany({
      where: {
        createdAt: { gt: desde }, status: { in: ['NOVO', 'EM_ANDAMENTO'] }, vertical: { in: verticais },
        // Só avisa o que acabou de chegar de verdade: WhatsApp ou registro no painel.
        // Histórico importado de planilha nunca vira alerta de acionamento novo.
        OR: [
          { conversationId: { not: null } },
          { detalhes: { path: ['registradoPor'], not: Prisma.DbNull } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, createdAt: true, vertical: true, status: true, category: true, ocorrencia: true, summary: true, placa: true, detalhes: true,
        idPR7: true, idInterno: true, conversationId: true,
        client: { select: { name: true } },
        provider: { select: { name: true } },
        conta: { select: { estabelecimento: true, cidade: true, estado: true } },
      },
    });
    const enxutos = itens.map((a) => {
      const d = (a.detalhes ?? {}) as Record<string, unknown>;
      return { ...a, origem: a.conversationId ? 'WHATSAPP' : 'PAINEL', detalhes: { cidade: d.cidade, estado: d.estado } };
    });
    return { agora: new Date().toISOString(), itens: await this.anexarQuemAtende(enxutos, 4) };
  }

  /** Versão leve para a tabela do painel: só as colunas exibidas (o detalhe completo vem de findOne). */
  async listaResumida(filters: ListAtendimentosDto, verticais: Vertical[], limite: number) {
    const itens = await this.prisma.atendimento.findMany({
      where: this.buildWhere(filters, verticais),
      // Pela data do PEDIDO (a de criação do registro é técnica: importação/reprocessamento)
      orderBy: [{ solicitadoEm: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limite,
      select: {
        id: true, createdAt: true, solicitadoEm: true, vertical: true, status: true, category: true, ocorrencia: true,
        idPR7: true, idInterno: true,
        summary: true, agenteNome: true, placa: true,
        client: { select: { name: true } },
        provider: { select: { name: true } },
        conta: { select: { estabelecimento: true, cidade: true, estado: true } },
        // Só cidade/UF do JSON (evita mandar observação interna e demais detalhes na lista)
        detalhes: true,
      },
    });
    const enxutos = itens.map((a) => {
      const d = (a.detalhes ?? {}) as Record<string, unknown>;
      return { ...a, summary: a.summary?.slice(0, 160) ?? null, detalhes: { cidade: d.cidade, estado: d.estado } };
    });
    return this.anexarQuemAtende(enxutos, 1);
  }

  /** Totais por status contados no banco, para os cards do painel. */
  async resumo(filters: ListAtendimentosDto, verticais: Vertical[]) {
    const grupos = await this.prisma.atendimento.groupBy({
      by: ['status'],
      where: this.buildWhere(filters, verticais),
      _count: { _all: true },
    });
    const porStatus = Object.fromEntries(grupos.map((g) => [g.status, g._count._all]));
    const total = grupos.reduce((soma, g) => soma + g._count._all, 0);
    return { total, porStatus };
  }

  // ---------- Nova ocorrência ----------

  /** Autocomplete: contas por código, estabelecimento, cidade ou cliente. */
  buscarContas(q: string) {
    const termo = q.trim();
    if (termo.length < 2) return [];
    return this.prisma.conta.findMany({
      where: {
        OR: [
          { codigo: { contains: termo, mode: 'insensitive' } },
          { estabelecimento: { contains: termo, mode: 'insensitive' } },
          { cidade: { contains: termo, mode: 'insensitive' } },
          { client: { name: { contains: termo, mode: 'insensitive' } } },
        ],
      },
      take: 10,
      orderBy: { atendimentos: { _count: 'desc' } },
      select: { id: true, codigo: true, estabelecimento: true, endereco: true, cidade: true, estado: true, client: { select: { id: true, name: true } } },
    });
  }

  buscarClientes(q: string) {
    const termo = q.trim();
    if (termo.length < 2) return [];
    return this.prisma.client.findMany({
      where: { name: { contains: termo, mode: 'insensitive' } },
      take: 10,
      orderBy: { atendimentos: { _count: 'desc' } },
      select: { id: true, name: true },
    });
  }

  /** Placa já atendida antes: puxa cliente, modelo e dados do veículo do último atendimento. */
  async historicoPlaca(placa: string) {
    const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 7) return null;
    return this.prisma.atendimento.findFirst({
      where: { placa: p },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, detalhes: true, client: { select: { id: true, name: true } } },
    });
  }

  /** Prestadores que já atenderam na cidade (ou no estado), os mais experientes primeiro. */
  async sugerirPrestadores(cidade: string | undefined, uf: string): Promise<{ escopo: 'cidade' | 'estado'; itens: Record<string, unknown>[] }> {
    const UF = uf.toUpperCase();
    const areas = await this.prisma.providerArea.findMany({
      where: {
        estado: { equals: UF, mode: 'insensitive' },
        ...(cidade ? { cidade: { equals: cidade.trim(), mode: 'insensitive' } } : {}),
        // Restritos nunca aparecem como sugestão
        provider: { status: { not: 'RESTRITO' } },
      },
      orderBy: [{ atendimentos: 'desc' }],
      take: 40,
      select: {
        cidade: true, atendimentos: true, ultimoAtendimento: true,
        provider: { select: { id: true, name: true, apelido: true, phone: true, tipo: true, status: true, _count: { select: { membros: true } } } },
      },
    });
    // Sem ninguém na cidade: amplia para o estado inteiro
    if (!areas.length && cidade) return { escopo: 'estado', itens: (await this.sugerirPrestadores(undefined, UF)).itens };
    const bloqueio = await carregarBloqueio(this.prisma);
    const vistos = new Set<string>();
    const itens = areas
      // Lista de bloqueio: também barra quem não está marcado como RESTRITO no cadastro
      .filter((a) => !bloqueio.verificar(a.provider.name, a.provider.phone))
      .filter((a) => !vistos.has(a.provider.id) && vistos.add(a.provider.id))
      // Ativos primeiro, depois por experiência na região
      .sort((a, b) => Number(b.provider.status === 'ATIVO') - Number(a.provider.status === 'ATIVO') || b.atendimentos - a.atendimentos)
      .slice(0, 8)
      .map((a) => ({ ...a.provider, membros: a.provider._count.membros, cidade: a.cidade, atendimentosNaRegiao: a.atendimentos, ultimoAtendimento: a.ultimoAtendimento }));
    return { escopo: cidade ? 'cidade' : 'estado', itens };
  }

  async criar(dto: NovaOcorrenciaDto, u: UsuarioLogado) {
    if (!verticaisPermitidas(u).includes(dto.vertical)) throw new ForbiddenException('Vertical não liberada para o seu usuário');

    return this.prisma.$transaction(async (tx) => {
      // Cliente
      let clientId = dto.clienteId;
      if (!clientId) {
        const nome = dto.clienteNome!;
        const c = await tx.client.upsert({ where: { phone: `import:${nome}` }, create: { phone: `import:${nome}`, name: nome }, update: {} });
        clientId = c.id;
      } else if (!(await tx.client.count({ where: { id: clientId } }))) throw new BadRequestException('Cliente não encontrado');

      // Conta (Patrimonial). Endereço de conta existente nunca é alterado aqui (ver model Conta).
      let contaId: string | null = null;
      let local = { cidade: dto.cidade, estado: dto.estado };
      if (dto.vertical === 'PATRIMONIAL') {
        if (dto.contaId) {
          const conta = await tx.conta.findUnique({ where: { id: dto.contaId } });
          if (!conta) throw new BadRequestException('Conta não encontrada');
          contaId = conta.id;
          local = { cidade: conta.cidade, estado: conta.estado };
        } else if (dto.novaConta) {
          const n = dto.novaConta;
          const codigo = n.codigo || `${n.estabelecimento}|${n.cidade}|${n.estado}`;
          const existente = await tx.conta.findUnique({ where: { codigo } });
          const conta = existente ?? (await tx.conta.create({ data: { codigo, clientId, estabelecimento: n.estabelecimento, endereco: n.endereco ?? '', cidade: n.cidade, estado: n.estado } }));
          contaId = conta.id;
          local = { cidade: conta.cidade, estado: conta.estado };
        } else throw new BadRequestException('Informe a conta ou o estabelecimento');
      }

      const bloqueio = await carregarBloqueio(this.prisma);
      if (dto.agenteNome && bloqueio.verificar(dto.agenteNome)) {
        throw new BadRequestException(`${dto.agenteNome} está na lista de RESTRITOS — não pode ir a campo`);
      }
      if (dto.prestadorId) {
        const prest = await tx.provider.findUnique({ where: { id: dto.prestadorId }, select: { status: true, motivoRestricao: true, name: true, phone: true } });
        if (!prest) throw new BadRequestException('Prestador não encontrado');
        if (prest.status === 'RESTRITO') throw new BadRequestException(`Prestador RESTRITO — não pode atender${prest.motivoRestricao ? ` (${prest.motivoRestricao})` : ''}`);
        if (bloqueio.verificar(prest.name, prest.phone)) throw new BadRequestException('Prestador está na lista de RESTRITOS — não pode atender');
        if (dto.agenteNome) {
          const nome = dto.agenteNome.trim();
          const agente = await tx.providerMembro.findFirst({
            where: { providerId: dto.prestadorId, restrito: true, OR: [{ nomeCompleto: { equals: nome, mode: 'insensitive' } }, { nome: { equals: nome, mode: 'insensitive' } }, { apelido: { equals: nome, mode: 'insensitive' } }] },
          });
          if (agente) throw new BadRequestException(`Agente ${nome} está RESTRITO — não pode ir a campo`);
        }
      }
      const podeValores = temPermissao(u, 'valores');

      // Chamado aberto aqui não tem ID do sistema antigo: nasce com o nosso
      const idInterno = await proximoIdInterno(this.prisma);
      return tx.atendimento.create({
        data: {
          idInterno,
          vertical: dto.vertical, clientId, contaId, ocorrencia: dto.ocorrencia || null,
          category: dto.tipoServico, summary: dto.motivo, status: dto.status ?? (dto.prestadorId ? 'EM_ANDAMENTO' : 'NOVO'),
          providerId: dto.prestadorId ?? null, agenteNome: dto.agenteNome ?? null, operadorPR7: u.nome,
          // Registro manual: o pedido é agora; se já escolheu prestador, o acionamento também
          solicitadoEm: new Date(), acionadoEm: dto.prestadorId ? new Date() : null,
          placa: dto.placa ?? null, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
          valorPrestador: podeValores && dto.valorPrestador != null ? new Prisma.Decimal(dto.valorPrestador.toFixed(2)) : null,
          valorCliente: podeValores && dto.valorCliente != null ? new Prisma.Decimal(dto.valorCliente.toFixed(2)) : null,
          detalhes: { ...(dto.detalhes ?? {}), cidade: local.cidade, estado: local.estado, canal: dto.canal, registradoPor: u.email } as Prisma.InputJsonValue,
        },
        select: { id: true, vertical: true, status: true, createdAt: true },
      });
    });
  }

  // ---------- Encerramento e linha do tempo ----------

  private async buscarPermitido(id: string, verticais: Vertical[]) {
    const a = await this.prisma.atendimento.findFirst({ where: { id, vertical: { in: verticais } } });
    if (!a) throw new NotFoundException('Atendimento não encontrado');
    return a;
  }

  /** Alertas veiculares divulgados (só para quem tem a vertical VEICULAR). Busca por placa, chassi, modelo ou local. */
  alertasVeiculares(verticais: Vertical[], busca?: string) {
    if (!verticais.includes('VEICULAR')) return [];
    const b = busca?.trim();
    const placa = b?.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.prisma.alertaVeicular.findMany({
      where: b ? { OR: [
        ...(placa ? [{ placa: { contains: placa } }, { chassi: { contains: placa } }] : []),
        { descricao: { contains: b, mode: 'insensitive' } }, { localOcorrencia: { contains: b, mode: 'insensitive' } },
      ] } : {},
      orderBy: { divulgadoEm: 'desc' },
      take: 200,
      select: { id: true, tipo: true, placa: true, chassi: true, descricao: true, cor: true, anoModelo: true, localOcorrencia: true, latitude: true, longitude: true, dataHoraTexto: true, divulgadoEm: true, grupo: true, status: true },
    });
  }

  /** Não atendidos sem motivo (ex.: retorno incompleto do prestador): o painel cobra em pop-up. */
  pendenciasMotivo(verticais: Vertical[]) {
    return this.prisma.atendimento.findMany({
      where: { status: 'NAO_ATENDIDO', motivoNaoAtendimento: null, vertical: { in: verticais } },
      orderBy: { encerradoEm: 'asc' },
      take: 20,
      select: {
        id: true, idPR7: true, ocorrencia: true, category: true, vertical: true, detalhes: true, encerradoEm: true, agenteNome: true,
        client: { select: { name: true } }, provider: { select: { id: true, name: true } },
        conta: { select: { codigo: true, estabelecimento: true, cidade: true, estado: true } },
      },
    });
  }

  /**
   * Cliente aguardando: chamado novo (WhatsApp ou painel) há mais de 10 min sem
   * prestador acionado. Só as últimas 24 h — o histórico importado não entra.
   */
  pendenciasCliente(verticais: Vertical[]) {
    const agora = Date.now();
    return this.prisma.atendimento.findMany({
      where: {
        status: 'NOVO', acionadoEm: null, providerId: null, vertical: { in: verticais },
        OR: [{ conversationId: { not: null } }, { detalhes: { path: ['registradoPor'], not: Prisma.DbNull } }],
        AND: [
          { OR: [{ solicitadoEm: { lte: new Date(agora - 10 * 60000) } }, { solicitadoEm: null, createdAt: { lte: new Date(agora - 10 * 60000) } }] },
          { OR: [{ solicitadoEm: { gte: new Date(agora - 24 * 3600e3) } }, { solicitadoEm: null, createdAt: { gte: new Date(agora - 24 * 3600e3) } }] },
        ],
      },
      orderBy: [{ solicitadoEm: 'asc' }, { createdAt: 'asc' }],
      take: 20,
      select: {
        id: true, idPR7: true, idInterno: true, ocorrencia: true, category: true, vertical: true, placa: true, solicitadoEm: true, createdAt: true,
        client: { select: { name: true } }, conta: { select: { codigo: true, estabelecimento: true, cidade: true, estado: true } },
        conversation: { select: { groupName: true } },
      },
    });
  }

  /**
   * Edição do chamado na linha expandida do painel. Só grava o que veio no corpo e
   * registra na tratativa do evento quem mudou o quê (a operação revisa o que a IA montou).
   */
  async editar(id: string, dto: EdicaoAtendimentoDto, u: UsuarioLogado) {
    const a = await this.buscarPermitido(id, verticaisPermitidas(u));
    const agora = new Date();
    const data: Prisma.AtendimentoUncheckedUpdateInput = {};
    const mudancas: string[] = [];
    const ROTULOS: Record<string, string> = {
      status: 'status', motivo: 'motivo', detalheNaoAtendimento: 'detalhe do motivo', category: 'serviço', ocorrencia: 'ocorrência',
      idPR7: 'ID PR7', codigoValidacao: 'validação', sap: 'SAP', placa: 'placa', operadorPR7: 'operador PR7', agenteNome: 'técnico/agente',
      responsavelLocalNome: 'responsável no local', responsavelLocalTelefone: 'telefone do responsável', summary: 'resumo', resultado: 'relato',
      solicitadoEm: 'hora da solicitação', autorizacaoPedidaEm: 'autorização pedida', liberadoEm: 'liberação do cliente',
      acionadoEm: 'acionamento', chegadaEm: 'chegada ao local', concluidoEm: 'término', vertical: 'vertical',
    };
    const anotar = (campo: string, valor: unknown) => {
      const antes = (a as Record<string, unknown>)[campo];
      const igual = antes instanceof Date ? valor instanceof Date && +antes === +valor : (antes ?? null) === (valor ?? null);
      if (igual) return;
      mudancas.push(`${ROTULOS[campo] ?? campo}: ${antes instanceof Date ? horaBrasilia(antes) : antes ?? '—'} → ${valor instanceof Date ? horaBrasilia(valor) : valor ?? '—'}`);
      (data as Record<string, unknown>)[campo] = valor;
    };

    for (const campo of ['category', 'ocorrencia', 'idPR7', 'codigoValidacao', 'sap', 'placa', 'operadorPR7', 'agenteNome', 'responsavelLocalNome', 'responsavelLocalTelefone', 'summary', 'resultado', 'vertical'] as const) {
      if (campo in dto) anotar(campo, dto[campo] ?? null);
    }
    for (const campo of ['solicitadoEm', 'autorizacaoPedidaEm', 'liberadoEm', 'acionadoEm', 'chegadaEm', 'concluidoEm'] as const) {
      if (campo in dto) anotar(campo, dto[campo] ? new Date(dto[campo] as string) : null);
    }

    const status = dto.status ?? a.status;
    const encerra = ['CONCLUIDO', 'CANCELADO', 'NAO_ATENDIDO'].includes(status);
    if (dto.status) anotar('status', dto.status);
    if (encerra) {
      const motivo = status === 'CONCLUIDO' ? null : dto.motivo ?? a.motivoNaoAtendimento ?? null;
      if (status !== 'CONCLUIDO' && !motivo) throw new BadRequestException('Informe o motivo do não atendimento');
      if (motivo !== a.motivoNaoAtendimento) anotar('motivo', motivo), (data.motivoNaoAtendimento = motivo);
      if ('detalheNaoAtendimento' in dto) anotar('detalheNaoAtendimento', dto.detalheNaoAtendimento ?? null);
      // Cancelamento sem detalhe: registra em quanto tempo o cliente cancelou
      if (status === 'CANCELADO' && !(data.detalheNaoAtendimento ?? a.detalheNaoAtendimento)) {
        const fim = (data.encerradoEm as Date) ?? (dto.concluidoEm ? new Date(dto.concluidoEm) : agora);
        const inicio = (data.solicitadoEm as Date) ?? a.solicitadoEm ?? a.createdAt;
        data.detalheNaoAtendimento = `Cliente cancelou ${Math.max(0, Math.round((+fim - +inicio) / 60000))} min após a solicitação`;
      }
      if (status === 'CONCLUIDO') { data.motivoNaoAtendimento = null; data.detalheNaoAtendimento = null; }
      if (!a.encerradoEm || dto.status) { data.encerradoPor = u.email; data.encerradoEm = a.encerradoEm ?? agora; }
      if (status === 'CONCLUIDO' && !(data.concluidoEm ?? a.concluidoEm)) data.concluidoEm = agora;
    } else if (a.encerradoEm) {
      // Reabriu o chamado: limpa o encerramento
      Object.assign(data, { motivoNaoAtendimento: null, detalheNaoAtendimento: null, encerradoPor: null, encerradoEm: null });
      mudancas.push('chamado reaberto');
    }

    const detalhes = { ...((a.detalhes ?? {}) as Record<string, unknown>) };
    if ('observacaoInterna' in dto) {
      if (dto.observacaoInterna) detalhes.observacaoInterna = dto.observacaoInterna;
      else delete detalhes.observacaoInterna;
      mudancas.push('observação interna');
    }
    if ('valorPrestador' in dto) {
      if (!temPermissao(u, 'valores')) throw new ForbiddenException('Seu usuário não tem acesso a valores');
      const novo = dto.valorPrestador == null ? null : new Prisma.Decimal(Number(dto.valorPrestador).toFixed(2));
      if (String(novo ?? '') !== String(a.valorPrestador ?? '')) {
        data.valorPrestador = novo;
        // Valor da operação prevalece: o cálculo automático não mexe mais neste chamado
        detalhes.valorManual = { por: u.email, em: agora.toISOString(), antes: a.valorPrestador?.toString() ?? null };
        mudancas.push(`valor ao prestador: R$ ${a.valorPrestador ?? '—'} → R$ ${novo ?? '—'}`);
      }
    }
    if (!mudancas.length) return { id, status: a.status, mudancas: [] };
    Object.assign(detalhes, { aguardandoRevisao: false, pendenteMotivo: false, revisadoPor: u.email, revisadoEm: agora.toISOString() });
    data.detalhes = detalhes as Prisma.InputJsonValue;

    const salvo = await this.prisma.atendimento.update({ where: { id }, data, select: { id: true, status: true } });
    const evento = await this.prisma.evento.findUnique({ where: { atendimentoId: id } });
    if (evento) {
      await this.prisma.eventoTratativa.create({
        data: { eventoId: evento.id, tipo: 'NOTA', usuario: u.email, texto: `Editado no painel — ${mudancas.join(' · ')}`.slice(0, 1000) },
      });
      const desfecho = status === 'CONCLUIDO' ? 'ATENDIMENTO_REALIZADO'
        : status === 'CANCELADO' ? 'CANCELADO_CLIENTE'
        : (data.motivoNaoAtendimento ?? a.motivoNaoAtendimento) === 'SEM_PRESTADOR_REGIAO' ? 'SEM_PRESTADOR'
        : (data.motivoNaoAtendimento ?? a.motivoNaoAtendimento) === 'FALSO_ALARME' ? 'FALSO_ALARME'
        : (data.motivoNaoAtendimento ?? a.motivoNaoAtendimento) === 'DUPLICADO' ? 'DUPLICADO' : 'SEM_CONTATO';
      await this.prisma.evento.update({
        where: { id: evento.id },
        data: encerra
          ? { status: 'ENCERRADO', desfecho: desfecho as never, encerradoPor: u.email, encerradoEm: evento.encerradoEm ?? agora }
          : evento.status === 'ENCERRADO' ? { status: 'EM_TRATATIVA', desfecho: null, encerradoPor: null, encerradoEm: null } : {},
      });
    }
    return { ...salvo, mudancas };
  }

  async encerrar(id: string, dto: EncerramentoDto, u: UsuarioLogado) {
    const a = await this.buscarPermitido(id, verticaisPermitidas(u));
    if (dto.recusadoPorId && !(await this.prisma.provider.count({ where: { id: dto.recusadoPorId } }))) {
      throw new BadRequestException('Prestador da negativa não encontrado');
    }
    const agora = new Date();
    const naoAtendido = dto.status !== 'CONCLUIDO';
    return this.prisma.atendimento.update({
      where: { id },
      data: {
        status: dto.status,
        motivoNaoAtendimento: naoAtendido ? dto.motivo : null,
        // Cancelado: registra em quanto tempo o cliente cancelou (base de análise de demora)
        detalheNaoAtendimento: !naoAtendido ? null
          : dto.status === 'CANCELADO' || dto.motivo === 'CANCELADO_CLIENTE'
            ? [`Cliente cancelou ${Math.max(0, Math.round((+agora - +(a.solicitadoEm ?? a.createdAt)) / 60000))} min após a solicitação`, dto.detalhe].filter(Boolean).join(' — ')
            : dto.detalhe ?? null,
        recusadoPorId: naoAtendido && dto.motivo === 'NEGATIVA_PRESTADOR' ? dto.recusadoPorId ?? a.providerId : null,
        // Negativa: quem recusou não fica como prestador que atendeu
        ...(naoAtendido && dto.motivo === 'NEGATIVA_PRESTADOR' && (dto.recusadoPorId ?? a.providerId) === a.providerId ? { providerId: null } : {}),
        ...(dto.status === 'CONCLUIDO' ? { concluidoEm: a.concluidoEm ?? agora, resultado: dto.detalhe ?? a.resultado } : {}),
        encerradoPor: u.email,
        encerradoEm: agora,
        // Motivo informado: sai da lista de pendências do pop-up
        detalhes: { ...((a.detalhes ?? {}) as Record<string, unknown>), pendenteMotivo: false } as Prisma.InputJsonValue,
      },
      select: { id: true, status: true, motivoNaoAtendimento: true },
    });
  }

  async marcar(id: string, dto: MarcoDto, u: UsuarioLogado) {
    const a = await this.buscarPermitido(id, verticaisPermitidas(u));
    const quando = dto.quando && !isNaN(Date.parse(dto.quando)) ? new Date(dto.quando) : new Date();
    const campo = { acionado: 'acionadoEm', chegada: 'chegadaEm', concluido: 'concluidoEm' }[dto.marco] as 'acionadoEm' | 'chegadaEm' | 'concluidoEm';
    return this.prisma.atendimento.update({
      where: { id },
      data: {
        [campo]: quando,
        ...(dto.marco === 'acionado' && a.status === 'NOVO' ? { status: 'EM_ANDAMENTO' } : {}),
        ...(dto.marco === 'concluido' ? { status: 'CONCLUIDO', encerradoPor: u.email, encerradoEm: new Date() } : {}),
      },
      select: { id: true, status: true, solicitadoEm: true, acionadoEm: true, chegadaEm: true, concluidoEm: true },
    });
  }

  async findOne(id: string, verticais: Vertical[]) {
    const a = await this.prisma.atendimento.findFirst({
      where: { id, vertical: { in: verticais } },
      include: {
        client: true,
        provider: true,
        conta: true,
        conversation: { include: { messages: { orderBy: { sentAt: 'asc' } } } },
        recusadoPor: { select: { id: true, name: true } },
        empresa: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
        midias: { where: { status: 'SALVA' }, orderBy: { recebidaEm: 'asc' }, select: { id: true, tipo: true, legenda: true, mimeType: true, recebidaEm: true, noRelatorio: true } },
      },
    });
    if (!a) throw new NotFoundException('Atendimento não encontrado');
    const [comRegiao] = await this.anexarQuemAtende([a], 6);
    // Placa com alerta divulgado (furto/roubo): mostra na ficha do chamado
    const alertasDaPlaca = a.placa
      ? await this.prisma.alertaVeicular.findMany({ where: { placa: a.placa }, orderBy: { divulgadoEm: 'desc' }, take: 5, select: { tipo: true, divulgadoEm: true, grupo: true, localOcorrencia: true, status: true } })
      : [];
    return { ...comRegiao, alertasDaPlaca };
  }

  /**
   * Observação peculiar do atendimento (ex.: valor acordado no momento). Fica marcada,
   * a supervisão é notificada (aparece na lista) e o chamado vai para a aba Fechamentos.
   */
  async marcarObservacaoPeculiar(id: string, texto: string, u: UsuarioLogado) {
    const a = await this.buscarPermitido(id, verticaisPermitidas(u));
    const t = (texto ?? '').trim();
    if (!t) throw new BadRequestException('Escreva a observação (ex.: valor acordado no momento)');
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    const obs = { texto: t.slice(0, 1000), por: u.email, em: new Date().toISOString(), resolvida: false as boolean, resolvidaPor: null as string | null, resolvidaEm: null as string | null };
    await this.prisma.atendimento.update({ where: { id }, data: { detalhes: { ...det, observacaoPeculiar: obs } as Prisma.InputJsonValue } });
    return { ok: true };
  }

  async resolverObservacaoPeculiar(id: string, u: UsuarioLogado) {
    const a = await this.prisma.atendimento.findUnique({ where: { id }, select: { detalhes: true } });
    if (!a) throw new NotFoundException('Atendimento não encontrado');
    const det = (a.detalhes ?? {}) as Record<string, unknown>;
    const obs = det.observacaoPeculiar as Record<string, unknown> | undefined;
    if (!obs) throw new BadRequestException('Este atendimento não tem observação peculiar');
    await this.prisma.atendimento.update({ where: { id }, data: { detalhes: { ...det, observacaoPeculiar: { ...obs, resolvida: true, resolvidaPor: u.email, resolvidaEm: new Date().toISOString() } } as Prisma.InputJsonValue } });
    return { ok: true };
  }

  /** Observações peculiares em aberto (para a supervisão e a aba Fechamentos). */
  async observacoesPeculiares(incluirResolvidas = false) {
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; idpr7: string | null; idinterno: string | null; cliente: string | null; obs: any; data: Date }[]>(`
      SELECT a.id, a."idPR7" idpr7, a."idInterno" idinterno,
             coalesce(e."nomeFantasia", cl.name) cliente,
             a.detalhes->'observacaoPeculiar' obs, coalesce(a."solicitadoEm", a."createdAt") data
        FROM "Atendimento" a
        LEFT JOIN "Empresa" e ON e.id = a."empresaId"
        LEFT JOIN "Client" cl ON cl.id = a."clientId"
       WHERE a.detalhes ? 'observacaoPeculiar'
         ${incluirResolvidas ? '' : `AND coalesce((a.detalhes->'observacaoPeculiar'->>'resolvida')::boolean, false) = false`}
       ORDER BY data DESC LIMIT 300`);
    return rows.map((r) => ({
      id: r.id, ref: r.idpr7 ?? r.idinterno ?? r.id.slice(0, 8), cliente: r.cliente, data: r.data,
      texto: r.obs?.texto ?? '', por: r.obs?.por ?? '', em: r.obs?.em ?? null,
      resolvida: !!r.obs?.resolvida, resolvidaPor: r.obs?.resolvidaPor ?? null,
    }));
  }
}
