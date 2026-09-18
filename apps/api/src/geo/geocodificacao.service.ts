import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRO_UF } from '../mapa/estados';
import { chaveCidade } from './normalizar';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descobre a coordenada de cada cidade usada por contas e prestadores.
 *
 * Usa o Nominatim (OpenStreetMap), gratuito, respeitando a política de uso:
 * no máximo 1 consulta por segundo e identificação no User-Agent. Só o nome
 * da cidade e a UF saem do sistema — nenhum dado de cliente ou prestador.
 * Cada cidade é consultada uma única vez e fica guardada na tabela Cidade.
 */
@Injectable()
export class GeocodificacaoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeocodificacaoService.name);
  private rodando = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.GEOCODING_ENABLED === 'false') return;
    // Em segundo plano: a API sobe na hora, as cidades vão sendo preenchidas.
    this.preencherPendentes().catch((err) => this.logger.error(`Localização interrompida: ${(err as Error).message}`));
  }

  async preencherPendentes() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const pendentes = await this.cidadesPendentes();
      if (pendentes.length === 0) return;
      this.logger.log(`Localizando ${pendentes.length} cidades (~${Math.ceil(pendentes.length * 1.1 / 60)} min, 1 por segundo)`);

      let feitas = 0;
      for (const c of pendentes) {
        let ponto: { lat: number; lng: number } | null;
        try {
          ponto = await this.consultar(c.cidade, c.uf);
        } catch (err) {
          // Falha de rede/limite: para sem marcar como "não encontrada"; retoma no próximo início
          this.logger.warn(`Localização pausada: ${(err as Error).message}`);
          break;
        }
        await this.prisma.cidade.upsert({
          where: { chave: c.chave },
          create: { chave: c.chave, nome: c.cidade, uf: c.uf, lat: ponto?.lat, lng: ponto?.lng, encontrada: !!ponto },
          update: { lat: ponto?.lat, lng: ponto?.lng, encontrada: !!ponto },
        });
        if (++feitas % 50 === 0) this.logger.log(`Cidades localizadas: ${feitas}/${pendentes.length}`);
        await esperar(1100);
      }
      this.logger.log(`Localização de cidades concluída (${feitas})`);
    } finally {
      this.rodando = false;
    }
  }

  async progresso() {
    const [prontas, pendentes] = await Promise.all([
      this.prisma.cidade.count(),
      this.cidadesPendentes().then((p) => p.length),
    ]);
    return { prontas, pendentes };
  }

  private async cidadesPendentes() {
    const [contas, areas, risco, conhecidas] = await Promise.all([
      this.prisma.conta.findMany({ select: { cidade: true, estado: true }, distinct: ['cidade', 'estado'] }),
      this.prisma.providerArea.findMany({ select: { cidade: true, estado: true }, distinct: ['cidade', 'estado'] }),
      // Municípios das áreas de risco (estatística pública) também precisam de coordenada
      this.prisma.areaRisco.findMany({ where: { cidade: { not: null } }, select: { cidade: true, uf: true }, distinct: ['cidade', 'uf'] }),
      // Não encontrada é tentada de novo depois de 30 dias (o OpenStreetMap vai sendo corrigido)
      this.prisma.cidade.findMany({
        where: { OR: [{ encontrada: true }, { atualizadoEm: { gt: new Date(Date.now() - 30 * 864e5) } }] },
        select: { chave: true },
      }),
    ]);
    const jaTem = new Set(conhecidas.map((c) => c.chave));
    const mapa = new Map<string, { chave: string; cidade: string; uf: string }>();
    const daRisco = risco.map((r) => ({ cidade: r.cidade, estado: r.uf }));
    for (const { cidade, estado } of [...contas, ...areas, ...daRisco]) {
      const uf = estado?.toUpperCase();
      if (!cidade?.trim() || !CENTRO_UF[uf]) continue;
      const chave = chaveCidade(cidade, uf);
      if (!jaTem.has(chave) && !mapa.has(chave)) mapa.set(chave, { chave, cidade: cidade.trim(), uf });
    }
    return [...mapa.values()];
  }

  private async consultar(cidade: string, uf: string) {
    // A planilha às vezes traz "Cidade - UF" ou "Cidade/Bairro": fica só a cidade
    const nome = cidade.split(/\s[-–]\s|\//)[0].trim();
    const estruturada = await this.buscar({ city: nome, state: CENTRO_UF[uf].nome });
    if (estruturada) return estruturada;
    // Segunda tentativa em texto livre: pega distritos e grafias fora do padrão
    await esperar(1100);
    return this.buscar({ q: `${nome}, ${CENTRO_UF[uf].nome}, Brasil` });
  }

  private async buscar(filtro: Record<string, string>) {
    const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', ...filtro });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'PR7-Atende/0.1 (painel interno de operacao)' },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const [r] = (await res.json()) as { lat: string; lon: string }[];
    return r ? { lat: Number(r.lat), lng: Number(r.lon) } : null;
  }
}
