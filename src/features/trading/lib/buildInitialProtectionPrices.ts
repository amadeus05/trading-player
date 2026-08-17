import type { Candle, Trade } from "../../../types";

export interface ChartPriceRange {
  from: number;
  to: number;
}

function roundPrice(price: number, pricePrecision: number): number {
  return Number(price.toFixed(pricePrecision));
}

/** Медиана хода последних баров — выброс одной свечи не уносит стоп за край. */
function recentBarRange(candles: Candle[]): number {
  if (!candles.length) return 0;
  const start = Math.max(0, candles.length - 20);
  const ranges: number[] = [];
  for (let index = start; index < candles.length; index += 1) {
    const span = candles[index].high - candles[index].low;
    if (span > 0) ranges.push(span);
  }
  if (!ranges.length) {
    const last = candles[candles.length - 1];
    return Math.abs(last.close) * 0.002;
  }
  ranges.sort((left, right) => left - right);
  return ranges[Math.floor(ranges.length / 2)];
}

export function buildInitialProtectionPrices(
  side: Trade["side"],
  entry: number,
  visibleRange: ChartPriceRange | null | undefined,
  recentCandles: Candle[],
  pricePrecision: number,
): { tp: number; sl: number } {
  const minStep = 10 ** -pricePrecision;
  const atr = recentBarRange(recentCandles);
  let offset = Math.max(minStep * 8, Math.abs(entry) * 0.0025, atr * 1.6);

  const range = visibleRange && visibleRange.to > visibleRange.from ? visibleRange : null;
  if (range) {
    const span = range.to - range.from;
    // Запас под высоту пилюли (~20px): иначе стоп на краю шкалы обрезается.
    const pad = span * 0.16;
    const innerLow = range.from + pad;
    const innerHigh = range.to - pad;
    const roomBelow = entry - innerLow;
    const roomAbove = innerHigh - entry;
    if (roomBelow > minStep * 4 && roomAbove > minStep * 4) {
      offset = Math.min(offset, roomBelow, roomAbove);
    }
  }

  if (side === "LONG") {
    return {
      sl: roundPrice(entry - offset, pricePrecision),
      tp: roundPrice(entry + offset, pricePrecision),
    };
  }
  return {
    sl: roundPrice(entry + offset, pricePrecision),
    tp: roundPrice(entry - offset, pricePrecision),
  };
}
