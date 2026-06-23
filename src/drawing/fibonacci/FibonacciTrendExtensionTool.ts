/**
 * FibonacciTrendExtensionTool – Fibonacci Trend-Based Extension with three anchor points.
 * Points 1 and 2 define the trend, Point 3 defines the retracement from which extensions are drawn.
 */

import type { FibonacciTrendExtension } from "../../types";
import { pointToPixel, xToTime } from "../shared/coordinates";
import { createDrawingToolbar, drawingStyleIcon, type DrawingLineStyle } from "../shared/DrawingToolbar";
import { mountFloatingPanel } from "../shared/floatingPanel";
import { createDrawingOverlay } from "../shared/overlay";
import { mountAnchoredPopup } from "../shared/popup";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore } from "../shared/types";

export type FibonacciTrendExtensionCallbacks = DrawingCrudCallbacks<FibonacciTrendExtension>;

const SVG_NS = "http://www.w3.org/2000/svg";

// Уровни расширения для Trend-Based Extension
export const FIB_TREND_EXT_LEVELS = [
  { ratio: 0, color: "#787b86" },
  { ratio: 0.236, color: "#f23645" },
  { ratio: 0.382, color: "#ff9800" },
  { ratio: 0.5, color: "#9acd32" },
  { ratio: 0.618, color: "#089981" },
  { ratio: 0.786, color: "#00bcd4" },
  { ratio: 1, color: "#787b86" },
  { ratio: 1.272, color: "#2962ff" },
  { ratio: 1.618, color: "#2962ff" },
  { ratio: 2.618, color: "#803026" },
  { ratio: 3.618, color: "#9c27b0" },
  { ratio: 4.236, color: "#f23645" },
] as const;

const TV_HANDLE_RADIUS = 4;
const FIB_LABEL_GAP = 8;
const DEFAULT_FIB_LINE = {
  width: 1,
  style: "solid" as DrawingLineStyle,
};

function fibLineStyle(fib: FibonacciTrendExtension) {
  return {
    width: fib.lineWidth ?? DEFAULT_FIB_LINE.width,
    style: fib.lineStyle ?? DEFAULT_FIB_LINE.style,
  };
}

function strokeDashForStyle(style: DrawingLineStyle): string {
  if (style === "dashed") return "3 3";
  if (style === "dotted") return "2 3";
  return "";
}

interface PixelPoint {
  x: number;
  y: number;
}

function pxToPrice(series: any, y: number): number | null {
  return series.coordinateToPrice(y);
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(3);
}

function formatPrice(value: number, precision: number): string {
  const p = Math.max(0, Math.min(10, Math.round(precision)));
  return value.toLocaleString("en-US", { minimumFractionDigits: p, maximumFractionDigits: p });
}

function levelHorizontalSpan(p2: PixelPoint, p3: PixelPoint, plotWidth: number) {
  const p2x = Math.max(0, Math.min(p2.x, plotWidth));
  const p3x = Math.max(0, Math.min(p3.x, plotWidth));
  const xLeft = Math.min(p2x, p3x);
  const xRight = Math.max(p2x, p3x);
  // Подписи на стороне точки 3; при пересечении через точку 2 — инверсия
  const labelOnRight = p3x >= p2x;
  return { xLeft, xRight, labelOnRight };
}

function anchorPricesFromPixels(
  series: any,
  p1: PixelPoint,
  p2: PixelPoint,
  p3: PixelPoint,
): { price1: number; price2: number; price3: number } | null {
  const price1 = pxToPrice(series, p1.y);
  const price2 = pxToPrice(series, p2.y);
  const price3 = pxToPrice(series, p3.y);
  if (price1 == null || price2 == null || price3 == null) return null;
  return { price1, price2, price3 };
}

function trendExtensionPrice(price1: number, price2: number, price3: number, ratio: number): number {
  const bc = price2 - price3;
  const ab = price2 - price1;
  // Единая формула: 0% на C, 100% на B, extension продолжает BC-масштаб + AB
  return price3 + bc * ratio + ab * Math.max(0, ratio - 1);
}

interface LevelVisual {
  line: SVGLineElement;
  hit?: SVGLineElement;
  label?: SVGTextElement;
}

function applyLineStroke(line: SVGLineElement, color: string, width: number, style: DrawingLineStyle) {
  line.setAttribute("stroke", color);
  line.style.stroke = color;
  line.style.strokeWidth = String(width);
  line.style.strokeDasharray = strokeDashForStyle(style);
}

function applyTrendLineStroke(line: SVGLineElement, color: string, width: number) {
  line.setAttribute("stroke", color);
  line.style.stroke = color;
  line.style.strokeWidth = String(width);
  line.style.strokeLinecap = "butt";
  line.style.strokeDasharray = "6 4";
}

function applyLevelLine(
  levelEls: LevelVisual,
  xLeft: number,
  xRight: number,
  y: number,
  color: string,
  width: number,
  style: DrawingLineStyle,
) {
  levelEls.line.setAttribute("x1", String(xLeft));
  levelEls.line.setAttribute("x2", String(xRight));
  levelEls.line.setAttribute("y1", String(y));
  levelEls.line.setAttribute("y2", String(y));
  applyLineStroke(levelEls.line, color, width, style);
  if (levelEls.hit) {
    levelEls.hit.setAttribute("x1", String(xLeft));
    levelEls.hit.setAttribute("x2", String(xRight));
    levelEls.hit.setAttribute("y1", String(y));
    levelEls.hit.setAttribute("y2", String(y));
  }
}

