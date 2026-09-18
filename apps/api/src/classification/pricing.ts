// Preços oficiais da Anthropic em USD por 1 milhão de tokens.
// Fonte: tabela de preços da API da Anthropic. Revisar quando trocar de modelo
// ou quando a Anthropic anunciar mudança de preço.
type ModelPrice = { input: number; output: number; cacheRead: number };

const PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5 },
};

const FALLBACK_PRICE = PRICES['claude-haiku-4-5'];

export function priceFor(model: string): ModelPrice {
  // Aceita ids com sufixo de data (ex: claude-haiku-4-5-20251001)
  const match = Object.keys(PRICES).find((id) => model.startsWith(id));
  return match ? PRICES[match] : FALLBACK_PRICE;
}

export function costUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number },
): number {
  const price = priceFor(model);
  return (
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * price.cacheRead
  );
}

export function usdToBrl(usd: number): number {
  const rate = Number(process.env.USD_BRL_RATE ?? '5.40');
  return usd * rate;
}
