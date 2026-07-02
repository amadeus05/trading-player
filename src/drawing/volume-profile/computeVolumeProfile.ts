import type { Candle, VolumeProfile } from "../../types";

export interface VolumeProfileBin {
  low: number;
  high: number;
  buyVolume: number;
  sellVolume: number;
}

export interface VolumeProfileResult {
  bins: VolumeProfileBin[];
  rangeLow: number;
  rangeHigh: number;
  step: number;
  maxVolume: number;
  totalVolume: number;
  pocIndex: number;
  pocPrice: number;
  valueAreaLow: number;
  valueAreaHigh: number;
}

/** Ports the Pine Script "Manual Session Volume Profile" bucketing/POC/value-area math to TS. */
export function computeVolumeProfile(
  rawCandles: Candle[],
  timeLeft: number,
  timeRight: number,
  rows: number,
  valueAreaPct: number,
  splitMode: VolumeProfile["splitMode"],
): VolumeProfileResult | null {
  const lo = Math.min(timeLeft, timeRight);
  const hi = Math.max(timeLeft, timeRight);
  const inRange = rawCandles.filter((c) => c.time >= lo && c.time <= hi);
  if (!inRange.length) return null;

  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  for (const c of inRange) {
    if (c.high > rangeHigh) rangeHigh = c.high;
    if (c.low < rangeLow) rangeLow = c.low;
  }
  if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow)) return null;

  let step = (rangeHigh - rangeLow) / rows;
  if (step <= 0) step = Math.max(rangeHigh * 0.0001, 0.00000001);

  const buyVol = new Array<number>(rows).fill(0);
  const sellVol = new Array<number>(rows).fill(0);

  for (const c of inRange) {
    const { high: h, low: l, open: o, close: cl, volume: v } = c;
    const hl = h - l;
    let buyRatio = 0.5;
    if (splitMode === "candle") {
      buyRatio = cl > o ? 1 : cl < o ? 0 : 0.5;
    } else {
      buyRatio = hl > 0 ? Math.max(0, Math.min(1, (cl - l) / hl)) : 0.5;
    }
    const bvBar = v * buyRatio;
    const svBar = v - bvBar;
    const li = Math.max(0, Math.min(Math.floor((l - rangeLow) / step), rows - 1));
    const hiIdx = Math.max(0, Math.min(Math.floor((h - rangeLow) / step), rows - 1));
    for (let j = li; j <= hiIdx; j += 1) {
      let part: number;
      if (hl > 0) {
        const overlap = Math.max(0, Math.min(h, rangeLow + (j + 1) * step) - Math.max(l, rangeLow + j * step));
        part = overlap / hl;
      } else {
        part = j === li ? 1 : 0;
      }
      buyVol[j] += bvBar * part;
      sellVol[j] += svBar * part;
    }
  }

  let maxVolume = 0;
  let totalVolume = 0;
  let pocIndex = 0;
  for (let i = 0; i < rows; i += 1) {
    const tv = buyVol[i] + sellVol[i];
    totalVolume += tv;
    const midpointDistance = Math.abs(i + 0.5 - rows / 2);
    const pocMidpointDistance = Math.abs(pocIndex + 0.5 - rows / 2);
    if (tv > maxVolume || (tv === maxVolume && midpointDistance < pocMidpointDistance)) {
      maxVolume = tv;
      pocIndex = i;
    }
  }

  let upper = pocIndex;
  let lower = pocIndex;
  let vaAccum = maxVolume;
  const rowVolume = (index: number) => buyVol[index] + sellVol[index];
  while (vaAccum < totalVolume * valueAreaPct && (upper < rows - 1 || lower > 0)) {
    const uv = upper < rows - 1
      ? rowVolume(upper + 1) + (upper < rows - 2 ? rowVolume(upper + 2) : 0)
      : -1;
    const dv = lower > 0
      ? rowVolume(lower - 1) + (lower > 1 ? rowVolume(lower - 2) : 0)
      : -1;
    if (uv >= dv && upper < rows - 1) {
      const nextUpper = Math.min(rows - 1, upper + 2);
      for (let i = upper + 1; i <= nextUpper; i += 1) vaAccum += rowVolume(i);
      upper = nextUpper;
    } else if (lower > 0) {
      const nextLower = Math.max(0, lower - 2);
      for (let i = lower - 1; i >= nextLower; i -= 1) vaAccum += rowVolume(i);
      lower = nextLower;
    } else {
      break;
    }
  }

  const bins: VolumeProfileBin[] = [];
  for (let i = 0; i < rows; i += 1) {
    bins.push({
      low: rangeLow + i * step,
      high: rangeLow + (i + 1) * step,
      buyVolume: buyVol[i],
      sellVolume: sellVol[i],
    });
  }

  return {
    bins,
    rangeLow,
    rangeHigh,
    step,
    maxVolume,
    totalVolume,
    pocIndex,
    pocPrice: rangeLow + pocIndex * step + step * 0.5,
    valueAreaLow: rangeLow + lower * step,
    valueAreaHigh: rangeLow + (upper + 1) * step,
  };
}
