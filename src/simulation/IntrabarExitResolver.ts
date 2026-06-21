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
  ): IntrabarResolution {
    if (source.length < 2) return { kind: "fallback", reason: "insufficient-data" };
    const { ordered, interval: lowerTimeframe } = this.normalize(source);
    if (lowerTimeframe == null) return { kind: "fallback", reason: "irregular-data" };
    if (lowerTimeframe >= parentTimeframeSeconds || parentTimeframeSeconds % lowerTimeframe !== 0) {
      return { kind: "fallback", reason: "incompatible-timeframe" };
    }

    const expectedCount = parentTimeframeSeconds / lowerTimeframe;
    const endTime = parentOpenTime + parentTimeframeSeconds;
    const window = ordered.filter((candle) => candle.time >= parentOpenTime && candle.time < endTime);
    if (
      window.length !== expectedCount ||
      window[0]?.time !== parentOpenTime ||
      window.at(-1)?.time !== endTime - lowerTimeframe
    ) {
      return { kind: "fallback", reason: "incomplete-window" };
    }

    for (const candle of window) {
      const slHit = barrier.side === "LONG" ? candle.low <= barrier.sl : candle.high >= barrier.sl;
      const tpHit = barrier.side === "LONG" ? candle.high >= barrier.tp : candle.low <= barrier.tp;
      if (slHit && tpHit) return { kind: "fallback", reason: "ambiguous-lower-candle" };
      if (slHit) return { kind: "resolved", outcome: "SL", candleTime: candle.time };
      if (tpHit) return { kind: "resolved", outcome: "TP", candleTime: candle.time };
    }
    return { kind: "not-hit" };
  }
}
