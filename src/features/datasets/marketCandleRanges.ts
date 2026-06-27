export const MARKET_CANDLE_INTERVAL_MS = 5 * 60 * 1_000;
export const INITIAL_MARKET_CANDLE_LIMIT = 5_000;
export const NEXT_MARKET_CANDLE_LIMIT = 5_000;
export const REPLAY_FORWARD_BASE_CANDLES = 2_000;
export const REPLAY_FORWARD_TIMEFRAME_BARS = 60;
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

const timeframeToBaseCandles = (timeframeMinutes: number): number => {
  if (!Number.isFinite(timeframeMinutes) || timeframeMinutes <= 0) return 1;
  return Math.max(1, Math.ceil((timeframeMinutes * 60 * 1_000) / MARKET_CANDLE_INTERVAL_MS));
};

export function buildReplayStartMarketCandleRange(
  boundary: MarketRangeBoundary,
  targetTimeMs: number,
  timeframeMinutes = 5,
): MarketCandleRange | null {
  const boundaryFrom = alignDown(boundary.from);
  const boundaryTo = alignUp(boundary.to);
  if (boundaryTo <= boundaryFrom) return null;

  const timeframeBaseCandles = timeframeToBaseCandles(timeframeMinutes);
  const forwardCandles = Math.max(
    REPLAY_FORWARD_BASE_CANDLES,
    REPLAY_FORWARD_TIMEFRAME_BARS * timeframeBaseCandles,
  );
  const alignedTarget = alignDown(targetTimeMs);
  const from = boundaryFrom;
  const to = Math.min(boundaryTo, alignedTarget + forwardCandles * MARKET_CANDLE_INTERVAL_MS);

  return to > from ? { from, to } : null;
}

export function hasLoadedMarketCandleRange(
  loadedCandles: { time: number }[],
  range: MarketCandleRange,
): boolean {
  const first = loadedCandles[0];
  const last = loadedCandles.at(-1);
  if (!first || !last) return false;
  const firstTimeMs = first.time * 1_000;
  const lastExclusiveMs = (last.time * 1_000) + MARKET_CANDLE_INTERVAL_MS;
  return firstTimeMs <= range.from && lastExclusiveMs >= range.to;
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
  currentTime: number | null | undefined,
  threshold = MARKET_CANDLE_PREFETCH_THRESHOLD,
): boolean {
  const last = loadedCandles.at(-1);
  if (!last || currentTime == null) return false;
  const remainingMs = (last.time - currentTime) * 1_000;
  return remainingMs <= threshold * MARKET_CANDLE_INTERVAL_MS;
}
