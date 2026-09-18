// Centro aproximado de cada UF, para posicionar os marcadores no mapa.
// Evita depender de serviço de geocodificação (que seria pago).
export const CENTRO_UF: Record<string, { lat: number; lng: number; nome: string }> = {
  AC: { lat: -9.02, lng: -70.81, nome: 'Acre' },
  AL: { lat: -9.57, lng: -36.78, nome: 'Alagoas' },
  AM: { lat: -3.42, lng: -65.86, nome: 'Amazonas' },
  AP: { lat: 1.41, lng: -51.77, nome: 'Amapá' },
  BA: { lat: -12.96, lng: -41.7, nome: 'Bahia' },
  CE: { lat: -5.2, lng: -39.53, nome: 'Ceará' },
  DF: { lat: -15.83, lng: -47.86, nome: 'Distrito Federal' },
  ES: { lat: -19.19, lng: -40.34, nome: 'Espírito Santo' },
  GO: { lat: -15.98, lng: -49.86, nome: 'Goiás' },
  MA: { lat: -5.42, lng: -45.44, nome: 'Maranhão' },
  MG: { lat: -18.1, lng: -44.38, nome: 'Minas Gerais' },
  MS: { lat: -20.51, lng: -54.54, nome: 'Mato Grosso do Sul' },
  MT: { lat: -12.64, lng: -55.42, nome: 'Mato Grosso' },
  PA: { lat: -3.79, lng: -52.48, nome: 'Pará' },
  PB: { lat: -7.28, lng: -36.72, nome: 'Paraíba' },
  PE: { lat: -8.38, lng: -37.86, nome: 'Pernambuco' },
  PI: { lat: -6.6, lng: -42.28, nome: 'Piauí' },
  PR: { lat: -24.89, lng: -51.55, nome: 'Paraná' },
  RJ: { lat: -22.25, lng: -42.66, nome: 'Rio de Janeiro' },
  RN: { lat: -5.81, lng: -36.59, nome: 'Rio Grande do Norte' },
  RO: { lat: -10.83, lng: -63.34, nome: 'Rondônia' },
  RR: { lat: 1.99, lng: -61.33, nome: 'Roraima' },
  RS: { lat: -30.17, lng: -53.5, nome: 'Rio Grande do Sul' },
  SC: { lat: -27.45, lng: -50.95, nome: 'Santa Catarina' },
  SE: { lat: -10.57, lng: -37.45, nome: 'Sergipe' },
  SP: { lat: -22.19, lng: -48.79, nome: 'São Paulo' },
  TO: { lat: -9.46, lng: -48.26, nome: 'Tocantins' },
};

export function ufValida(uf: string): boolean {
  return Object.prototype.hasOwnProperty.call(CENTRO_UF, uf?.toUpperCase?.() ?? '');
}