function applyLevelLabel(
  label: SVGTextElement,
  xLeft: number,
  xRight: number,
  y: number,
  ratio: number,
  price: number,
  color: string,
  precision: number,
  labelOnRight: boolean,
) {
  const x = labelOnRight ? xRight + FIB_LABEL_GAP : xLeft - FIB_LABEL_GAP;
  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y));
  label.removeAttribute("dy");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("fill", color);
  label.setAttribute("text-anchor", labelOnRight ? "start" : "end");
  label.textContent = `${formatRatio(ratio)} (${formatPrice(price, precision)})`;
  label.setAttribute("visibility", "visible");
}

function applyHandles(handle1: SVGCircleElement, handle2: SVGCircleElement, handle3: SVGCircleElement, p1: PixelPoint, p2: PixelPoint, p3: PixelPoint, visible: boolean) {
  handle1.setAttribute("cx", String(p1.x));
  handle1.setAttribute("cy", String(p1.y));
  handle2.setAttribute("cx", String(p2.x));
  handle2.setAttribute("cy", String(p2.y));
  handle3.setAttribute("cx", String(p3.x));
  handle3.setAttribute("cy", String(p3.y));
  handle1.style.display = visible ? "" : "none";
  handle2.style.display = visible ? "" : "none";
  handle3.style.display = visible ? "" : "none";
}

export function attachFibonacciTrendExtensionTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: any;
  series: any;
  candleStore: ChartCandleStore;
  fibonacciTrendExtensions: FibonacciTrendExtension[];
  drawingMode: DrawingMode;
  datasetId: string;
  pricePrecision: number;
  callbacks: FibonacciTrendExtensionCallbacks;
}): () => void {
  const { container, chart, series, candleStore, drawingMode, datasetId, pricePrecision, callbacks, manager } = opts;
  let fibonacciTrendExtensions = [...opts.fibonacciTrendExtensions];

  const overlay = createDrawingOverlay(container, chart, "fib-overlay");
  const { svg } = overlay;

  let selectedId: string | null = null;
  let drawPoint1: { time: number; price: number } | null = null;
  let drawPoint2: { time: number; price: number } | null = null;
  let ghostGroup: SVGGElement | null = null;
  let ghostTrendLine1: SVGLineElement | null = null;
  let ghostTrendLine2: SVGLineElement | null = null;
  let ghostLevelLines: SVGLineElement[] | null = null;
  let ghostLevelLabels: SVGTextElement[] | null = null;
  let ghostLevelFills: SVGRectElement[] | null = null;
  let ghostHandle1: SVGCircleElement | null = null;
  let ghostHandle2: SVGCircleElement | null = null;
  let ghostHandle3: SVGCircleElement | null = null;
  let dragActive = false;
  let dragRaf = 0;
  let ghostRaf = 0;
  let interactionSyncRaf = 0;
  let finalSyncRaf = 0;
  let wheelSyncTimer = 0;
  let latestDrawPointer: { x: number; y: number } | null = null;

  let toolbar: HTMLDivElement | null = null;
  let cleanupToolbarDrag: (() => void) | null = null;
  let cleanupPalette: (() => void) | null = null;

  interface LevelEls {
    line: SVGLineElement;
    hit: SVGLineElement;
    label: SVGTextElement;
  }

  interface FibTrendExtEls {
    group: SVGGElement;
    labelGroup: SVGGElement;
    trendLine1: SVGLineElement;
    trendLine2: SVGLineElement;
    trendHit1: SVGLineElement;
    trendHit2: SVGLineElement;
    handle1: SVGCircleElement;
    handle2: SVGCircleElement;
    handle3: SVGCircleElement;
    fills: SVGRectElement[];
    levels: LevelEls[];
  }

  const elMap = new Map<string, FibTrendExtEls>();

  function getPlotLayout() {
    const height = container.getBoundingClientRect().height;
    const timeScaleHeight = Math.max(28, Number(chart.timeScale().height?.()) || 28);
    return {
      plotWidth: Math.max(0, Number(chart.timeScale().width()) || 0),
      plotHeight: Math.max(0, height - timeScaleHeight),
    };
  }

  function clampPlotPoint(p: PixelPoint): PixelPoint {
    const { plotWidth, plotHeight } = getPlotLayout();
    return {
      x: Math.max(0, Math.min(p.x, plotWidth)),
      y: Math.max(0, Math.min(p.y, plotHeight)),
    };
  }

  function clampPlotPair(p1: PixelPoint, p2: PixelPoint, p3: PixelPoint) {
    return { p1: clampPlotPoint(p1), p2: clampPlotPoint(p2), p3: clampPlotPoint(p3) };
  }

  function removeToolbar() {
    cleanupPalette?.();
    cleanupPalette = null;
    cleanupToolbarDrag?.();
    cleanupToolbarDrag = null;
    toolbar?.remove();
    toolbar = null;
  }

  function createToolbar(fib: FibonacciTrendExtension) {
    removeToolbar();
    const lineStyle = fibLineStyle(fib);
    const div = createDrawingToolbar({
      lineColor: "#787b86",
      width: lineStyle.width,
      style: lineStyle.style,
      locked: Boolean(fib.locked),
      showColor: false,
      showFill: false,
      showText: false,
      showLock: true,
    });
    container.appendChild(div);
    toolbar = div;
    const grip = div.querySelector<HTMLElement>(".rect-tb-grip");
    if (grip) {
      cleanupToolbarDrag = mountFloatingPanel({
        container,
        panel: div,
        grip,
        persistenceKey: `fibtrendext:${fib.id}`,
        onDragStart: () => { cleanupPalette?.(); cleanupPalette = null; },
      });
    }

    const openCompactMenu = (kind: "width" | "style", anchor: Element) => {
      cleanupPalette?.();
      cleanupPalette = null;
      const menu = document.createElement("div");
      menu.className = "rect-line-menu";
      const entries = kind === "width"
        ? [1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value}px`, icon: `<span class="rect-line-sample" style="height:${value}px"></span>` }))
        : (["solid", "dashed", "dotted"] as const).map((value) => ({ value, label: value === "solid" ? "Line" : `${value[0].toUpperCase()}${value.slice(1)} line`, icon: drawingStyleIcon(value) }));
      entries.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rect-line-menu-item";
        button.innerHTML = `<span class="rect-line-menu-icon">${entry.icon}</span><span>${entry.label}</span>`;
        button.addEventListener("click", () => {
          const current = fibonacciTrendExtensions.find((item) => item.id === fib.id);
          if (!current) return;
          if (kind === "width") current.lineWidth = Number(entry.value);
          else current.lineStyle = entry.value as DrawingLineStyle;
          callbacks.onUpdate(current);
          syncAll();
          div.querySelector<HTMLElement>(".rect-tb-width-label")!.textContent = `${fibLineStyle(current).width}px`;
          div.querySelector<HTMLElement>(".rect-tb-style-btn")!.innerHTML = drawingStyleIcon(fibLineStyle(current).style);
          cleanupPalette?.();
          cleanupPalette = null;
        });
        menu.appendChild(button);
      });
      cleanupPalette = mountAnchoredPopup({
        container,
        anchor,
        popup: menu,
        width: kind === "width" ? 104 : 168,
        gap: 2,
        onDismiss: () => { cleanupPalette = null; },
      });
    };

    div.querySelector(".rect-tb-width-btn")!.addEventListener("click", (event) => {
      event.stopPropagation();
      openCompactMenu("width", event.currentTarget as Element);
    });
    div.querySelector(".rect-tb-style-btn")!.addEventListener("click", (event) => {
      event.stopPropagation();
      openCompactMenu("style", event.currentTarget as Element);
    });
    div.querySelector(".rect-tb-lock")!.addEventListener("click", (event) => {
      event.stopPropagation();
      updateFib(fib.id, { locked: !fib.locked });
      const current = fibonacciTrendExtensions.find((item) => item.id === fib.id);
      if (current) createToolbar(current);
    });
    div.querySelector(".rect-tb-del")!.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFib(fib.id);
    });
    div.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candleStore.candles);
  }

  function updateFib(id: string, patch: Partial<FibonacciTrendExtension>) {
    const idx = fibonacciTrendExtensions.findIndex((item) => item.id === id);
    if (idx < 0) return;
    fibonacciTrendExtensions[idx] = { ...fibonacciTrendExtensions[idx], ...patch };
    callbacks.onUpdate(fibonacciTrendExtensions[idx]);
    syncAll();
  }

  function deleteFib(id: string) {
    fibonacciTrendExtensions = fibonacciTrendExtensions.filter((item) => item.id !== id);
    const els = elMap.get(id);
    els?.group.remove();
    els?.labelGroup.remove();
    elMap.delete(id);
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("fibtrendext");
    }
    callbacks.onDelete(id);
  }

  function selectFib(id: string | null) {
    if (!id) {
      if (selectedId !== null) {
        selectedId = null;
        removeToolbar();
        syncAll();
      }
      manager.clearSelection("fibtrendext");
      return;
    }
    selectedId = id;
    const fib = fibonacciTrendExtensions.find((item) => item.id === id);
    if (fib) createToolbar(fib);
    manager.activateSelection("fibtrendext", elMap.get(id)?.group ?? null);
    syncAll();
  }

  function buildFibTrendExtEls(fib: FibonacciTrendExtension): FibTrendExtEls {
    const group = overlay.createClippedGroup();
    group.dataset.fibTrendExtId = fib.id;

    const labelGroup = overlay.createClippedGroup();
    labelGroup.setAttribute("class", "fib-label-group");
    labelGroup.dataset.fibTrendExtId = fib.id;

    const fills: SVGRectElement[] = FIB_TREND_EXT_LEVELS.slice(0, -1).map((level) => {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("class", "fib-trend-ext-fill");
      rect.setAttribute("fill", level.color);
      rect.setAttribute("fill-opacity", "0.12");
      return rect;
    });

    const trendLine1 = document.createElementNS(SVG_NS, "line");
    trendLine1.setAttribute("class", "fib-trend-line");

    const trendLine2 = document.createElementNS(SVG_NS, "line");
    trendLine2.setAttribute("class", "fib-trend-line");

    const trendHit1 = document.createElementNS(SVG_NS, "line");
    trendHit1.setAttribute("class", "fib-trend-hit");

    const trendHit2 = document.createElementNS(SVG_NS, "line");
    trendHit2.setAttribute("class", "fib-trend-hit");

    const handle1 = document.createElementNS(SVG_NS, "circle");
    handle1.setAttribute("class", "rect-handle-el fib-handle");
    handle1.setAttribute("r", String(TV_HANDLE_RADIUS));

    const handle2 = document.createElementNS(SVG_NS, "circle");
    handle2.setAttribute("class", "rect-handle-el fib-handle");
    handle2.setAttribute("r", String(TV_HANDLE_RADIUS));

    const handle3 = document.createElementNS(SVG_NS, "circle");
    handle3.setAttribute("class", "rect-handle-el fib-handle");
    handle3.setAttribute("r", String(TV_HANDLE_RADIUS));

    const levels: LevelEls[] = FIB_TREND_EXT_LEVELS.map(() => {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "fib-level-line");
      const hit = document.createElementNS(SVG_NS, "line");
      hit.setAttribute("class", "fib-level-hit");
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "fib-level-label");
      return { line, hit, label };
    });

    group.append(...fills, trendLine1, trendLine2, trendHit1, trendHit2, ...levels.flatMap((level) => [level.line, level.hit]), handle1, handle2, handle3);
    labelGroup.append(...levels.map((level) => level.label));

    const onBodyDown = (event: PointerEvent) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciTrendExtensions.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragBody(fib.id, event);
    };

    trendHit1.addEventListener("pointerdown", onBodyDown);
    trendHit2.addEventListener("pointerdown", onBodyDown);
    levels.forEach((level) => level.hit.addEventListener("pointerdown", onBodyDown));

    handle1.addEventListener("pointerdown", (event) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciTrendExtensions.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragHandle(fib.id, "point1", event);
    });

    handle2.addEventListener("pointerdown", (event) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciTrendExtensions.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragHandle(fib.id, "point2", event);
    });

    handle3.addEventListener("pointerdown", (event) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciTrendExtensions.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragHandle(fib.id, "point3", event);
    });

    return { group, labelGroup, trendLine1, trendLine2, trendHit1, trendHit2, handle1, handle2, handle3, fills, levels };
  }

  function applyLevelFills(
    fills: SVGRectElement[],
    levelYs: number[],
    xLeft: number,
    xRight: number,
  ) {
    const width = Math.max(0, xRight - xLeft);
    fills.forEach((fill, index) => {
      const yTop = levelYs[index];
      const yBottom = levelYs[index + 1];
      if (yTop == null || yBottom == null) {
        fill.setAttribute("visibility", "hidden");
        return;
      }
      fill.setAttribute("visibility", "visible");
      fill.setAttribute("x", String(xLeft));
      fill.setAttribute("y", String(Math.min(yTop, yBottom)));
      fill.setAttribute("width", String(width));
      fill.setAttribute("height", String(Math.max(1, Math.abs(yBottom - yTop))));
    });
  }

  function renderFibLevels(
    levels: LevelEls[],
    fills: SVGRectElement[] | null,
    p2: PixelPoint,
    p3: PixelPoint,
    price1: number,
    price2: number,
    price3: number,
    showLabels: boolean,
    width: number,
    style: DrawingLineStyle,
  ) {
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight, labelOnRight } = levelHorizontalSpan(p2, p3, plotWidth);

    const levelYs: number[] = [];

    FIB_TREND_EXT_LEVELS.forEach((level, index) => {
      const price = trendExtensionPrice(price1, price2, price3, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      levelYs[index] = y;
      const levelEls = levels[index];
      applyLevelLine(levelEls, xLeft, xRight, y, level.color, width, style);
      if (showLabels && levelEls.label) {
        applyLevelLabel(levelEls.label, xLeft, xRight, y, level.ratio, price, level.color, pricePrecision, labelOnRight);
      } else if (levelEls.label) {
        levelEls.label.setAttribute("visibility", "hidden");
      }
    });

    if (fills && levelYs.length === FIB_TREND_EXT_LEVELS.length) {
      applyLevelFills(fills, levelYs, xLeft, xRight);
    }
  }

  function renderFibLevelsToLines(
    levelLines: SVGLineElement[],
    levelLabels: SVGTextElement[] | null,
    fills: SVGRectElement[] | null,
    p2: PixelPoint,
    p3: PixelPoint,
    price1: number,
    price2: number,
    price3: number,
    lineWidth: number,
    lineStyle: DrawingLineStyle,
    showLabels: boolean,
  ) {
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight, labelOnRight } = levelHorizontalSpan(p2, p3, plotWidth);

    const levelYs: number[] = [];
    FIB_TREND_EXT_LEVELS.forEach((level, index) => {
      const price = trendExtensionPrice(price1, price2, price3, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      levelYs[index] = y;
      applyLevelLine({ line: levelLines[index] }, xLeft, xRight, y, level.color, lineWidth, lineStyle);
      if (showLabels && levelLabels) {
        applyLevelLabel(levelLabels[index], xLeft, xRight, y, level.ratio, price, level.color, pricePrecision, labelOnRight);
      } else if (levelLabels) {
        levelLabels[index].setAttribute("visibility", "hidden");
      }
    });
    if (fills && levelYs.length === FIB_TREND_EXT_LEVELS.length) {
      applyLevelFills(fills, levelYs, xLeft, xRight);
    }
  }

  function renderFibGeometry(
    fib: FibonacciTrendExtension,
    els: FibTrendExtEls,
    p1: PixelPoint,
    p2: PixelPoint,
    p3: PixelPoint,
    isSelected: boolean,
    priceSource: "stored" | "pixels" = "stored",
  ) {
    const { p1: cp1, p2: cp2, p3: cp3 } = clampPlotPair(p1, p2, p3);
    const lineStyle = fibLineStyle(fib);

    let price1 = fib.point1.price;
    let price2 = fib.point2.price;
    let price3 = fib.point3.price;
    if (priceSource === "pixels") {
      const anchors = anchorPricesFromPixels(series, cp1, cp2, cp3);
      if (anchors) {
        price1 = anchors.price1;
        price2 = anchors.price2;
        price3 = anchors.price3;
      }
    }

    // Первая трендовая линия (от p1 к p2)
    els.trendLine1.setAttribute("x1", String(cp1.x));
    els.trendLine1.setAttribute("y1", String(cp1.y));
    els.trendLine1.setAttribute("x2", String(cp2.x));
    els.trendLine1.setAttribute("y2", String(cp2.y));
    applyTrendLineStroke(els.trendLine1, "#787b86", lineStyle.width);

    els.trendHit1.setAttribute("x1", String(cp1.x));
    els.trendHit1.setAttribute("y1", String(cp1.y));
    els.trendHit1.setAttribute("x2", String(cp2.x));
    els.trendHit1.setAttribute("y2", String(cp2.y));

    // Вторая трендовая линия (от p2 к p3)
    els.trendLine2.setAttribute("x1", String(cp2.x));
    els.trendLine2.setAttribute("y1", String(cp2.y));
    els.trendLine2.setAttribute("x2", String(cp3.x));
    els.trendLine2.setAttribute("y2", String(cp3.y));
    applyTrendLineStroke(els.trendLine2, "#787b86", lineStyle.width);

    els.trendHit2.setAttribute("x1", String(cp2.x));
    els.trendHit2.setAttribute("y1", String(cp2.y));
    els.trendHit2.setAttribute("x2", String(cp3.x));
    els.trendHit2.setAttribute("y2", String(cp3.y));

    renderFibLevels(
      els.levels,
      els.fills,
      cp2,
      cp3,
      price1,
      price2,
      price3,
      fib.showLabels !== false,
      lineStyle.width,
      lineStyle.style,
    );
    applyHandles(els.handle1, els.handle2, els.handle3, cp1, cp2, cp3, !fib.locked);
    els.group.classList.toggle("selected", isSelected);
  }

  function syncOne(fib: FibonacciTrendExtension) {
    let els = elMap.get(fib.id);
    if (!els) {
      els = buildFibTrendExtEls(fib);
      elMap.set(fib.id, els);
    }
    const p1 = toPixel(fib.point1);
    const p2 = toPixel(fib.point2);
    const p3 = toPixel(fib.point3);
    if (!p1 || !p2 || !p3) {
      els.group.setAttribute("visibility", "hidden");
      els.labelGroup.setAttribute("visibility", "hidden");
      return;
    }
    els.group.setAttribute("visibility", "visible");
    els.labelGroup.setAttribute("visibility", "visible");
    renderFibGeometry(fib, els, p1, p2, p3, selectedId === fib.id);
  }

  function syncAll() {
    if (dragActive) return;
    overlay.sync();
    fibonacciTrendExtensions.forEach(syncOne);
  }

  function runInteractionSync() {
    if (dragActive) {
      interactionSyncRaf = 0;
      return;
    }
    syncAll();
    interactionSyncRaf = requestAnimationFrame(runInteractionSync);
  }

  function startInteractionSync() {
    if (!interactionSyncRaf) interactionSyncRaf = requestAnimationFrame(runInteractionSync);
  }

  function stopInteractionSync() {
    if (interactionSyncRaf) cancelAnimationFrame(interactionSyncRaf);
    interactionSyncRaf = 0;
    if (finalSyncRaf) cancelAnimationFrame(finalSyncRaf);
    finalSyncRaf = requestAnimationFrame(() => {
      finalSyncRaf = 0;
      if (!dragActive) syncAll();
    });
  }

  function handleScaleWheel() {
    syncAll();
    startInteractionSync();
    window.clearTimeout(wheelSyncTimer);
    wheelSyncTimer = window.setTimeout(stopInteractionSync, 150);
  }

  function handlePointerDown(event: PointerEvent) {
    const target = event.target as Element;
    if (target.closest(".fib-toolbar, .fib-trend-hit, .fib-level-hit, .fib-handle")) return;
    startInteractionSync();
  }

  function handlePointerUp() {
    if (dragActive) return;
    stopInteractionSync();
  }

  function previewAtPixels(fib: FibonacciTrendExtension, p1: PixelPoint, p2: PixelPoint, p3: PixelPoint) {
    const els = elMap.get(fib.id);
    if (!els) return;
    overlay.sync();
    renderFibGeometry(fib, els, p1, p2, p3, selectedId === fib.id, "pixels");
  }

  function ensureGhostElements() {
    if (ghostGroup && ghostTrendLine1 && ghostTrendLine2 && ghostLevelLines && ghostLevelLabels && ghostLevelFills && ghostHandle1 && ghostHandle2 && ghostHandle3) return;

    const lineGroup = overlay.createClippedGroup();
    lineGroup.setAttribute("class", "fib-ghost fib-ghost-lines");

    const labelGroup = overlay.createClippedGroup();
    labelGroup.setAttribute("class", "fib-ghost fib-ghost-labels");

    ghostGroup = lineGroup;

    ghostLevelFills = FIB_TREND_EXT_LEVELS.slice(0, -1).map((level) => {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("class", "fib-trend-ext-fill");
      rect.setAttribute("fill", level.color);
      rect.setAttribute("fill-opacity", "0.12");
      lineGroup.appendChild(rect);
      return rect;
    });

    ghostTrendLine1 = document.createElementNS(SVG_NS, "line");
    ghostTrendLine1.setAttribute("class", "fib-trend-line");
    lineGroup.appendChild(ghostTrendLine1);

    ghostTrendLine2 = document.createElementNS(SVG_NS, "line");
    ghostTrendLine2.setAttribute("class", "fib-trend-line");
    lineGroup.appendChild(ghostTrendLine2);

    ghostLevelLines = [];
    ghostLevelLabels = [];
    FIB_TREND_EXT_LEVELS.forEach(() => {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "fib-level-line");
      lineGroup.appendChild(line);
      ghostLevelLines!.push(line);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "fib-level-label");
      labelGroup.appendChild(label);
      ghostLevelLabels!.push(label);
    });

    ghostHandle1 = document.createElementNS(SVG_NS, "circle");
    ghostHandle1.setAttribute("class", "fib-handle");
    ghostHandle1.setAttribute("r", String(TV_HANDLE_RADIUS));
    ghostHandle2 = document.createElementNS(SVG_NS, "circle");
    ghostHandle2.setAttribute("class", "fib-handle");
    ghostHandle2.setAttribute("r", String(TV_HANDLE_RADIUS));
    ghostHandle3 = document.createElementNS(SVG_NS, "circle");
    ghostHandle3.setAttribute("class", "fib-handle");
    ghostHandle3.setAttribute("r", String(TV_HANDLE_RADIUS));
    lineGroup.append(ghostHandle1, ghostHandle2, ghostHandle3);
  }

  function clearGhost() {
    if (ghostRaf) {
      cancelAnimationFrame(ghostRaf);
      ghostRaf = 0;
    }
    latestDrawPointer = null;
    svg.querySelectorAll(".fib-ghost").forEach((node) => node.remove());
    ghostGroup = null;
    ghostTrendLine1 = null;
    ghostTrendLine2 = null;
    ghostLevelLines = null;
    ghostLevelLabels = null;
    ghostLevelFills = null;
    ghostHandle1 = null;
    ghostHandle2 = null;
    ghostHandle3 = null;
  }

  function updateGhost(p1: PixelPoint, p2: PixelPoint, p3?: PixelPoint) {
    ensureGhostElements();
    overlay.sync();
    const { p1: cp1, p2: cp2, p3: cp3 } = p3 
      ? clampPlotPair(p1, p2, p3)
      : { p1: clampPlotPoint(p1), p2: clampPlotPoint(p2), p3: null };

    ghostTrendLine1!.setAttribute("x1", String(cp1.x));
    ghostTrendLine1!.setAttribute("y1", String(cp1.y));
    ghostTrendLine1!.setAttribute("x2", String(cp2.x));
    ghostTrendLine1!.setAttribute("y2", String(cp2.y));
    applyTrendLineStroke(ghostTrendLine1!, "#787b86", DEFAULT_FIB_LINE.width);

    if (cp3) {
      ghostTrendLine2!.setAttribute("x1", String(cp2.x));
      ghostTrendLine2!.setAttribute("y1", String(cp2.y));
      ghostTrendLine2!.setAttribute("x2", String(cp3.x));
      ghostTrendLine2!.setAttribute("y2", String(cp3.y));
      applyTrendLineStroke(ghostTrendLine2!, "#787b86", DEFAULT_FIB_LINE.width);
      ghostTrendLine2!.style.display = "";
      ghostLevelLines!.forEach((line) => { line.style.display = ""; });
      const anchors = anchorPricesFromPixels(series, cp1, cp2, cp3);
      if (anchors) {
        renderFibLevelsToLines(
          ghostLevelLines!,
          ghostLevelLabels,
          ghostLevelFills,
          cp2,
          cp3,
          anchors.price1,
          anchors.price2,
          anchors.price3,
          DEFAULT_FIB_LINE.width,
          DEFAULT_FIB_LINE.style,
          true,
        );
      }
      applyHandles(ghostHandle1!, ghostHandle2!, ghostHandle3!, cp1, cp2, cp3, true);
    } else {
      ghostTrendLine2!.style.display = "none";
      ghostLevelLines?.forEach((line) => { line.style.display = "none"; });
      ghostLevelLabels?.forEach((label) => label.setAttribute("visibility", "hidden"));
      ghostLevelFills?.forEach((fill) => fill.setAttribute("visibility", "hidden"));
      ghostHandle1!.setAttribute("cx", String(cp1.x));
      ghostHandle1!.setAttribute("cy", String(cp1.y));
      ghostHandle2!.setAttribute("cx", String(cp2.x));
      ghostHandle2!.setAttribute("cy", String(cp2.y));
      ghostHandle1!.style.display = "";
      ghostHandle2!.style.display = "";
      ghostHandle3!.style.display = "none";
    }
  }

  function flushGhostPreview() {
    ghostRaf = 0;
    if (!latestDrawPointer) return;
    
    if (!drawPoint1) return;
    const p1 = toPixel(drawPoint1);
    if (!p1) return;

    if (!drawPoint2) {
      updateGhost(p1, latestDrawPointer);
    } else {
      const p2 = toPixel(drawPoint2);
      if (!p2) return;
      updateGhost(p1, p2, latestDrawPointer);
    }
  }

  function handleDrawPointerMove(event: PointerEvent) {
    if (!drawPoint1) return;
    const rect = container.getBoundingClientRect();
    latestDrawPointer = clampPlotPoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    if (!ghostRaf) ghostRaf = requestAnimationFrame(flushGhostPreview);
  }

  function startDragHandle(id: string, which: "point1" | "point2" | "point3", startEvent: PointerEvent) {
    const fib = fibonacciTrendExtensions.find((item) => item.id === id);
    if (!fib) return;
    dragActive = true;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(fib.point1);
    const originalP2 = toPixel(fib.point2);
    const originalP3 = toPixel(fib.point3);
    if (!originalP1 || !originalP2 || !originalP3) {
      dragActive = false;
      return;
    }
    let moved = false;
    const target = startEvent.target as Element;
    target.setPointerCapture?.(startEvent.pointerId);
    let latestEvent: PointerEvent | null = null;

    const renderMove = () => {
      dragRaf = 0;
      const event = latestEvent;
      if (!event) return;
      moved = true;
      const dragged = clampPlotPoint({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      const p1 = which === "point1" ? dragged : originalP1;
      const p2 = which === "point2" ? dragged : originalP2;
      const p3 = which === "point3" ? dragged : originalP3;
      const dragTime = xToTime(chart, dragged.x, candleStore.candles);
      const dragPrice = pxToPrice(series, dragged.y);
      if (dragTime != null && dragPrice != null && dragPrice > 0) {
        if (which === "point1") fib.point1 = { time: dragTime, price: dragPrice };
        else if (which === "point2") fib.point2 = { time: dragTime, price: dragPrice };
        else fib.point3 = { time: dragTime, price: dragPrice };
      }
      previewAtPixels(fib, p1, p2, p3);
    };

    const onMove = (event: PointerEvent) => {
      latestEvent = event;
      if (!dragRaf) dragRaf = requestAnimationFrame(renderMove);
    };

    const onUp = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; renderMove(); }
      dragActive = false;
      target.releasePointerCapture?.(event.pointerId);
      const current = fibonacciTrendExtensions.find((item) => item.id === id);
      if (current && moved && latestEvent) {
        const clamped = clampPlotPoint({
          x: latestEvent.clientX - rect.left,
          y: latestEvent.clientY - rect.top,
        });
        const time = xToTime(chart, clamped.x, candleStore.candles);
        const price = pxToPrice(series, clamped.y);
        if (time != null && price != null && price > 0) current[which] = { time, price };
        dragActive = false;
        syncAll();
        callbacks.onUpdate(current);
      } else {
        dragActive = false;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function startDragBody(id: string, startEvent: PointerEvent) {
    const fib = fibonacciTrendExtensions.find((item) => item.id === id);
    if (!fib) return;
    dragActive = true;
    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...fib.point1 };
    const origP2 = { ...fib.point2 };
    const origP3 = { ...fib.point3 };
    const p1Px = toPixel(origP1);
    const p2Px = toPixel(origP2);
    const p3Px = toPixel(origP3);
    if (!p1Px || !p2Px || !p3Px) {
      dragActive = false;
      return;
    }
    let moved = false;
    const target = startEvent.target as Element;
    target.setPointerCapture?.(startEvent.pointerId);
    let latestEvent: PointerEvent | null = null;
    let finalDx = 0;
    let finalDy = 0;

    const renderMove = () => {
      dragRaf = 0;
      const event = latestEvent;
      if (!event) return;
      const dx = (event.clientX - rect.left) - startX;
      const dy = (event.clientY - rect.top) - startY;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      finalDx = dx;
      finalDy = dy;
      previewAtPixels(
        fib,
        clampPlotPoint({ x: p1Px.x + dx, y: p1Px.y + dy }),
        clampPlotPoint({ x: p2Px.x + dx, y: p2Px.y + dy }),
        clampPlotPoint({ x: p3Px.x + dx, y: p3Px.y + dy }),
      );
    };

    const onMove = (event: PointerEvent) => {
      latestEvent = event;
      if (!dragRaf) dragRaf = requestAnimationFrame(renderMove);
    };

    const onUp = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; renderMove(); }
      dragActive = false;
      target.releasePointerCapture?.(event.pointerId);
      const current = fibonacciTrendExtensions.find((item) => item.id === id);
      if (current && moved) {
        const fp1 = clampPlotPoint({ x: p1Px.x + finalDx, y: p1Px.y + finalDy });
        const fp2 = clampPlotPoint({ x: p2Px.x + finalDx, y: p2Px.y + finalDy });
        const fp3 = clampPlotPoint({ x: p3Px.x + finalDx, y: p3Px.y + finalDy });
        const newP1Time = xToTime(chart, fp1.x, candleStore.candles);
        const newP1Price = pxToPrice(series, fp1.y);
        const newP2Time = xToTime(chart, fp2.x, candleStore.candles);
        const newP2Price = pxToPrice(series, fp2.y);
        const newP3Time = xToTime(chart, fp3.x, candleStore.candles);
        const newP3Price = pxToPrice(series, fp3.y);
        if (
          newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null && newP3Time != null && newP3Price != null
          && newP1Price > 0 && newP2Price > 0 && newP3Price > 0
        ) {
          current.point1 = { time: newP1Time, price: newP1Price };
          current.point2 = { time: newP2Time, price: newP2Price };
          current.point3 = { time: newP3Time, price: newP3Price };
        }
        syncAll();
        callbacks.onUpdate(current);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function handleDrawClick(event: any) {
    if (drawingMode !== "fibtrendext") return;
    const rect = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    let x = sourceEvent ? sourceEvent.clientX - rect.left : null;
    let y = sourceEvent ? sourceEvent.clientY - rect.top : null;
    if (x != null && y != null) {
      const clamped = clampPlotPoint({ x, y });
      x = clamped.x;
      y = clamped.y;
      latestDrawPointer = { x, y };
    }
    const time = x != null ? xToTime(chart, x, candleStore.candles) : (event.time as number | undefined);
    const price = y != null ? pxToPrice(series, y) : (event.seriesData?.get(series)?.close as number | undefined);
    if (time == null || price == null || price <= 0) return;

    if (!drawPoint1) {
      drawPoint1 = { time, price };
      window.addEventListener("pointermove", handleDrawPointerMove);
      flushGhostPreview();
    } else if (!drawPoint2) {
      drawPoint2 = { time, price };
      flushGhostPreview();
    } else {
      const pointer = latestDrawPointer ?? (x != null && y != null ? { x, y } : null);
      const p3Time = pointer ? xToTime(chart, pointer.x, candleStore.candles) : time;
      const p3Price = pointer ? pxToPrice(series, pointer.y) : price;
      if (p3Time == null || p3Price == null || p3Price <= 0) return;

      const newFib: FibonacciTrendExtension = {
        id: crypto.randomUUID(),
        datasetId,
        point1: drawPoint1,
        point2: drawPoint2,
        point3: { time: p3Time, price: p3Price },
        showLabels: true,
        locked: false,
        lineWidth: DEFAULT_FIB_LINE.width,
        lineStyle: DEFAULT_FIB_LINE.style,
      };
      fibonacciTrendExtensions.push(newFib);
      callbacks.onCreate(newFib);
      drawPoint1 = null;
      drawPoint2 = null;
      window.removeEventListener("pointermove", handleDrawPointerMove);
      clearGhost();
      selectFib(newFib.id);
      syncAll();
      callbacks.onDrawingComplete();
    }
  }

  function handleBackgroundClick(event: PointerEvent) {
    if (drawingMode !== "none") return;
    const target = event.target as Element;
    if (
      target.closest(".rect-toolbar")
      || target.closest(".fib-trend-hit")
      || target.closest(".fib-level-hit")
      || target.closest(".fib-handle")
    ) return;
    if (selectedId) selectFib(null);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Delete" || event.key === "Backspace") {
      if ((event.target as Element)?.tagName === "INPUT" || (event.target as Element)?.tagName === "TEXTAREA") return;
      if (selectedId) {
        event.preventDefault();
        deleteFib(selectedId);
      }
    }
    if (event.key === "Escape") {
      if (drawPoint1 || drawPoint2) {
        drawPoint1 = null;
        drawPoint2 = null;
        window.removeEventListener("pointermove", handleDrawPointerMove);
        clearGhost();
        callbacks.onDrawingComplete();
      }
      if (selectedId) selectFib(null);
    }
  }

  let rafId = 0;
  function loop() {
    if (!dragActive && !interactionSyncRaf) syncAll();
    rafId = requestAnimationFrame(loop);
  }
  syncAll();
  rafId = requestAnimationFrame(loop);

  const onVisibleRangeChange = () => {
    if (!dragActive) startInteractionSync();
    window.clearTimeout(wheelSyncTimer);
    wheelSyncTimer = window.setTimeout(stopInteractionSync, 150);
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
  container.addEventListener("wheel", handleScaleWheel, { capture: true, passive: true });
  container.addEventListener("pointerdown", handlePointerDown, { capture: true });
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);

  const unregisterDeselect = manager.registerDeselect("fibtrendext", () => {
    if (selectedId === null) return;
    selectedId = null;
    removeToolbar();
    syncAll();
  });

  if (drawingMode === "fibtrendext") {
    chart.subscribeClick(handleDrawClick);
  }
  container.addEventListener("pointerdown", handleBackgroundClick);
  document.addEventListener("keydown", handleKeyDown);

  return () => {
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(dragRaf);
    cancelAnimationFrame(ghostRaf);
    cancelAnimationFrame(interactionSyncRaf);
    cancelAnimationFrame(finalSyncRaf);
    window.clearTimeout(wheelSyncTimer);
    unregisterDeselect();
    try { chart.unsubscribeClick(handleDrawClick); } catch { }
    try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange); } catch { }
    container.removeEventListener("wheel", handleScaleWheel, { capture: true });
    container.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("pointermove", handleDrawPointerMove);
    container.removeEventListener("pointerdown", handleBackgroundClick);
    document.removeEventListener("keydown", handleKeyDown);
    overlay.remove();
    removeToolbar();
    clearGhost();
  };
}
