/**
 * Fair Value Gap (FVG): 3-свечный гэп ICT/SMC.
 * Контур — на всю исходную зону. Заливка — только непоглощённый остаток
 * (та же заливка, что раньше; у поглощённой части внутри контура пусто).
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle } from "../../types";
import { logicalToCoordinateFloat, timeToLogical } from "../../drawing/shared/coordinates";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Показывать полностью поглощённые FVG (только контур, без заливки).
 * По умолчанию скрыты — поставь `true`, если снова нужны на графике.
 */
const SHOW_FILLED_FVG = false;

export type FvgDirection = "bullish" | "bearish";

export interface FvgZone {
  direction: FvgDirection;
  startTime: number;
  endTime: number;
  top: number;
  bottom: number;
  remainTop: number;
  remainBottom: number;
  filled: boolean;
}

interface FvgOverlayOptions {
  container: HTMLElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: { candles: Candle[] };
  visible: boolean;
}

interface FvgCell {
  group: SVGGElement;
  fill: SVGRectElement;
  outline: SVGRectElement;
}

function barDuration(candles: Candle[]): number {
  if (candles.length < 2) return 60;
  return Math.max(1, candles[1].time - candles[0].time);
}

function setRect(rect: SVGRectElement, x: number, y: number, width: number, height: number) {
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
}

/**
 * X-диапазон зоны, обрезанный по видимому окну.
 * Важно: у длинного FVG оба конца могут быть за краем экрана — timeToX тогда
 * даёт null/null и зона пропадалa при панорамировании. Считаем через logical.
 */
function zoneScreenX(
  chart: IChartApi,
  startTime: number,
  endTime: number,
  candles: Candle[],
  plotWidth: number,
): { x1: number; x2: number } | null {
  const startLogical = timeToLogical(startTime, candles);
  const endLogical = timeToLogical(endTime, candles);
  const visible = chart.timeScale().getVisibleLogicalRange();
  if (startLogical == null || endLogical == null || !visible) return null;

  const zoneLeft = Math.min(startLogical, endLogical);
  const zoneRight = Math.max(startLogical, endLogical);
  if (zoneRight < visible.from || zoneLeft > visible.to) return null;

  const clippedFrom = Math.max(zoneLeft, visible.from);
  const clippedTo = Math.min(zoneRight, visible.to);
  if (clippedTo <= clippedFrom) return null;

  let x1 = logicalToCoordinateFloat(chart, clippedFrom);
  let x2 = logicalToCoordinateFloat(chart, clippedTo);
  // На самом краю видимого диапазона LWC иногда не отдаёт координату.
  if (x1 == null) x1 = clippedFrom <= visible.from ? 0 : null;
  if (x2 == null) x2 = clippedTo >= visible.to ? plotWidth : null;
  if (x1 == null || x2 == null) return null;

  x1 = Math.max(0, Math.min(x1, plotWidth));
  x2 = Math.max(0, Math.min(x2, plotWidth));
  if (x2 - x1 < 1) return null;
  return { x1, x2 };
}

/**
 * Bullish: цена заходит сверху → remainTop опускается.
 * Bearish: цена заходит снизу → remainBottom поднимается.
 */
export function detectFairValueGaps(candles: Candle[]): FvgZone[] {
  if (candles.length < 3) return [];
  const duration = barDuration(candles);
  const headEnd = candles[candles.length - 1].time + duration / 2;
  const zones: FvgZone[] = [];

  for (let i = 2; i < candles.length; i += 1) {
    const first = candles[i - 2];
    const third = candles[i];
    const startTime = third.time;

    if (first.high < third.low) {
      const bottom = first.high;
      const top = third.low;
      let remainTop = top;
      const remainBottom = bottom;
      let endTime = headEnd;
      let filled = false;
      for (let j = i + 1; j < candles.length; j += 1) {
        const low = candles[j].low;
        if (low <= remainBottom) {
          remainTop = remainBottom;
          endTime = candles[j].time;
          filled = true;
          break;
        }
        if (low < remainTop) remainTop = low;
      }
      zones.push({ direction: "bullish", startTime, endTime, top, bottom, remainTop, remainBottom, filled });
      continue;
    }

    if (first.low > third.high) {
      const top = first.low;
      const bottom = third.high;
      const remainTop = top;
      let remainBottom = bottom;
      let endTime = headEnd;
      let filled = false;
      for (let j = i + 1; j < candles.length; j += 1) {
        const high = candles[j].high;
        if (high >= remainTop) {
          remainBottom = remainTop;
          endTime = candles[j].time;
          filled = true;
          break;
        }
        if (high > remainBottom) remainBottom = high;
      }
      zones.push({ direction: "bearish", startTime, endTime, top, bottom, remainTop, remainBottom, filled });
    }
  }

  return zones;
}

