import type { Candle } from "../../types";

const QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"] as const;

export const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Всё время в приложении — рыночное UTC, как и ось графика (lightweight-charts
 * рисует её в UTC). Без явной зоны часы плеера показывали местное время, и
 * «начало суток» на часах не совпадало с началом дневной свечи: летом на три
 * часа. На младших ТФ это почти незаметно, а на 1д уводило в предыдущие сутки.
 */
export const formatDateTime = (timestamp: number) =>
  new Date(timestamp * 1_000).toLocaleString("ru-RU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatMarketDate = (timestampMs: number) =>
  new Date(timestampMs).toLocaleDateString("ru-RU", {
    timeZone: "UTC",
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
  if (!Number.isFinite(value) || value === 0) return 0;
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const places = Number(text.split("e-")[1]);
    return Number.isFinite(places) ? places : 0;
  }
  // toFixed отрезает двоичный хвост (0.973399999… → 0.9734), toString его оставляет.
  const trimmed = value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return trimmed.includes(".") ? trimmed.length - trimmed.indexOf(".") - 1 : 0;
};

/**
 * Сколько знаков нужно, чтобы шкала не склеивала соседние цены.
 * ADA ~0.97 на двух знаках даёт шаг 0.01 — фибо, стоп и тейк садятся в одни
 * и те же уровни, а ось прыгает по крупной сетке.
 */
const magnitudePrecision = (price: number) => {
  const abs = Math.abs(price);
  if (abs >= 1_000) return 2;
  if (abs >= 100) return 2;
  if (abs >= 10) return 3;
  if (abs >= 1) return 4;
  if (abs >= 0.1) return 5;
  if (abs >= 0.01) return 6;
  if (abs >= 0.001) return 7;
  return 8;
};

const tickPrecision = (prices: number[]) => {
  let minDelta = Infinity;
  let previous = Number.NaN;
  const sorted = prices.filter(Number.isFinite).sort((left, right) => left - right);
  for (const price of sorted) {
    if (Number.isFinite(previous)) {
      const delta = price - previous;
      if (delta > 0 && delta < minDelta) minDelta = delta;
    }
    previous = price;
  }
  if (!Number.isFinite(minDelta) || minDelta <= 0) return 0;
  return Math.max(0, Math.min(10, Math.ceil(-Math.log10(minDelta) - 1e-10)));
};

export const inferPricePrecision = (candles: Candle[]) => {
  if (!candles.length) return 2;
  let fromValues = 0;
  const prices: number[] = [];
  const step = Math.max(1, Math.floor(candles.length / 4_000));
  for (let index = 0; index < candles.length; index += step) {
    const candle = candles[index];
    fromValues = Math.max(
      fromValues,
      decimalPlaces(candle.open),
      decimalPlaces(candle.high),
      decimalPlaces(candle.low),
      decimalPlaces(candle.close),
    );
    prices.push(candle.open, candle.high, candle.low, candle.close);
  }
  const mid = candles[Math.floor(candles.length / 2)]?.close ?? candles[0].close;
  const precision = Math.max(
    magnitudePrecision(mid),
    tickPrecision(prices),
    fromValues,
  );
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
