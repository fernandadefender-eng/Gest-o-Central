/**
 * Baixa as unidades policiais de cada estado (delegacias da Civil, batalhões e postos
 * da Militar, PRF, bombeiros) do OpenStreetMap e guarda para o mapa de apoio.
 *
 *   npx ts-node -T scripts/importar-policia.ts            # todos os estados
 *   npx ts-node -T scripts/importar-policia.ts RJ SP MG   # só alguns
 *
 * Fonte: Overpass API (OpenStreetMap), gratuita e sem cadastro, dados sob ODbL.
 * Respeita a política de uso: um estado por vez, com pausa entre as consultas.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const ESPERA_MS = 4000;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Elemento = {
  type: string; id: number; lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/**
 * Classifica pelo que o OSM traz: delegacia = Civil, batalhão/posto = Militar.
 * Olha todos os campos de nome, porque muita unidade só tem o nome curto
 * ("Brigada Militar", "CIOPS", "D.P.M.") ou vem sem nome nenhum.
 */
export function classificar(tags: Record<string, string>): string {
  const t = [tags.name, tags['name:pt'], tags.official_name, tags.short_name, tags.operator, tags.description, tags.police, tags['police:BR'], tags.brand]
    .filter(Boolean).join(' ').toLowerCase();
  if (/rodovi[áa]ria federal|\bprf\b/.test(t)) return 'PRF';
  if (/pol[íi]cia federal|\bpf\b/.test(t)) return 'PF';
  if (/bombeir/.test(t)) return 'BOMBEIROS';
  if (/guarda (municipal|civil)|\bgcm\b|\bgm\b/.test(t)) return 'GM';
  if (/delegacia|pol[íi]cia civil|\bdp\b|\bdeam\b|\bdisque|\bcivil\b|instituto m[ée]dico legal|\biml\b|per[íi]cia/.test(t)) return 'PC';
  // Brigada Militar é o nome da PM no RS; CIOPS e DPM também são unidades militares
  if (/batalh[ãa]o|\bbpm\b|pol[íi]cia militar|brigada militar|\bpm\b|\bd\.?p\.?m\.?\b|posto policial|companhia|\bciops\b|\bcpm\b/.test(t)) return 'PM';
  return 'OUTRA';
}

// O Overpass é gratuito e limita o uso: quando responde 429/504, espera mais e tenta
// no espelho seguinte. Nunca insiste sem pausa.
const ESPELHOS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function consultar(uf: string, tentativa = 0): Promise<Elemento[]> {
  const consulta = `[out:json][timeout:120];area["ISO3166-2"="BR-${uf}"][admin_level=4]->.a;` +
    `(node["amenity"="police"](area.a);way["amenity"="police"](area.a);relation["amenity"="police"](area.a););out center;`;
  const espelho = ESPELHOS[tentativa % ESPELHOS.length];
  const res = await fetch(espelho, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'PR7-Atende/1.0 (sistema interno de operação; contato pr7.central@gmail.com)',
    },
    body: new URLSearchParams({ data: consulta }),
  });
  if (!res.ok) {
    if (tentativa < 5) {
      const espera = 8000 * (tentativa + 1);
      console.log(`    ${uf}: ${res.status} em ${new URL(espelho).host} — nova tentativa em ${espera / 1000}s`);
      await esperar(espera);
      return consultar(uf, tentativa + 1);
    }
    throw new Error(`Overpass respondeu ${res.status} após ${tentativa} tentativas`);
  }
  const json = (await res.json()) as { elements: Elemento[] };
  return json.elements ?? [];
}

async function main() {
  const pedidos = process.argv.slice(2).map((u) => u.toUpperCase()).filter((u) => UFS.includes(u));
  const estados = pedidos.length ? pedidos : UFS;
  console.log(`Buscando unidades policiais em ${estados.length} estado(s)...`);

  let total = 0;
  for (const uf of estados) {
    let elementos: Elemento[];
    try {
      elementos = await consultar(uf);
    } catch (err) {
      console.log(`  ${uf}: falhou (${(err as Error).message}) — tenta de novo depois`);
      await esperar(ESPERA_MS * 2);
      continue;
    }
    let gravados = 0;
    for (const e of elementos) {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      const tags = e.tags ?? {};
      if (lat == null || lon == null) continue;
      const nome = (tags.name ?? tags['name:pt'] ?? tags.operator ?? 'Unidade policial').slice(0, 160);
      const dados = {
        tipo: classificar(tags), nome, uf,
        cidade: tags['addr:city'] ?? null,
        bairro: tags['addr:suburb'] ?? tags['addr:neighbourhood'] ?? null,
        endereco: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ') || null,
        telefone: tags.phone ?? tags['contact:phone'] ?? null,
        horario: tags.opening_hours ?? null,
        latitude: lat, longitude: lon,
        fonte: 'OpenStreetMap', idExterno: `${e.type}/${e.id}`,
      };
      await prisma.unidadePolicial.upsert({ where: { idExterno: dados.idExterno }, create: dados, update: dados });
      gravados++;
    }
    total += gravados;
    console.log(`  ${uf}: ${gravados} unidades`);
    await esperar(ESPERA_MS);
  }

  const porTipo = await prisma.unidadePolicial.groupBy({ by: ['tipo'], _count: true });
  console.log(`\ntotal gravado: ${total}`);
  console.table(porTipo.map((t) => ({ tipo: t.tipo, unidades: t._count })));
  await prisma.$disconnect();
}

if (require.main === module) main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
