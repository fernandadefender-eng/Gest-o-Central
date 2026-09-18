import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRO_UF } from './estados';
import { COR_FACCAO, NIVEIS, nivelDeRisco, NOME_FACCAO } from './risco';

@Injectable()
export class MapaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Atendimentos agrupados por UF, prontos para plotar no mapa. */
  async porEstado(categoria?: string) {
    const contas = await this.prisma.conta.findMany({ select: { id: true, estado: true } });
    const estadoDaConta = new Map(contas.map((c) => [c.id, c.estado?.toUpperCase() ?? '']));

    const grupos = await this.prisma.atendimento.groupBy({
      by: ['contaId'],
      where: {
        contaId: { not: null },
        ...(categoria ? { category: { contains: categoria, mode: 'insensitive' } } : {}),
      },
      _count: { _all: true },
    });

    const total: Record<string, number> = {};
    for (const g of grupos) {
      const uf = estadoDaConta.get(g.contaId!) ?? '';
      if (!CENTRO_UF[uf]) continue;
      total[uf] = (total[uf] ?? 0) + g._count._all;
    }

    return Object.entries(total)
      .map(([uf, quantidade]) => ({ uf, quantidade, ...CENTRO_UF[uf] }))
      .sort((a, b) => b.quantidade - a.quantidade);
  }

  /**
   * Incidência de roubo e furto de veículo para o mapa de alerta (linha Veicular).
   * Junta duas origens: os alertas divulgados nos grupos ("DIVULGAÇÃO FURTO", que já
   * vêm com lat/long) e os chamados veiculares de roubo/furto com coordenada.
   * Também devolve a contagem por cidade, para a lista de pontos quentes.
   */
  async incidenciaVeicular(meses = 12) {
    const desde = new Date(Date.now() - Math.min(Math.max(meses, 1), 60) * 30 * 864e5);
    const [alertas, chamados] = await Promise.all([
      this.prisma.alertaVeicular.findMany({
        where: { divulgadoEm: { gte: desde }, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, tipo: true, placa: true, descricao: true, localOcorrencia: true, latitude: true, longitude: true, divulgadoEm: true, grupo: true },
        orderBy: { divulgadoEm: 'desc' },
        take: 2000,
      }),
      this.prisma.atendimento.findMany({
        where: {
          vertical: 'VEICULAR',
          latitude: { not: null }, longitude: { not: null },
          OR: [
            { summary: { contains: 'roubo', mode: 'insensitive' } },
            { summary: { contains: 'furto', mode: 'insensitive' } },
            { summary: { contains: 'apropria', mode: 'insensitive' } },
          ],
          solicitadoEm: { gte: desde },
        },
        select: {
          id: true, placa: true, summary: true, latitude: true, longitude: true, solicitadoEm: true, status: true,
          detalhes: true,
          client: { select: { name: true } },
        },
        orderBy: { solicitadoEm: 'desc' },
        take: 2000,
      }),
    ]);

    const tipoDoTexto = (t?: string | null) => {
      const x = (t ?? '').toLowerCase();
      if (x.includes('apropria')) return 'APROPRIACAO_INDEBITA';
      if (x.includes('roubo')) return 'ROUBO';
      return 'FURTO';
    };

    const pontos = [
      ...alertas.map((a) => ({
        origem: 'ALERTA' as const, id: a.id, tipo: a.tipo, placa: a.placa,
        descricao: a.descricao ?? a.localOcorrencia ?? null, local: a.localOcorrencia,
        lat: a.latitude!, lng: a.longitude!, quando: a.divulgadoEm, cliente: a.grupo,
      })),
      ...chamados.map((c) => {
        const d = (c.detalhes ?? {}) as Record<string, string>;
        return {
          origem: 'ATENDIMENTO' as const, id: c.id, tipo: tipoDoTexto(c.summary), placa: c.placa,
          descricao: c.summary, local: [d.cidade, d.estado].filter(Boolean).join('/') || null,
          lat: c.latitude!, lng: c.longitude!, quando: c.solicitadoEm!, cliente: c.client.name,
        };
      }),
    ].sort((a, b) => +b.quando - +a.quando);

    // Pontos quentes: agrupa por ~5 km (2 casas decimais) para a lista de locais de risco
    const porLocal = new Map<string, { lat: number; lng: number; local: string | null; quantidade: number; tipos: Record<string, number>; ultima: Date }>();
    for (const p of pontos) {
      const chave = `${p.lat.toFixed(2)}|${p.lng.toFixed(2)}`;
      const atual = porLocal.get(chave) ?? { lat: p.lat, lng: p.lng, local: p.local, quantidade: 0, tipos: {}, ultima: p.quando };
      atual.quantidade++;
      atual.tipos[p.tipo] = (atual.tipos[p.tipo] ?? 0) + 1;
      if (+p.quando > +atual.ultima) { atual.ultima = p.quando; atual.local = p.local ?? atual.local; }
      porLocal.set(chave, atual);
    }

    return {
      desde: desde.toISOString(),
      total: pontos.length,
      porTipo: pontos.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.tipo]: (acc[p.tipo] ?? 0) + 1 }), {}),
      pontos,
      focos: [...porLocal.values()].sort((a, b) => b.quantidade - a.quantidade || +b.ultima - +a.ultima).slice(0, 50),
    };
  }

  /**
   * Áreas sob domínio de grupo armado, por estado e facção — vale para todo o país,
   * independente de existir atendimento na região. Fonte sempre identificada.
   */
  async areasDeRisco(uf?: string, faccao?: string) {
    const areas = await this.prisma.areaRisco.findMany({
      where: {
        ...(uf && /^[A-Za-z]{2}$/.test(uf) ? { uf: uf.toUpperCase() } : {}),
        ...(faccao ? { faccao: faccao.toUpperCase() } : {}),
      },
      orderBy: [{ uf: 'asc' }, { populacao: 'desc' }],
      take: 5000,
    });
    const porFaccao = areas.reduce<Record<string, { areas: number; populacao: number }>>((acc, a) => {
      const atual = acc[a.faccao] ?? { areas: 0, populacao: 0 };
      atual.areas++;
      atual.populacao += a.populacao ?? 0;
      return { ...acc, [a.faccao]: atual };
    }, {});
    const fontes = [...new Set(areas.map((a) => a.fonte))];
    const totalDe = (a: (typeof areas)[number]) => {
      const i = (a.indicadores ?? {}) as { rouboVeiculo?: number; furtoVeiculo?: number };
      return (i.rouboVeiculo ?? 0) + (i.furtoVeiculo ?? 0);
    };
    // Resumo por estado, para o painel mostrar o país inteiro de relance
    const porUf = areas.reduce<Record<string, { areas: number; roubos: number; furtos: number }>>((acc, a) => {
      const i = (a.indicadores ?? {}) as { rouboVeiculo?: number; furtoVeiculo?: number };
      const atual = acc[a.uf] ?? { areas: 0, roubos: 0, furtos: 0 };
      atual.areas++;
      atual.roubos += i.rouboVeiculo ?? 0;
      atual.furtos += i.furtoVeiculo ?? 0;
      return { ...acc, [a.uf]: atual };
    }, {});
    return {
      total: areas.length,
      legenda: Object.entries(NOME_FACCAO).map(([sigla, nome]) => ({ sigla, nome, cor: COR_FACCAO[sigla] })),
      niveis: NIVEIS,
      porFaccao, porUf, fontes,
      atualizadoEm: areas.reduce<string | null>((max, a) => (!max || a.vigenteEm.toISOString() > max ? a.vigenteEm.toISOString() : max), null),
      areas: areas.map((a) => {
        const total = totalDe(a);
        const nivel = nivelDeRisco(total);
        return {
        id: a.id, faccao: a.faccao, nomeFaccao: NOME_FACCAO[a.faccao] ?? a.faccao,
        // Fonte estatística (sem facção): a cor vem do nível de risco
        cor: a.faccao === 'INDEFINIDA' ? nivel.cor : COR_FACCAO[a.faccao] ?? '#94a3b8',
        nivel: nivel.nivel, rotuloNivel: nivel.rotulo, totalPeriodo: total,
        nome: a.nome, cidade: a.cidade, bairro: a.bairro, uf: a.uf, situacao: a.situacao, populacao: a.populacao,
        indicadores: a.indicadores,
        lat: a.latitude, lng: a.longitude, raioMetros: a.raioMetros, geojson: a.geojson,
        fonte: a.fonte, referencia: a.referencia, vigenteEm: a.vigenteEm,
        };
      }),
    };
  }

  /** Ocorrências públicas georreferenciadas (tiroteio, roubo de veículo) para o calor do mapa. */
  async ocorrenciasPublicas(uf?: string, dias = 180, tipo?: string) {
    const desde = new Date(Date.now() - Math.min(Math.max(dias, 1), 1095) * 864e5);
    const itens = await this.prisma.ocorrenciaPublica.findMany({
      where: {
        ocorridoEm: { gte: desde },
        latitude: { not: null }, longitude: { not: null },
        ...(uf && /^[A-Za-z]{2}$/.test(uf) ? { uf: uf.toUpperCase() } : {}),
        ...(tipo ? { tipo: tipo.toUpperCase() } : {}),
      },
      orderBy: { ocorridoEm: 'desc' },
      take: 5000,
      select: { id: true, tipo: true, fonte: true, uf: true, cidade: true, bairro: true, latitude: true, longitude: true, ocorridoEm: true, mortos: true, feridos: true },
    });
    return {
      desde: desde.toISOString(),
      total: itens.length,
      porTipo: itens.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.tipo]: (acc[o.tipo] ?? 0) + 1 }), {}),
      fontes: [...new Set(itens.map((o) => o.fonte))],
      itens,
    };
  }

  /**
   * Unidades policiais por estado (delegacias da Civil, batalhões e postos da Militar,
   * PRF, bombeiros e guarda municipal). Serve para o operador ver o apoio mais próximo.
   */
  async unidadesPoliciais(uf?: string, tipo?: string) {
    const itens = await this.prisma.unidadePolicial.findMany({
      where: {
        ...(uf && /^[A-Za-z]{2}$/.test(uf) ? { uf: uf.toUpperCase() } : {}),
        ...(tipo ? { tipo: tipo.toUpperCase() } : {}),
      },
      orderBy: [{ uf: 'asc' }, { nome: 'asc' }],
      take: 20000,
      select: { id: true, tipo: true, nome: true, uf: true, cidade: true, bairro: true, endereco: true, telefone: true, horario: true, latitude: true, longitude: true, fonte: true },
    });
    const porTipo = itens.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.tipo]: (acc[u.tipo] ?? 0) + 1 }), {});
    const porUf = itens.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.uf]: (acc[u.uf] ?? 0) + 1 }), {});
    return {
      total: itens.length, porTipo, porUf,
      legenda: [
        { tipo: 'PM', nome: 'Polícia Militar', cor: '#38bdf8', icone: '🚓' },
        { tipo: 'PC', nome: 'Polícia Civil', cor: '#a78bfa', icone: '🚔' },
        { tipo: 'PRF', nome: 'Polícia Rodoviária Federal', cor: '#2dd4bf', icone: '🛣️' },
        { tipo: 'PF', nome: 'Polícia Federal', cor: '#f472b6', icone: '🎖️' },
        { tipo: 'BOMBEIROS', nome: 'Bombeiros', cor: '#f97316', icone: '🚒' },
        { tipo: 'GM', nome: 'Guarda Municipal', cor: '#94a3b8', icone: '🛡️' },
        { tipo: 'OUTRA', nome: 'Outra unidade', cor: '#64748b', icone: '🏛️' },
      ],
      itens,
    };
  }

  /** Tipos de serviço existentes, para alimentar o filtro do mapa. */
  async categorias() {
    const grupos = await this.prisma.atendimento.groupBy({
      by: ['category'],
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
      take: 15,
    });
    return grupos
      .filter((g) => g.category)
      .map((g) => ({ categoria: g.category!, quantidade: g._count._all }));
  }
}
