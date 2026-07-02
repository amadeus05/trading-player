import type { Candle, Trade } from "../../../types";

export interface ChartPriceRange {
  from: number;
  to: number;
}

function roundPrice(price: number, pricePrecision: number): number {
  return Number(price.toFixed(pricePrecision));
}

function fallbackProtection(
  side: Trade["side"],
  entry: number,
  pricePrecision: number,
): { tp: number; sl: number } {
  if (side === "LONG") {
    return {
      tp: roundPrice(entry * 1.01, pricePrecision),
      sl: roundPrice(entry * 0.99, pricePrecision),
    };
  }
  return {
    tp: roundPrice(entry * 0.99, pricePrecision),
    sl: roundPrice(entry * 1.01, pricePrecision),
  };
}

export function buildInitialProtectionPrices(
  side: Trade["side"],
  entry: number,
  visibleRange: ChartPriceRange | null | undefined,
  candle: Candle,
  pricePrecision: number,
): { tp: number; sl: number } {
  const minStep = 10 ** -pricePrecision;
  const range = visibleRange && visibleRange.to > visibleRange.from
    ? visibleRange
    : candle.low < candle.high
      ? { from: candle.low, to: candle.high }
      : null;

  if (!range || range.to <= range.from) {
    return fallbackProtection(side, entry, pricePrecision);
  }

  const span = range.to - range.from;
  const edgePad = span * 0.1;
  const innerLow = range.from + edgePad;
  const innerHigh = range.to - edgePad;

  if (innerHigh <= innerLow + minStep) {
    return fallbackProtection(side, entry, pricePrecision);
  }

  if (side === "LONG") {
    const roomBelow = entry - innerLow;
    const roomAbove = innerHigh - entry;
    if (roomBelow <= minStep || roomAbove <= minStep) {
      return fallbackProtection(side, entry, pricePrecision);
    }
    const offset = Math.max(minStep, Math.min(roomBelow, roomAbove) * 0.55);
    return {
      sl: roundPrice(entry - offset, pricePrecision),
      tp: roundPrice(entry + offset, pricePrecision),
    };
  }

  const roomAbove = innerHigh - entry;
  const roomBelow = entry - innerLow;
  if (roomAbove <= minStep || roomBelow <= minStep) {
    return fallbackProtection(side, entry, pricePrecision);
  }
  const offset = Math.max(minStep, Math.min(roomAbove, roomBelow) * 0.55);
  return {
    sl: roundPrice(entry + offset, pricePrecision),
    tp: roundPrice(entry - offset, pricePrecision),
  };
}
