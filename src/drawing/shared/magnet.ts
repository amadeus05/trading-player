/**
 * Магнит TradingView: слабый прилипает к OHLC в радиусе ~1.5 клетки сетки,
 * сильный — всегда к ближайшему OHLC свечи под курсором.
 */

import {
  coordinateToLogicalFloat,
  logicalToCoordinateFloat,
  snapXToNearestCandle,
  xToSnappedTime,
} from "./coordinates";
import { clampPlotX } from "./ManagedDrawingTool";
import type { ChartApiLike, ChartCandle, SeriesApiLike } from "./types";

export type MagnetMode = "off" | "weak" | "strong";

/** Слабый магнит: порог в клетках фоновой сетки графика. */
export const WEAK_MAGNET_GRID_CELLS = 1.5;

export type MagnetOhlcCandle = Pick<ChartCandle, "time" | "open" | "high" | "low" | "close">;

export interface MagnetCandidate {
  time: number;
  price: number;
  x: number;
  y: number;
}

export interface MagnetSnapInput {
  chart: ChartApiLike;
  series: SeriesApiLike;
  candles: ReadonlyArray<Partial<MagnetOhlcCandle> & { time: number }>;
  x: number;
  y: number;
  magnetMode: MagnetMode;
  plotHeight: number;
  clampX?: boolean;
  plotWidth?: number;
}

export interface MagnetSnapResult {
  x: number;
  y: number;
  time: number | null;
  price: number | null;
  magnetApplied: boolean;
}

export function isMagnetMode(value: string | null | undefined): value is MagnetMode {
  return value === "off" || value === "weak" || value === "strong";
}

export function hasOhlc(candle: Partial<MagnetOhlcCandle> & { time: number }): candle is MagnetOhlcCandle {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  );
}

/**
 * Шаг горизонтальной сетки графика. Без серии — оценка по высоте плота
 * (~9 линий). Со серией — измеряем клетку по видимому ценовому диапазону.
 */
export function estimateGridSizePx(plotHeight: number, series?: SeriesApiLike): number {
  if (!(plotHeight > 0)) return 48;
  if (series) {
    const pTop = series.coordinateToPrice(0);
    const pBot = series.coordinateToPrice(plotHeight);
    if (pTop != null && pBot != null && pTop !== pBot) {
      const lines = Math.max(4, Math.round(plotHeight / 56));
      const stepPrice = Math.abs(pBot - pTop) / lines;
      const y0 = series.priceToCoordinate(Math.min(pTop, pBot));
      const y1 = series.priceToCoordinate(Math.min(pTop, pBot) + stepPrice);
      if (y0 != null && y1 != null) {
        const px = Math.abs(y1 - y0);
        if (px > 8) return px;
      }
    }
  }
  return Math.min(80, Math.max(28, plotHeight / 9));
}

export function magnetPlotHeight(
  container: { clientHeight: number },
  chart: { timeScale(): { height(): number } },
): number {
  return Math.max(0, container.clientHeight - chart.timeScale().height());
}

export function weakMagnetRadiusPx(plotHeight: number, series?: SeriesApiLike): number {
  return estimateGridSizePx(plotHeight, series) * WEAK_MAGNET_GRID_CELLS;
}

/**
 * Горизонталь прыгает только по OHLC (high / close / open / low), не ездит по телу.
 * Слабый: внутри свечи (между high и low) — всегда к ближайшему из четырёх;
 * снаружи — только если |Δy| ≤ 1.5 клетки. Сильный: всегда ближайшая.
 */
export function pickMagnetCandidate(
  cursor: { x: number; y: number },
  candidates: readonly MagnetCandidate[],
  mode: MagnetMode,
  radiusPx: number,
): MagnetCandidate | null {
  if (mode === "off" || !candidates.length) return null;
  let best: MagnetCandidate | null = null;
  let bestDist = Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const candidate of candidates) {
    if (candidate.y < minY) minY = candidate.y;
    if (candidate.y > maxY) maxY = candidate.y;
    const dist = Math.abs(candidate.y - cursor.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  if (!best) return null;
  if (mode === "strong") return best;
  const insideCandle = cursor.y >= minY && cursor.y <= maxY;
  if (insideCandle || bestDist <= radiusPx) return best;
  return null;
}

export function ohlcPrices(candle: MagnetOhlcCandle): number[] {
  return [candle.open, candle.high, candle.low, candle.close];
}

export function collectMagnetCandidates(
  chart: ChartApiLike,
  series: SeriesApiLike,
  candles: MagnetSnapInput["candles"],
  centerIndex: number,
  neighborBars: number,
): MagnetCandidate[] {
  const candidates: MagnetCandidate[] = [];
  const from = Math.max(0, centerIndex - neighborBars);
  const to = Math.min(candles.length - 1, centerIndex + neighborBars);
  for (let index = from; index <= to; index += 1) {
    const candle = candles[index];
    if (!hasOhlc(candle)) continue;
    const x = logicalToCoordinateFloat(chart, index);
    if (x == null) continue;
    for (const price of ohlcPrices(candle)) {
      const y = series.priceToCoordinate(price);
      if (y == null) continue;
      candidates.push({ time: candle.time, price, x, y });
    }
  }
  return candidates;
}

function candleIndexAtX(chart: ChartApiLike, candlesLength: number, x: number): number | null {
  const logical = coordinateToLogicalFloat(chart, x);
  if (logical == null || !candlesLength) return null;
  const index = Math.round(logical);
  if (index < 0 || index >= candlesLength) return null;
  return index;
}

export function snapPointerForDrawing(input: MagnetSnapInput): MagnetSnapResult {
  let x = input.x;
  if (input.clampX) x = clampPlotX(x, input.plotWidth ?? 0);
  const snappedX = snapXToNearestCandle(input.chart, x);
  const time = xToSnappedTime(input.chart, snappedX, input.candles as Array<{ time: number }>);
  const rawPrice = input.series.coordinateToPrice(input.y);

  if (input.magnetMode === "off") {
    return { x: snappedX, y: input.y, time, price: rawPrice, magnetApplied: false };
  }

  const centerIndex = candleIndexAtX(input.chart, input.candles.length, x);
  if (centerIndex == null) {
    return { x: snappedX, y: input.y, time, price: rawPrice, magnetApplied: false };
  }

  const candidates = collectMagnetCandidates(
    input.chart,
    input.series,
    input.candles,
    centerIndex,
    0,
  );
  const picked = pickMagnetCandidate(
    { x, y: input.y },
    candidates,
    input.magnetMode,
    weakMagnetRadiusPx(input.plotHeight, input.series),
  );
  if (!picked) {
    return { x: snappedX, y: input.y, time, price: rawPrice, magnetApplied: false };
  }
  return {
    x: picked.x,
    y: picked.y,
    time: picked.time,
    price: picked.price,
    magnetApplied: true,
  };
}

export function snapPixelsWithMagnet(
  manager: { getMagnetMode(): MagnetMode },
  chart: ChartApiLike,
  series: SeriesApiLike,
  candles: MagnetSnapInput["candles"],
  x: number,
  y: number,
  plotHeight: number,
  extra?: { clampX?: boolean; plotWidth?: number },
): MagnetSnapResult {
  return snapPointerForDrawing({
    chart,
    series,
    candles,
    x,
    y,
    magnetMode: manager.getMagnetMode(),
    plotHeight,
    clampX: extra?.clampX,
    plotWidth: extra?.plotWidth,
  });
}
