export const MARKET_CANDLE_INTERVAL_MS = 5 * 60 * 1_000;
export const INITIAL_MARKET_CANDLE_LIMIT = 5_000;
export const NEXT_MARKET_CANDLE_LIMIT = 5_000;
export const MARKET_CANDLE_PREFETCH_THRESHOLD = 500;

export interface MarketCandleRange {
  from: number;
  to: number;
}

interface MarketRangeBoundary {
  from: number;
  to: number;
}

const alignDown = (timeMs: number): number =>
  Math.floor(timeMs / MARKET_CANDLE_INTERVAL_MS) * MARKET_CANDLE_INTERVAL_MS;

const alignUp = (timeMs: number): number =>
  Math.ceil(timeMs / MARKET_CANDLE_INTERVAL_MS) * MARKET_CANDLE_INTERVAL_MS;

export function buildInitialMarketCandleRange(
  boundary: MarketRangeBoundary,
  candleLimit = INITIAL_MARKET_CANDLE_LIMIT,
): MarketCandleRange | null {
  const from = alignDown(boundary.from);
  const to = Math.min(alignUp(boundary.to), from + candleLimit * MARKET_CANDLE_INTERVAL_MS);
  return to > from ? { from, to } : null;
}

export function buildNextMarketCandleRange(
  boundary: MarketRangeBoundary,
  loadedCandles: { time: number }[],
  candleLimit = NEXT_MARKET_CANDLE_LIMIT,
): MarketCandleRange | null {
  const lastLoaded = loadedCandles.at(-1);
  if (!lastLoaded) return buildInitialMarketCandleRange(boundary, candleLimit);
  const from = alignDown((lastLoaded.time * 1_000) + MARKET_CANDLE_INTERVAL_MS);
  const to = Math.min(alignUp(boundary.to), from + candleLimit * MARKET_CANDLE_INTERVAL_MS);
  return to > from ? { from, to } : null;
}

export function shouldPrefetchMarketCandles(
  loadedCandles: { time: number }[],
  replayIndex: number,
  threshold = MARKET_CANDLE_PREFETCH_THRESHOLD,
): boolean {
  if (!loadedCandles.length) return false;
  return loadedCandles.length - 1 - replayIndex <= threshold;
}
