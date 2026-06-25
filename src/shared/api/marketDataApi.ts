import type { Candle } from "../../types";

export type MarketCatalogItem = {
  category: string;
  symbol: string;
  from: number;
  to: number;
  candles: number;
  bytes: number;
};

interface MarketCandleRow {
  openTime?: number | string;
  open_time?: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

const readError = async (response: Response) => {
  const payload = await response.json() as { error?: string };
  return payload.error ?? `HTTP ${response.status}`;
};

export function marketDatasetId(category: string, symbol: string) {
  return `market:${category}:${symbol.toUpperCase()}`;
}

export function parseMarketDatasetId(id: string): { category: string; symbol: string } | null {
  const match = /^market:([^:]+):(.+)$/.exec(id);
  if (!match) return null;
  return { category: match[1], symbol: match[2] };
}

export async function fetchMarketCatalog(): Promise<MarketCatalogItem[]> {
  const response = await fetch("/api/market/catalog");
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<MarketCatalogItem[]>;
}

export async function fetchMarketCandles(
  category: string,
  symbol: string,
  from: number,
  to: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    category,
    symbol: symbol.toUpperCase(),
    timeframe: "5m",
    from: String(from),
    to: String(to),
  });
  const response = await fetch(`/api/market/candles?${params}`);
  if (!response.ok) throw new Error(await readError(response));
  const rows = await response.json() as MarketCandleRow[];
  return rows.map((row) => ({
    time: Number(row.openTime ?? row.open_time) / 1_000,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}
