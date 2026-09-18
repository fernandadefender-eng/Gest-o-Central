import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProviderStatus, ProviderTipo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRO_UF } from '../mapa/estados';
import { chaveCidade, normalizar } from './normalizar';

/** Regras do cadastro da operação: nome completo (nome + sobrenome) e telefone com DDD. */
export function pendenciasCadastro(nome: string, telefone: string | null) {
  const p: string[] = [];
  if (nome.trim().split(/\s+/).filter((x) => x.length > 1).length < 2) p.push('Nome sem sobrenome');
  if (!telefone) p.push('Sem telefone');
  return p;
}
import { GeocodificacaoService } from './geocodificacao.service';

export interface FiltroPrestadores {
  busca?: string;
  uf?: string;
  tipo?: ProviderTipo;
  status?: ProviderStatus;
  pendentes?: boolean;
}

@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocodificacao: GeocodificacaoService,
  ) {}

  /** Resolve coordenada da cidade; sem ela, cai no centro do estado (marcado como aproximado). */
  private async resolvedorDeCidades() {
    const cidades = await this.prisma.cidade.findMany({ where: { encontrada: true } });
    const porChave = new Map(cidades.map((c) => [c.chave, c]));
    const lista: [string, string, number, number, 0 | 1][] = [];
    const indice = new Map<string, number>();

    return {
      lista,
      indiceDe: (cidade: string | null, uf: string | null): number => {
        const UF = uf?.toUpperCase() ?? '';
        if (!CENTRO_UF[UF]) return -1;
        const chave = chaveCidade(cidade ?? '', UF);
        if (indice.has(chave)) return indice.get(chave)!;
        const c = porChave.get(chave);
        const item: [string, string, number, number, 0 | 1] = c
          ? [c.nome, UF, c.lat!, c.lng!, 0]
          : [cidade ?? CENTRO_UF[UF].nome, UF, CENTRO_UF[UF].lat, CENTRO_UF[UF].lng, 1];
        indice.set(chave, lista.push(item) - 1);
        return indice.get(chave)!;
      },
      coordenada: (cidade: string, uf: string) => {
        const c = porChave.get(chaveCidade(cidade, uf));
        const centro = CENTRO_UF[uf.toUpperCase()];
        return c ? { lat: c.lat!, lng: c.lng!, aproximada: false } : centro ? { lat: centro.lat, lng: centro.lng, aproximada: true } : null;
      },
    };
  }

  /**
   * Pontos do mapa em formato compacto (arrays), para o painel carregar leve:
   * cada estabelecimento/prestador aponta para um índice da lista de cidades.
   */
  async pontos(incluirEstabelecimentos = true) {
    const cidades = await this.resolvedorDeCidades();

    const estabs = !incluirEstabelecimentos ? [] : await this.prisma.$queryRaw<
      { id: string; estabelecimento: string; cliente: string; cidade: string; estado: string; qtd: bigint; ultimo: Date }[]
    >(Prisma.sql`
      SELECT c.id, c.estabelecimento, cl.name AS cliente, c.cidade, c.estado,
             count(a.id) AS qtd, max(a."createdAt") AS ultimo
      FROM "Conta" c
      JOIN "Client" cl ON cl.id = c."clientId"
      JOIN "Atendimento" a ON a."contaId" = c.id
      GROUP BY c.id, cl.name`);

    const prestadores = await this.prisma.provider.findMany({
      select: {
        id: true, name: true, tipo: true, status: true, cidadeBase: true, estadoBase: true, pendencias: true,
        _count: { select: { atendimentos: true, membros: true, areas: true } },
      },
    });

    return {
      cidades: cidades.lista,
      // [id, estabelecimento, cliente, cidadeIdx, atendimentos, último atendimento (AAAA-MM-DD)]
      estabelecimentos: estabs
        .map((e) => [e.id, e.estabelecimento, e.cliente, cidades.indiceDe(e.cidade, e.estado), Number(e.qtd), e.ultimo?.toISOString().slice(0, 10)])
        .filter((e) => e[3] !== -1),
      // [id, nome, tipo E/I, cidadeIdx, atendimentos, ativo 1/0, membros, cidades atendidas, pendências, restrito 1/0]
      prestadores: prestadores
        .map((p) => [
          p.id, p.name, p.tipo === 'EQUIPE' ? 'E' : 'I', cidades.indiceDe(p.cidadeBase, p.estadoBase),
          p._count.atendimentos, p.status === 'ATIVO' ? 1 : 0, p._count.membros, p._count.areas, p.pendencias.length,
          p.status === 'RESTRITO' ? 1 : 0,
        ])
        .filter((p) => p[3] !== -1),
      localizacao: await this.geocodificacao.progresso(),
    };
  }

  async listarPrestadores(f: FiltroPrestadores) {
    const where: Prisma.ProviderWhereInput = {
      tipo: f.tipo,
      status: f.status,
      ...(f.pendentes ? { NOT: { pendencias: { isEmpty: true } } } : {}),
      ...(f.uf ? { areas: { some: { estado: { equals: f.uf, mode: 'insensitive' } } } } : {}),
      ...(f.busca
        ? {
            OR: [
              { name: { contains: f.busca, mode: 'insensitive' } },
              { phone: { contains: f.busca.replace(/\D/g, '') || f.busca } },
              { cidadeBase: { contains: f.busca, mode: 'insensitive' } },
              { membros: { some: { nome: { contains: f.busca, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, itens] = await Promise.all([
      this.prisma.provider.count({ where }),
      this.prisma.provider.findMany({
        where,
        orderBy: [{ status: 'asc' }, { ultimoAtendimento: { sort: 'desc', nulls: 'last' } }],
        take: 300,
        select: {
          id: true, name: true, phone: true, tipo: true, status: true, cidadeBase: true, estadoBase: true,
          pendencias: true, ultimoAtendimento: true,
          _count: { select: { atendimentos: true, membros: true, areas: true } },
        },
      }),
    ]);
    return { total, itens };
  }

  // ---------- Organograma: adm (prestador) e agentes ----------

  async atualizarPrestador(id: string, dados: { nomeCompleto?: string; apelido?: string; telefone?: string; email?: string }) {
    const atual = await this.prisma.provider.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Prestador não encontrado');
    const name = dados.nomeCompleto ?? atual.name;
    const phone = dados.telefone ?? atual.phone;
    // Recalcula pendências com os dados novos (nome completo e telefone com DDD)
    const pendencias = pendenciasCadastro(name, /^\d{10,11}$/.test(phone) ? phone : null);
    try {
      return await this.prisma.provider.update({
        where: { id },
        data: { name, phone, apelido: dados.apelido ?? atual.apelido, email: dados.email ?? atual.email, pendencias },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Telefone ou e-mail já pertence a outro prestador');
      }
      throw err;
    }
  }

  async salvarMembro(providerId: string, membroId: string | null, dados: { nomeCompleto: string; apelido?: string; telefone?: string; email?: string; ativo?: boolean }) {
    if (!(await this.prisma.provider.count({ where: { id: providerId } }))) throw new NotFoundException('Prestador não encontrado');
    if (membroId) {
      const m = await this.prisma.providerMembro.findFirst({ where: { id: membroId, providerId } });
      if (!m) throw new NotFoundException('Agente não encontrado nesta equipe');
      return this.prisma.providerMembro.update({ where: { id: membroId }, data: dados });
    }
    // Agente novo cadastrado pela operação: o identificador é o próprio nome completo
    return this.prisma.providerMembro.create({ data: { providerId, nome: dados.nomeCompleto, ...dados } });
  }

  // ---------- Restritos: não podem atender ----------

  async restringirPrestador(id: string, restrito: boolean, motivo: string | undefined, quem: string) {
    const p = await this.prisma.provider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Prestador não encontrado');
    return this.prisma.provider.update({
      where: { id },
      data: restrito
        ? { status: 'RESTRITO', motivoRestricao: motivo ?? null, restritoEm: new Date(), restritoPor: quem }
        // Ao liberar, volta para ativo/inativo pela data do último atendimento
        : { status: p.ultimoAtendimento && Date.now() - p.ultimoAtendimento.getTime() < 90 * 864e5 ? 'ATIVO' : 'INATIVO', motivoRestricao: null, restritoEm: null, restritoPor: null },
    });
  }

  async restringirMembro(providerId: string, membroId: string, restrito: boolean, motivo: string | undefined, quem: string) {
    const m = await this.prisma.providerMembro.findFirst({ where: { id: membroId, providerId } });
    if (!m) throw new NotFoundException('Agente não encontrado nesta equipe');
    return this.prisma.providerMembro.update({
      where: { id: membroId },
      data: restrito
        ? { restrito: true, motivoRestricao: motivo ?? null, restritoEm: new Date(), restritoPor: quem }
        : { restrito: false, motivoRestricao: null, restritoEm: null, restritoPor: null },
    });
  }

  /**
   * Aplica uma lista de contatos restritos (telefone e/ou nome). Casa por
   * telefone primeiro (mais seguro); por nome só quando o nome completo bate
   * exatamente com um único cadastro. O que não casar volta para conferência.
   */
  async aplicarListaRestritos(itens: { telefone?: string; nome?: string; motivo?: string }[], quem: string) {
    const aplicados: { entrada: string; tipo: string; nome: string }[] = [];
    const naoEncontrados: string[] = [];
    const ambiguos: string[] = [];

    for (const it of itens) {
      const tel = (it.telefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      const nome = (it.nome ?? '').replace(/\s+/g, ' ').trim();
      const entrada = [nome, tel].filter(Boolean).join(' · ');
      if (!tel && !nome) continue;
      // Com nome completo, entra também na lista de bloqueio: barra quem ainda não
      // tem cadastro ou volta depois por outra equipe
      if (nome.split(' ').length >= 2) {
        const r = await this.bloquear({ nomeCompleto: nome, telefone: tel.length >= 10 ? tel : undefined, motivo: it.motivo, origem: 'lista colada no painel' }, quem);
        r.atingidos.forEach((a) => aplicados.push({ entrada, tipo: a.tipo, nome: a.nome }));
        if (!r.atingidos.length) aplicados.push({ entrada, tipo: 'lista de bloqueio', nome });
      }

      if (tel.length >= 10) {
        const p = await this.prisma.provider.findUnique({ where: { phone: tel } });
        const ms = await this.prisma.providerMembro.findMany({ where: { telefone: tel } });
        if (p) { await this.restringirPrestador(p.id, true, it.motivo, quem); aplicados.push({ entrada, tipo: 'prestador', nome: p.name }); }
        for (const m of ms) { await this.restringirMembro(m.providerId, m.id, true, it.motivo, quem); aplicados.push({ entrada, tipo: 'agente', nome: m.nomeCompleto ?? m.nome }); }
        if (p || ms.length) continue;
      }
      if (nome.split(' ').length >= 2) {
        const [ps, ms] = await Promise.all([
          this.prisma.provider.findMany({ where: { OR: [{ name: { equals: nome, mode: 'insensitive' } }, { apelido: { equals: nome, mode: 'insensitive' } }] } }),
          this.prisma.providerMembro.findMany({ where: { OR: [{ nomeCompleto: { equals: nome, mode: 'insensitive' } }, { nome: { equals: nome, mode: 'insensitive' } }, { apelido: { equals: nome, mode: 'insensitive' } }] } }),
        ]);
        if (ps.length + ms.length === 1) {
          if (ps[0]) { await this.restringirPrestador(ps[0].id, true, it.motivo, quem); aplicados.push({ entrada, tipo: 'prestador', nome: ps[0].name }); }
          else { await this.restringirMembro(ms[0].providerId, ms[0].id, true, it.motivo, quem); aplicados.push({ entrada, tipo: 'agente', nome: ms[0].nomeCompleto ?? ms[0].nome }); }
          continue;
        }
        if (ps.length + ms.length > 1) { ambiguos.push(entrada); continue; }
      }
      // Já ficou na lista de bloqueio pelo nome completo: não é "não encontrado"
      if (nome.split(' ').length < 2) naoEncontrados.push(entrada);
    }
    return { aplicados, naoEncontrados, ambiguos };
  }

  // ---------- Lista de bloqueio ----------

  listarBloqueio() {
    return this.prisma.restrito.findMany({ orderBy: [{ ativo: 'desc' }, { criadoEm: 'desc' }] });
  }

  /**
   * Inclui na lista de bloqueio e aplica em quem já existe: prestador com o
   * mesmo telefone vira RESTRITO; agente com o mesmo telefone ou nome completo
   * fica restrito. Devolve o que foi atingido.
   */
  async bloquear(dados: { nomeCompleto: string; telefone?: string; regiao?: string; motivo?: string; origem?: string }, quem: string) {
    const telefone = dados.telefone?.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') || null;
    const nomeBusca = normalizar(dados.nomeCompleto);
    const registro = telefone
      ? await this.prisma.restrito.upsert({
          where: { telefone },
          create: { nomeCompleto: dados.nomeCompleto, nomeBusca, telefone, regiao: dados.regiao, motivo: dados.motivo, origem: dados.origem, criadoPor: quem },
          update: { nomeCompleto: dados.nomeCompleto, nomeBusca, regiao: dados.regiao, motivo: dados.motivo, origem: dados.origem, ativo: true },
        })
      : await this.prisma.restrito.create({ data: { nomeCompleto: dados.nomeCompleto, nomeBusca, regiao: dados.regiao, motivo: dados.motivo, origem: dados.origem, criadoPor: quem } });

    const atingidos: { tipo: string; nome: string; equipe?: string }[] = [];
    if (telefone) {
      const p = await this.prisma.provider.findUnique({ where: { phone: telefone } });
      if (p) { await this.restringirPrestador(p.id, true, dados.motivo, quem); atingidos.push({ tipo: 'prestador', nome: p.name }); }
    }
    const membros = await this.prisma.providerMembro.findMany({
      where: { OR: [...(telefone ? [{ telefone }] : []), { nomeCompleto: { equals: dados.nomeCompleto, mode: 'insensitive' } }] },
      include: { provider: { select: { name: true } } },
    });
    for (const m of membros) {
      await this.restringirMembro(m.providerId, m.id, true, dados.motivo, quem);
      atingidos.push({ tipo: 'agente', nome: m.nomeCompleto ?? m.nome, equipe: m.provider.name });
    }
    return { registro, atingidos };
  }

  async detalhePrestador(id: string, verValores = false) {
    const p = await this.prisma.provider.findUnique({
      where: { id },
      include: {
        membros: { orderBy: [{ ativo: 'desc' }, { atendimentos: 'desc' }] },
        areas: { orderBy: { atendimentos: 'desc' } },
        atendimentos: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { createdAt: true, category: true, agenteNome: true, status: true, vertical: true, conta: { select: { estabelecimento: true, cidade: true, estado: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Prestador não encontrado');
    const cidades = await this.resolvedorDeCidades();

    // Evolução mensal. Valor = o que o PR7 pagou a este prestador; em equipe,
    // o repasse aos agentes é feito pelo próprio adm e não entra aqui.
    const mensal = await this.prisma.$queryRaw<{ mes: string; atendimentos: bigint; valor: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') mes, count(*) atendimentos, sum("valorPrestador") valor
      FROM "Atendimento" WHERE "providerId" = ${id} GROUP BY 1 ORDER BY 1`);
    const evolucao = mensal.map((m) => ({
      mes: m.mes,
      atendimentos: Number(m.atendimentos),
      ...(verValores ? { valor: Number(m.valor ?? 0) } : {}),
    }));
    const totais = {
      atendimentos: evolucao.reduce((s, m) => s + m.atendimentos, 0),
      ...(verValores ? { valor: mensal.reduce((s, m) => s + Number(m.valor ?? 0), 0) } : {}),
    };

    return {
      ...p,
      evolucao,
      totais,
      verValores,
      membros: p.membros.map((m) => ({
        ...m,
        pendencias: [
          ...(m.nomeCompleto && m.nomeCompleto.trim().split(/\s+/).length >= 2 ? [] : ['Nome completo pendente']),
          ...(m.telefone ? [] : ['Sem telefone']),
        ],
      })),
      areas: p.areas.map((a) => ({ ...a, ...cidades.coordenada(a.cidade, a.estado) })),
    };
  }
}
