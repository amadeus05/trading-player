import type { Candle } from "../../types";
import { BASE_TIMEFRAME_MINUTES } from "../config/simulation";

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

/** Минуты → строка таймфрейма сервера (server/domain/Candle.ts); неизвестное → база. */
const MINUTES_TO_TIMEFRAME: Record<number, string> = {
  1: "1m", 2: "2m", 3: "3m", 5: "5m", 7: "7m", 10: "10m", 15: "15m", 30: "30m",
  60: "1h", 120: "2h", 180: "3h", 240: "4h",
  360: "6h", 720: "12h", 1440: "1d",
};

export async function fetchMarketCandles(
  category: string,
  symbol: string,
  from: number,
  to: number,
  timeframeMinutes = BASE_TIMEFRAME_MINUTES,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    category,
    symbol: symbol.toUpperCase(),
    timeframe: MINUTES_TO_TIMEFRAME[timeframeMinutes] ?? MINUTES_TO_TIMEFRAME[BASE_TIMEFRAME_MINUTES],
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
