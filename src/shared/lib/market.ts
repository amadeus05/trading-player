import type { Candle } from "../../types";

const QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"] as const;

export const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const formatDateTime = (timestamp: number) =>
  new Date(timestamp * 1_000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatMarketDate = (timestampMs: number) =>
  new Date(timestampMs).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export const formatMarketPair = (name?: string) => {
  if (!name) return "Нет данных";
  const symbol = name.split(/[·\s]/)[0].toUpperCase();
  const quote = QUOTE_ASSETS.find(
    (value) => symbol.endsWith(value) && symbol.length > value.length,
  );
  return quote ? `${symbol.slice(0, -quote.length)} / ${quote}` : symbol;
};

export const formatTimeframe = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : minutes === 1_440 ? "1d" : `${minutes / 60}h`;

const decimalPlaces = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const places = Number(text.split("e-")[1]);
    return Number.isFinite(places) ? places : 0;
  }
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
};

export const inferPricePrecision = (candles: Candle[]) => {
  let precision = 2;
  const step = Math.max(1, Math.floor(candles.length / 4_000));
  for (let index = 0; index < candles.length; index += step) {
    const candle = candles[index];
    precision = Math.max(
      precision,
      decimalPlaces(candle.open),
      decimalPlaces(candle.high),
      decimalPlaces(candle.low),
      decimalPlaces(candle.close),
    );
  }
  return Math.min(10, Number.isFinite(precision) ? precision : 2);
};

export const formatPrice = (value: number, precision: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

export const inferCandleTimeframeMinutes = (candles: Candle[]): number => {
  let intervalSeconds: number | null = null;
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].time - candles[index - 1].time;
    if (delta > 0 && (intervalSeconds == null || delta < intervalSeconds)) {
      intervalSeconds = delta;
    }
  }
  return Math.max(1, Math.round((intervalSeconds ?? 5 * 60) / 60));
};

export const aggregateCandles = (
  candles: Candle[],
  timeframeMinutes: number,
  sourceTimeframeMinutes = inferCandleTimeframeMinutes(candles),
) => {
  if (!candles.length) return [];
  if (!Number.isFinite(timeframeMinutes) || timeframeMinutes <= 0) return [];
  if (!Number.isFinite(sourceTimeframeMinutes) || sourceTimeframeMinutes <= 0) return [];
  if (timeframeMinutes === sourceTimeframeMinutes) return candles;
  if (timeframeMinutes < sourceTimeframeMinutes || timeframeMinutes % sourceTimeframeMinutes !== 0) return [];

  const timeframeSeconds = timeframeMinutes * 60;
  const buckets = new Map<number, Candle>();

  candles.forEach((candle) => {
    const time = Math.floor(candle.time / timeframeSeconds) * timeframeSeconds;
    const bucket = buckets.get(time);
    if (!bucket) {
      buckets.set(time, { ...candle, time });
      return;
    }
    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume += candle.volume;
  });

  return [...buckets.values()];
};

export const getMarketAssets = (name?: string) => {
  const symbol = (name?.split(/[·\s]/)[0] ?? "").toUpperCase();
  const quoteAsset = QUOTE_ASSETS.find(
    (value) => symbol.endsWith(value) && symbol.length > value.length,
  ) ?? "USDT";
  return {
    baseAsset: symbol.slice(0, -quoteAsset.length) || "COIN",
    quoteAsset,
  };
};