export function attachFvgOverlay({
  container,
  chart,
  series,
  candleStore,
  visible,
}: FvgOverlayOptions) {
  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.classList.add("fvg-overlay");
  container.appendChild(overlay);

  const pool: FvgCell[] = [];
  let cachedSig = "";
  let cachedZones: FvgZone[] = [];

  const acquire = (index: number): FvgCell => {
    let cell = pool[index];
    if (cell) return cell;
    const group = document.createElementNS(SVG_NS, "g");
    // Сначала заливка остатка, поверх — контур всей зоны.
    const fill = document.createElementNS(SVG_NS, "rect");
    fill.setAttribute("class", "fvg-fill");
    const outline = document.createElementNS(SVG_NS, "rect");
    outline.setAttribute("class", "fvg-outline");
    group.append(fill, outline);
    overlay.appendChild(group);
    cell = { group, fill, outline };
    pool[index] = cell;
    return cell;
  };

  const hideFrom = (index: number) => {
    for (let i = index; i < pool.length; i += 1) {
      pool[i].group.setAttribute("display", "none");
    }
  };

  const zonesFor = (candles: Candle[]) => {
    const last = candles.at(-1);
    const sig = `${candles.length}|${last?.time ?? 0}|${last?.high ?? 0}|${last?.low ?? 0}`;
    if (sig === cachedSig) return cachedZones;
    cachedSig = sig;
    cachedZones = detectFairValueGaps(candles);
    return cachedZones;
  };

  const sync = () => {
    if (!visible) {
      hideFrom(0);
      return;
    }
    const candles = candleStore.candles;
    if (candles.length < 3) {
      hideFrom(0);
      return;
    }

    const plotWidth = Math.max(0, Number(chart.timeScale().width()) || 0);
    if (plotWidth < 1) {
      hideFrom(0);
      return;
    }

    const zones = zonesFor(candles);
    let used = 0;

    for (const zone of zones) {
      if (!SHOW_FILLED_FVG && zone.filled) continue;

      const xs = zoneScreenX(chart, zone.startTime, zone.endTime, candles, plotWidth);
      if (!xs) continue;
      const width = xs.x2 - xs.x1;

      const yTop = series.priceToCoordinate(zone.top);
      const yBottom = series.priceToCoordinate(zone.bottom);
      if (yTop == null || yBottom == null) continue;

      const outlineY = Math.min(yTop, yBottom);
      const outlineH = Math.abs(yBottom - yTop);
      if (outlineH < 1) continue;

      const cell = acquire(used);
      used += 1;
      cell.group.removeAttribute("display");
      cell.outline.setAttribute("class", `fvg-outline fvg-outline--${zone.direction}`);
      setRect(cell.outline, xs.x1, outlineY, width, outlineH);

      const hasRemain = !zone.filled && zone.remainTop > zone.remainBottom;
      if (!hasRemain) {
        cell.fill.setAttribute("display", "none");
        continue;
      }

      const yRemainTop = series.priceToCoordinate(zone.remainTop);
      const yRemainBottom = series.priceToCoordinate(zone.remainBottom);
      if (yRemainTop == null || yRemainBottom == null) {
        cell.fill.setAttribute("display", "none");
        continue;
      }
      const fillY = Math.min(yRemainTop, yRemainBottom);
      const fillH = Math.abs(yRemainBottom - yRemainTop);
      if (fillH < 1) {
        cell.fill.setAttribute("display", "none");
        continue;
      }
      cell.fill.removeAttribute("display");
      cell.fill.setAttribute("class", `fvg-fill fvg-fill--${zone.direction}`);
      setRect(cell.fill, xs.x1, fillY, width, fillH);
    }

    hideFrom(used);
  };

  return { sync, destroy: () => overlay.remove() };
}
