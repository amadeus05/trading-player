export const MARKET_CATEGORIES = ["linear", "inverse", "spot"] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export interface DownloadRequest {
  category: MarketCategory;
  symbol: string;
  from: number;
  to: number;
}

const SYMBOL_PATTERN = /^[A-Z0-9_-]{2,30}$/;

export function normalizeMarketCategory(value: unknown): MarketCategory {
  const category = String(value ?? "linear").trim();
  if (!MARKET_CATEGORIES.includes(category as MarketCategory)) {
    throw new Error("Invalid market category");
  }
  return category as MarketCategory;
}

export function normalizeMarketSymbol(value: unknown): string {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new Error("Invalid market symbol");
  }
  return symbol;
}

export function normalizeRequest(input: Partial<DownloadRequest>): DownloadRequest {
  const category = normalizeMarketCategory(input.category);
  const symbol = normalizeMarketSymbol(input.symbol);
  const from = Number(input.from);
  const to = Number(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Invalid [from, to) interval");
  return { category, symbol, from, to };
}
