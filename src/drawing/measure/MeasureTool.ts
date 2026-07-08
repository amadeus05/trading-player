/**
 * MeasureTool – TradingView-style ruler overlay.
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle } from "../../types";
import { timeToLogical, timeToX, xToTime } from "../shared/coordinates";
import { bindDrawingPointerClick } from "../shared/drawingPointerClick";
import { createDrawingOverlay } from "../shared/overlay";
import type { ManagedDrawingToolOptions, ChartCandleStore, SeriesApiLike } from "../shared/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const TV_BLUE = "#2962FF";
const TV_RED = "#F23645";

function clampPrecision(precision: number): number {
  if (!Number.isFinite(precision)) return 2;
  return Math.max(0, Math.min(10, Math.round(precision)));
}

function pxToPrice(series: SeriesApiLike, y: number): number | null {
  return series.coordinateToPrice(y);
}

function formatPrice(value: number, precision: number): string {
  const p = clampPrecision(precision);
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: p,
    maximumFractionDigits: p,
  });
}

function formatPercent(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function formatTimeSpan(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${(abs / 3600).toFixed(1)}h`;
  const days = Math.round(abs / 86400);
  return `${days}d`;
}

function formatVolume(vol: number): string {
  if (vol >= 1e12) return `${(vol / 1e12).toFixed(2)}T`;
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toFixed(0);
}

function formatTicks(delta: number, precision: number): string {
  const minMove = 10 ** -clampPrecision(precision);
  if (!Number.isFinite(delta) || minMove <= 0) return "—";
  const ticks = Math.abs(delta / minMove);
  if (!Number.isFinite(ticks)) return "—";
  if (ticks >= 1000) return ticks.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (ticks >= 1) return ticks.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return ticks.toFixed(2);
}

function formatAxisTime(unixSec: number, timeframeSec: number): string {
  const d = new Date(unixSec * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(2);
  const datePart = `${days[d.getUTCDay()]} ${dd} ${months[d.getUTCMonth()]} '${yy}`;
  if (timeframeSec < 86400) {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${datePart} ${hh}:${mm}`;
  }
  return datePart;
}

function makeLine(className: string): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("class", className);
  line.style.visibility = "hidden";
  return line;
}

function makeAxisLabel(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.style.visibility = "hidden";
  return el;
}

export function attachMeasureTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  active: boolean;
  pricePrecision: number;
  onComplete: () => void;
}): () => void {
  const { container, chart, series, candleStore, pricePrecision, onComplete, manager } = opts;

  let volumePrefix = new Float64Array(0);
  const ensureVolumePrefix = () => {
    const candles = candleStore.candles;
    if (volumePrefix.length === candles.length + 1) return;
    volumePrefix = new Float64Array(candles.length + 1);
    for (let i = 0; i < candles.length; i += 1) volumePrefix[i + 1] = volumePrefix[i] + (candles[i].volume ?? 0);
  };
  const timeframeSec = () => {
    const candles = candleStore.candles;
    return candles.length > 1 ? candles[1].time - candles[0].time : 3600;
  };
  const lowerBound = (time: number) => {
    const candles = candleStore.candles;
    let low = 0, high = candles.length;
    while (low < high) { const middle = (low + high) >> 1; if (candles[middle].time < time) low = middle + 1; else high = middle; }
    return low;
  };
  const upperBound = (time: number) => {
    const candles = candleStore.candles;
    let low = 0, high = candles.length;
    while (low < high) { const middle = (low + high) >> 1; if (candles[middle].time <= time) low = middle + 1; else high = middle; }
    return low;
  };

  const overlay = createDrawingOverlay(container, chart, "measure-overlay");
  const { svg } = overlay;
  const drawingGroup = overlay.createClippedGroup();

  const defs = document.createElementNS(SVG_NS, "defs");
  const arrowMarker = document.createElementNS(SVG_NS, "marker");
  arrowMarker.setAttribute("id", "measure-arrow");
  arrowMarker.setAttribute("viewBox", "0 0 10 10");
  arrowMarker.setAttribute("refX", "5");
  arrowMarker.setAttribute("refY", "5");
  arrowMarker.setAttribute("markerWidth", "6");
  arrowMarker.setAttribute("markerHeight", "6");
  arrowMarker.setAttribute("orient", "auto-start-reverse");
  const arrowPath = document.createElementNS(SVG_NS, "path");
  arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrowPath.setAttribute("fill", TV_BLUE);
  arrowMarker.appendChild(arrowPath);
  defs.appendChild(arrowMarker);
  svg.appendChild(defs);

  const tooltip = document.createElement("div");
  tooltip.className = "measure-tooltip";
  tooltip.style.display = "none";
  container.appendChild(tooltip);

  const axisLayer = document.createElement("div");
  axisLayer.className = "measure-axis-layer";
  const priceLabelTop = makeAxisLabel("measure-axis-label measure-axis-label--price");
  const priceLabelBottom = makeAxisLabel("measure-axis-label measure-axis-label--price");
  const timeLabelLeft = makeAxisLabel("measure-axis-label measure-axis-label--time");
  const timeLabelRight = makeAxisLabel("measure-axis-label measure-axis-label--time");
  axisLayer.append(priceLabelTop, priceLabelBottom, timeLabelLeft, timeLabelRight);
  container.appendChild(axisLayer);

  let point1: { time: number; price: number; px: { x: number; y: number } } | null = null;
  let point2: { time: number; price: number; px: { x: number; y: number } } | null = null;
  let completed = false;
  let cachedStatsKey = "";
  let cachedStats: ReturnType<typeof calculateStats> | null = null;
  let lastCompletedRenderKey = "";

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "measure-rect");
  rect.style.visibility = "hidden";
  drawingGroup.appendChild(rect);

  const crossH = makeLine("measure-cross");
  const crossV = makeLine("measure-cross");
  crossH.setAttribute("marker-start", "url(#measure-arrow)");
  crossH.setAttribute("marker-end", "url(#measure-arrow)");
  crossV.setAttribute("marker-start", "url(#measure-arrow)");
  crossV.setAttribute("marker-end", "url(#measure-arrow)");
  drawingGroup.append(crossH, crossV);

  const guideTop = makeLine("measure-guide");
  const guideBottom = makeLine("measure-guide");
  const guideLeft = makeLine("measure-guide");
  const guideRight = makeLine("measure-guide");
  drawingGroup.append(guideTop, guideBottom, guideLeft, guideRight);

  function toPixel(pt: { time: number; price: number }): { x: number; y: number } | null {
    const x = timeToX(chart, pt.time, candleStore.candles);
    const y = series.priceToCoordinate(pt.price);
    if (x == null || y == null) return null;
    return { x, y };
  }

  function getLayout() {
    const { width, height } = container.getBoundingClientRect();
    const priceScaleWidth = Math.max(70, chart.priceScale("right").width());
    const timeScaleHeight = Math.max(28, chart.timeScale().height?.() ?? 28);
    return { width, height, priceScaleWidth, timeScaleHeight, plotRight: width - priceScaleWidth, plotBottom: height - timeScaleHeight };
  }

  function calculateStats(p1: { time: number; price: number }, p2: { time: number; price: number }) {
    ensureVolumePrefix();
    const priceDelta = p2.price - p1.price;
    const pctChange = p1.price !== 0 ? (priceDelta / p1.price) * 100 : 0;
    const timeDelta = p2.time - p1.time;
    const logical1 = timeToLogical(p1.time, candleStore.candles);
    const logical2 = timeToLogical(p2.time, candleStore.candles);
    const barCount = logical1 != null && logical2 != null ? Math.round(Math.abs(logical2 - logical1)) : 0;
    const tMin = Math.min(p1.time, p2.time);
    const tMax = Math.max(p1.time, p2.time);
    const volumeFrom = lowerBound(tMin);
    const volumeTo = upperBound(tMax);
    const totalVolume = volumePrefix[volumeTo] - volumePrefix[volumeFrom];
    return { priceDelta, pctChange, timeDelta, barCount, totalVolume };
  }

  function showSvg(el: SVGElement) {
    el.style.visibility = "visible";
  }

  function hideSvg(el: SVGElement) {
    el.style.visibility = "hidden";
  }

  function showPriceLabel(el: HTMLDivElement, text: string, y: number, priceScaleWidth: number) {
    el.textContent = text;
    el.style.left = "";
    el.style.right = "0";
    el.style.top = `${y}px`;
    el.style.width = `${priceScaleWidth}px`;
    el.style.transform = "translateY(-50%)";
    el.style.visibility = "visible";
  }

  function showTimeLabel(el: HTMLDivElement, text: string, x: number, plotBottom: number, timeScaleHeight: number) {
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.right = "";
    el.style.width = "";
    el.style.top = `${plotBottom + Math.max(2, (timeScaleHeight - 20) / 2)}px`;
    el.style.transform = "translateX(-50%)";
    el.style.visibility = "visible";
  }

  function hideLabel(el: HTMLDivElement) {
    el.style.visibility = "hidden";
  }

  function setMeasureTheme(isDown: boolean) {
    const color = isDown ? TV_RED : TV_BLUE;
    const fill = isDown ? "rgba(242, 54, 69, 0.16)" : "rgba(41, 98, 255, 0.16)";
    rect.style.fill = fill;
    crossH.style.stroke = color;
    crossV.style.stroke = color;
    arrowPath.setAttribute("fill", color);
    tooltip.style.background = color;
    for (const label of [priceLabelTop, priceLabelBottom, timeLabelLeft, timeLabelRight]) {
      label.style.background = color;
    }
  }

  function render(
    px1: { x: number; y: number },
    px2: { x: number; y: number },
    data: { p1: { time: number; price: number }; p2: { time: number; price: number } },
  ) {
    const { width, plotRight, plotBottom, priceScaleWidth, timeScaleHeight } = getLayout();

    const x1 = px1.x, y1 = px1.y;
    const x2 = px2.x, y2 = px2.y;

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);
    const rw = Math.max(1, right - left);
    const rh = Math.max(1, bottom - top);

    rect.setAttribute("x", String(left));
    rect.setAttribute("y", String(top));
    rect.setAttribute("width", String(rw));
    rect.setAttribute("height", String(rh));
    showSvg(rect);

    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;

    crossH.setAttribute("x1", String(left));
    crossH.setAttribute("y1", String(cy));
    crossH.setAttribute("x2", String(right));
    crossH.setAttribute("y2", String(cy));
    showSvg(crossH);

    crossV.setAttribute("x1", String(cx));
    crossV.setAttribute("y1", String(top));
    crossV.setAttribute("x2", String(cx));
    crossV.setAttribute("y2", String(bottom));
    showSvg(crossV);

    guideTop.setAttribute("x1", String(left));
    guideTop.setAttribute("y1", String(top));
    guideTop.setAttribute("x2", String(plotRight));
    guideTop.setAttribute("y2", String(top));
    showSvg(guideTop);

    guideBottom.setAttribute("x1", String(left));
    guideBottom.setAttribute("y1", String(bottom));
    guideBottom.setAttribute("x2", String(plotRight));
    guideBottom.setAttribute("y2", String(bottom));
    if (bottom - top > 3) showSvg(guideBottom);
    else hideSvg(guideBottom);

    guideLeft.setAttribute("x1", String(left));
    guideLeft.setAttribute("y1", String(top));
    guideLeft.setAttribute("x2", String(left));
    guideLeft.setAttribute("y2", String(plotBottom));
    showSvg(guideLeft);

    guideRight.setAttribute("x1", String(right));
    guideRight.setAttribute("y1", String(top));
    guideRight.setAttribute("x2", String(right));
    guideRight.setAttribute("y2", String(plotBottom));
    if (right - left > 3) showSvg(guideRight);
    else hideSvg(guideRight);

    const highPrice = Math.max(data.p1.price, data.p2.price);
    const lowPrice = Math.min(data.p1.price, data.p2.price);
    const earlyTime = Math.min(data.p1.time, data.p2.time);
    const lateTime = Math.max(data.p1.time, data.p2.time);

    showPriceLabel(priceLabelTop, formatPrice(highPrice, pricePrecision), top, priceScaleWidth);
    showPriceLabel(priceLabelBottom, formatPrice(lowPrice, pricePrecision), bottom, priceScaleWidth);
    showTimeLabel(timeLabelLeft, formatAxisTime(earlyTime, timeframeSec()), left, plotBottom, timeScaleHeight);
    showTimeLabel(timeLabelRight, formatAxisTime(lateTime, timeframeSec()), right, plotBottom, timeScaleHeight);
  }

  function hideAll() {
    [rect, crossH, crossV, guideTop, guideBottom, guideLeft, guideRight].forEach(hideSvg);
    [priceLabelTop, priceLabelBottom, timeLabelLeft, timeLabelRight].forEach(hideLabel);
    tooltip.style.display = "none";
  }

  function resetMeasurement() {
    point1 = null;
    point2 = null;
    completed = false;
    cachedStatsKey = "";
    cachedStats = null;
    lastCompletedRenderKey = "";
    hideAll();
  }

  function updateTooltip(px1: { x: number; y: number }, px2: { x: number; y: number }, stats: ReturnType<typeof calculateStats>) {
    const { priceDelta, pctChange, barCount, timeDelta, totalVolume } = stats;
    const absDelta = Math.abs(priceDelta);
    const ticks = formatTicks(priceDelta, pricePrecision);

    tooltip.innerHTML = `
      <div class="measure-tooltip-row measure-tooltip-main">
        ${formatPrice(absDelta, pricePrecision)}&nbsp;&nbsp;(${formatPercent(pctChange)})&nbsp;&nbsp;${ticks}
      </div>
      <div class="measure-tooltip-row measure-tooltip-sub">
        ${barCount} bars,&nbsp;&nbsp;${formatTimeSpan(timeDelta)}
      </div>
      <div class="measure-tooltip-row measure-tooltip-sub">
        Vol ${formatVolume(totalVolume)}
      </div>
    `;
    tooltip.style.display = "block";

    const left = Math.min(px1.x, px2.x);
    const top = Math.min(px1.y, px2.y);
    const centerX = (px1.x + px2.x) / 2;
    const tw = tooltip.offsetWidth || 200;
    const th = tooltip.offsetHeight || 60;

    let tooltipX = centerX - tw / 2;
    let tooltipY = top - th - 8;

    const { width } = getLayout();
    if (tooltipX + tw > width - 8) tooltipX = width - tw - 8;
    if (tooltipX < 8) tooltipX = 8;
    if (tooltipY < 8) tooltipY = Math.max(px1.y, px2.y) + 8;

    tooltip.style.left = `${tooltipX}px`;
    tooltip.style.top = `${tooltipY}px`;
  }

  function drawMeasurement(
    p1: { time: number; price: number },
    p2: { time: number; price: number },
    px1: { x: number; y: number },
    px2: { x: number; y: number },
  ) {
    const statsKey = `${p1.time}:${p1.price}:${p2.time}:${p2.price}`;
    if (statsKey !== cachedStatsKey || !cachedStats) {
      cachedStatsKey = statsKey;
      cachedStats = calculateStats(p1, p2);
    }
    const stats = cachedStats;
    setMeasureTheme(stats.priceDelta < 0);
    render(px1, px2, { p1, p2 });
    updateTooltip(px1, px2, stats);
  }

  function handleDrawClick(event: any) {
    if (manager.getMode() !== "measure") return;
    if (completed) return;
    const bounds = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    const x = sourceEvent ? sourceEvent.clientX - bounds.left : null;
    const y = sourceEvent ? sourceEvent.clientY - bounds.top : null;
    const time = x != null ? xToTime(chart, x, candleStore.candles) : (event.time as number | undefined);
    const price = y != null ? pxToPrice(series, y) : null;
    if (time == null || price == null || price <= 0) return;

    if (!point1) {
      point1 = { time, price, px: { x: x!, y: y! } };
    } else {
      point2 = { time, price, px: { x: x!, y: y! } };
      completed = true;
      const p1px = toPixel(point1) || point1.px;
      const p2px = toPixel(point2) || point2.px;
      drawMeasurement(point1, point2, p1px, p2px);
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (manager.getMode() !== "measure") return;
    if (completed || !point1) return;
    const bounds = container.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const p1px = toPixel(point1) || point1.px;
    const time2 = xToTime(chart, x, candleStore.candles);
    const price2 = pxToPrice(series, y);
    if (time2 == null || price2 == null || price2 <= 0) return;
    drawMeasurement(point1, { time: time2, price: price2 }, p1px, { x, y });
  }

  function syncOverlayPositions() {
    overlay.sync();
    if (point1) {
      const p1px = toPixel(point1);
      if (p1px) {
        point1.px = p1px;
        if (point2) {
          const p2px = toPixel(point2);
          if (p2px) {
            point2.px = p2px;
            const renderKey = `${p1px.x}:${p1px.y}:${p2px.x}:${p2px.y}`;
            if (renderKey !== lastCompletedRenderKey) {
              lastCompletedRenderKey = renderKey;
              drawMeasurement(point1, point2, p1px, p2px);
            }
          }
        }
      }
    }
  }

  const unregisterOverlaySync = manager.registerOverlaySync(syncOverlayPositions);

  // Cancel an in-progress (or completed) measurement when switching to another tool.
  const unregisterModeChange = manager.registerModeChange((mode) => {
    if (mode !== "measure" && (point1 || completed)) resetMeasurement();
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (manager.getMode() !== "measure" && !point1 && !completed) return;
      resetMeasurement();
      onComplete();
    }
  }

  function handleDismissClick(event: PointerEvent) {
    if (!completed) return;
    const target = event.target as Element;
    if (target.closest(".measure-tooltip")) return;
    resetMeasurement();
    onComplete();
  }

  // Right-click cancels an in-progress (or completed) measurement.
  function handleContextMenu(event: MouseEvent) {
    if (manager.getMode() !== "measure" || (!point1 && !completed)) return;
    event.preventDefault();
    resetMeasurement();
    onComplete();
  }

  const cleanupDrawingClick = bindDrawingPointerClick({
    container,
    chart,
    manager,
    mode: "measure",
    onClick: handleDrawClick,
  });
  container.addEventListener("mousemove", handleMouseMove);
  container.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("keydown", handleKeyDown);

  let dismissTimeout = setTimeout(() => {
    container.addEventListener("pointerdown", handleDismissClick);
  }, 200);

  function cleanup() {
    unregisterOverlaySync();
    unregisterModeChange();
    clearTimeout(dismissTimeout);
    cleanupDrawingClick();
    container.removeEventListener("mousemove", handleMouseMove);
    container.removeEventListener("contextmenu", handleContextMenu);
    container.removeEventListener("pointerdown", handleDismissClick);
    document.removeEventListener("keydown", handleKeyDown);
    hideAll();
    overlay.remove();
    tooltip.remove();
    axisLayer.remove();
  }

  return cleanup;
}
