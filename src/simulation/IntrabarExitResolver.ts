import type { Candle, Trade } from "../types";

export type ExitBarrier = Pick<Trade, "side" | "sl" | "tp">;

export type IntrabarResolution =
  | { kind: "resolved"; outcome: "TP" | "SL"; candleTime: number }
  | {
      kind: "fallback";
      reason:
        | "insufficient-data"
        | "irregular-data"
        | "incompatible-timeframe"
        | "incomplete-window"
        | "ambiguous-lower-candle";
    }
  | { kind: "not-hit" };

/**
 * Resolves TP/SL order from the smallest regular candle interval available.
 * Candle times and timeframe values are expressed in seconds.
 */
export class IntrabarExitResolver {
  private readonly normalizedSources = new WeakMap<readonly Candle[], { ordered: Candle[]; interval: number | null }>();

  private lowerBound(candles: readonly Candle[], targetTime: number): number {
    let low = 0;
    let high = candles.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candles[middle].time < targetTime) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private normalize(source: readonly Candle[]) {
    const cached = this.normalizedSources.get(source);
    if (cached) return cached;
    const ordered = [...source].sort((a, b) => a.time - b.time);
    let interval: number | null = null;
    for (let i = 1; i < ordered.length; i += 1) {
      const delta = ordered[i].time - ordered[i - 1].time;
      if (delta > 0 && (interval == null || delta < interval)) interval = delta;
    }
    const normalized = { ordered, interval };
    this.normalizedSources.set(source, normalized);
    return normalized;
  }

  resolve(
    source: readonly Candle[],
    parentOpenTime: number,
    parentTimeframeSeconds: number,
    barrier: ExitBarrier,
    playheadTime?: number,
  ): IntrabarResolution {
    if (source.length < 2) return { kind: "fallback", reason: "insufficient-data" };
    const { ordered, interval: lowerTimeframe } = this.normalize(source);
    if (lowerTimeframe == null) return { kind: "fallback", reason: "irregular-data" };
    if (lowerTimeframe >= parentTimeframeSeconds || parentTimeframeSeconds % lowerTimeframe !== 0) {
      return { kind: "fallback", reason: "incompatible-timeframe" };
    }

    const parentEnd = parentOpenTime + parentTimeframeSeconds;
    // Форвардный буфер уже содержит 5м после головы. График их не рисует —
    // SL/TP тоже не должен. Без playhead проверяем родителя целиком.
    const scanUntil = playheadTime == null ? parentEnd : Math.min(parentEnd, playheadTime + 1);
    if (scanUntil <= parentOpenTime) return { kind: "not-hit" };

    const windowStart = this.lowerBound(ordered, parentOpenTime);
    const windowEnd = this.lowerBound(ordered, scanUntil);
    const windowLength = windowEnd - windowStart;
    if (playheadTime == null) {
      const expectedCount = parentTimeframeSeconds / lowerTimeframe;
      if (
        windowLength !== expectedCount ||
        ordered[windowStart]?.time !== parentOpenTime ||
        ordered[windowEnd - 1]?.time !== parentEnd - lowerTimeframe
      ) {
        return { kind: "fallback", reason: "incomplete-window" };
      }
    } else {
      if (windowLength === 0) return { kind: "not-hit" };
      if (ordered[windowStart]?.time !== parentOpenTime) {
        return { kind: "fallback", reason: "incomplete-window" };
      }
      for (let offset = 0; offset < windowLength; offset += 1) {
        if (ordered[windowStart + offset].time !== parentOpenTime + offset * lowerTimeframe) {
          return { kind: "fallback", reason: "incomplete-window" };
        }
      }
    }

    for (let index = windowStart; index < windowEnd; index += 1) {
      const candle = ordered[index];
      const slHit = barrier.side === "LONG" ? candle.low <= barrier.sl : candle.high >= barrier.sl;
      const tpHit = barrier.side === "LONG" ? candle.high >= barrier.tp : candle.low <= barrier.tp;
      if (slHit && tpHit) return { kind: "fallback", reason: "ambiguous-lower-candle" };
      if (slHit) return { kind: "resolved", outcome: "SL", candleTime: candle.time };
      if (tpHit) return { kind: "resolved", outcome: "TP", candleTime: candle.time };
    }
    return { kind: "not-hit" };
  }
}
