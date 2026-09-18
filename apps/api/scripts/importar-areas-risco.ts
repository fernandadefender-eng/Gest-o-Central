/**
 * Importa áreas sob domínio de grupo armado para o mapa de alerta.
 *
 *   npx ts-node -T scripts/importar-areas-risco.ts "<arquivo.geojson|arquivo.csv>" --fonte "GENI/UFF + Fogo Cruzado" --vigencia 2024-12-31 [--referencia URL]
 *
 * Aceita:
 *  - GeoJSON (FeatureCollection): usa o polígono e lê facção/nome/UF das properties;
 *  - CSV/TSV com cabeçalho: faccao, uf, cidade, bairro, nome, lat, lng, raio, populacao, situacao.
 *
 * Nada é estimado: o que não vier no arquivo fica vazio. Rodar de novo atualiza
 * pelo par (fonte + nome + uf), sem duplicar.
 */
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { normalizarFaccao, normalizarSituacao } from '../src/mapa/risco';

const prisma = new PrismaClient();

const argumento = (nome: string, padrao?: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

type Entrada = {
  faccao: string; uf: string; cidade?: string; bairro?: string; nome: string;
  latitude?: number; longitude?: number; raioMetros?: number; populacao?: number;
  situacao?: string | null; geojson?: unknown;
};

/** Centro aproximado de um polígono GeoJSON (média dos vértices). */
function centro(geometria: { type: string; coordinates: unknown }): { lat: number; lng: number } | null {
  const pontos: number[][] = [];
  const percorrer = (v: unknown) => {
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') pontos.push(v as number[]);
    else if (Array.isArray(v)) v.forEach(percorrer);
  };
  percorrer(geometria.coordinates);
  if (!pontos.length) return null;
  const soma = pontos.reduce((a, p) => ({ lng: a.lng + p[0], lat: a.lat + p[1] }), { lat: 0, lng: 0 });
  return { lat: soma.lat / pontos.length, lng: soma.lng / pontos.length };
}

function lerGeoJson(texto: string): Entrada[] {
  const doc = JSON.parse(texto) as { features?: { properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } }[] };
  return (doc.features ?? []).map((f) => {
    const p = (f.properties ?? {}) as Record<string, string | number | undefined>;
    const pega = (...nomes: string[]) => {
      for (const n of nomes) {
        const chave = Object.keys(p).find((k) => k.toLowerCase() === n);
        if (chave && p[chave] !== undefined && p[chave] !== '') return String(p[chave]);
      }
      return undefined;
    };
    const c = f.geometry ? centro(f.geometry) : null;
    return {
      faccao: normalizarFaccao(pega('faccao', 'facção', 'grupo', 'dominio', 'domínio', 'group')),
      uf: (pega('uf', 'estado', 'sigla_uf') ?? 'RJ').toUpperCase().slice(0, 2),
      cidade: pega('cidade', 'municipio', 'município', 'nm_mun'),
      bairro: pega('bairro', 'sub_bairro', 'regiao', 'região'),
      nome: pega('nome', 'name', 'favela', 'localidade', 'complexo') ?? 'Área sem nome',
      latitude: c?.lat, longitude: c?.lng,
      populacao: Number(pega('populacao', 'população', 'pop') ?? '') || undefined,
      situacao: normalizarSituacao(pega('situacao', 'situação', 'status', 'tipo_dominio')),
      geojson: f.geometry,
    };
  });
}

function lerTabela(texto: string): Entrada[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = linhas[0].includes(';') ? ';' : linhas[0].includes('\t') ? '\t' : ',';
  const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));
  const idx = (...nomes: string[]) => cab.findIndex((c) => nomes.includes(c));
  const iFaccao = idx('faccao', 'facção', 'grupo'), iUf = idx('uf', 'estado'), iNome = idx('nome', 'localidade', 'favela');
  const iCidade = idx('cidade', 'municipio', 'município'), iBairro = idx('bairro'), iLat = idx('lat', 'latitude');
  const iLng = idx('lng', 'long', 'longitude'), iRaio = idx('raio', 'raiometros'), iPop = idx('populacao', 'população');
  const iSit = idx('situacao', 'situação', 'status');
  return linhas.slice(1).map((l) => {
    const v = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const num = (i: number) => (i >= 0 && v[i] ? Number(v[i].replace(',', '.')) : undefined);
    return {
      faccao: normalizarFaccao(iFaccao >= 0 ? v[iFaccao] : ''),
      uf: (iUf >= 0 ? v[iUf] : '').toUpperCase().slice(0, 2),
      cidade: iCidade >= 0 ? v[iCidade] : undefined,
      bairro: iBairro >= 0 ? v[iBairro] : undefined,
      nome: iNome >= 0 ? v[iNome] : 'Área sem nome',
      latitude: num(iLat), longitude: num(iLng), raioMetros: num(iRaio), populacao: num(iPop),
      situacao: normalizarSituacao(iSit >= 0 ? v[iSit] : ''),
    };
  }).filter((e) => e.uf.length === 2 && e.nome);
}

async function main() {
  const arquivo = process.argv[2];
  const fonte = argumento('fonte');
  const vigencia = argumento('vigencia');
  const referencia = argumento('referencia');
  if (!arquivo || !fonte || !vigencia) {
    console.error('uso: importar-areas-risco.ts <arquivo> --fonte "<fonte>" --vigencia AAAA-MM-DD [--referencia URL]');
    process.exit(1);
  }
  const vigenteEm = new Date(`${vigencia}T12:00:00Z`);
  if (isNaN(vigenteEm.getTime())) { console.error('vigência inválida'); process.exit(1); }

  const texto = readFileSync(arquivo, 'utf8');
  const entradas = arquivo.toLowerCase().endsWith('.geojson') || texto.trimStart().startsWith('{')
    ? lerGeoJson(texto)
    : lerTabela(texto);
  console.log(`áreas lidas: ${entradas.length}`);

  let novas = 0, atualizadas = 0;
  for (const e of entradas) {
    const existente = await prisma.areaRisco.findFirst({ where: { fonte, nome: e.nome, uf: e.uf } });
    const dados = {
      faccao: e.faccao, uf: e.uf, cidade: e.cidade ?? null, bairro: e.bairro ?? null, nome: e.nome,
      latitude: e.latitude ?? null, longitude: e.longitude ?? null, raioMetros: e.raioMetros ?? null,
      populacao: e.populacao ?? null, situacao: e.situacao ?? null,
      geojson: (e.geojson ?? undefined) as never,
      fonte, referencia: referencia ?? null, vigenteEm,
    };
    if (existente) { await prisma.areaRisco.update({ where: { id: existente.id }, data: dados }); atualizadas++; }
    else { await prisma.areaRisco.create({ data: dados }); novas++; }
  }

  const porFaccao = await prisma.areaRisco.groupBy({ by: ['faccao'], _count: true });
  console.log(`novas: ${novas} · atualizadas: ${atualizadas}`);
  console.table(porFaccao.map((f) => ({ faccao: f.faccao, areas: f._count })));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
