/**
 * FibonacciTool – retracement / extension grid with two anchor points.
 */

import type { FibonacciRetracement } from "../../types";
import { pointToPixel, xToTime } from "../shared/coordinates";
import { createDrawingToolbar, drawingStyleIcon, type DrawingLineStyle } from "../shared/DrawingToolbar";
import { mountFloatingPanel } from "../shared/floatingPanel";
import { createDrawingOverlay } from "../shared/overlay";
import { mountAnchoredPopup } from "../shared/popup";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions } from "../shared/types";

export type FibonacciCallbacks = DrawingCrudCallbacks<FibonacciRetracement>;

const SVG_NS = "http://www.w3.org/2000/svg";

export const FIB_LEVELS = [
  { ratio: 0, color: "#787b86" },
  { ratio: 0.236, color: "#f23645" },
  { ratio: 0.382, color: "#ff9800" },
  { ratio: 0.5, color: "#9acd32" },
  { ratio: 0.618, color: "#089981" },
  { ratio: 0.786, color: "#00bcd4" },
  { ratio: 1, color: "#787b86" },
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

function fibLineStyle(fib: FibonacciRetracement) {
  return {
    width: fib.lineWidth ?? fib.trendWidth ?? DEFAULT_FIB_LINE.width,
    style: fib.lineStyle ?? fib.trendStyle ?? DEFAULT_FIB_LINE.style,
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
  return `${(ratio * 100).toFixed(2)}%`;
}

function formatPrice(value: number, precision: number): string {
  const p = Math.max(0, Math.min(10, Math.round(precision)));
  return value.toLocaleString("en-US", { minimumFractionDigits: p, maximumFractionDigits: p });
}

function horizontalSpan(p1: PixelPoint, p2: PixelPoint, plotWidth?: number) {
  let xLeft = Math.min(p1.x, p2.x);
  let xRight = Math.max(p1.x, p2.x);
  if (plotWidth != null) {
    xLeft = Math.max(0, Math.min(xLeft, plotWidth));
    xRight = Math.max(0, Math.min(xRight, plotWidth));
  }
  return { xLeft, xRight: Math.max(xLeft, xRight) };
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

function levelPriceFromAnchors(p0: number, p100: number, ratio: number): number {
  return p0 + ratio * (p100 - p0);
}

function anchorPricesFromPixels(series: any, p1: PixelPoint, p2: PixelPoint): { p0: number; p100: number } | null {
  const p100 = pxToPrice(series, p1.y);
  const p0 = pxToPrice(series, p2.y);
  if (p100 == null || p0 == null || p100 <= 0 || p0 <= 0) return null;
  return { p0, p100 };
}

function applyLevelLabel(label: SVGTextElement, xRight: number, y: number, ratio: number, price: number, color: string, precision: number) {
  label.setAttribute("x", String(xRight + FIB_LABEL_GAP));
  label.setAttribute("y", String(y));
  label.removeAttribute("dy");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("fill", color);
  label.setAttribute("text-anchor", "start");
  label.textContent = `${formatRatio(ratio)} (${formatPrice(price, precision)})`;
  label.setAttribute("visibility", "visible");
}

function applyHandles(handle1: SVGCircleElement, handle2: SVGCircleElement, p1: PixelPoint, p2: PixelPoint, visible: boolean) {
  handle1.setAttribute("cx", String(p1.x));
  handle1.setAttribute("cy", String(p1.y));
  handle2.setAttribute("cx", String(p2.x));
  handle2.setAttribute("cy", String(p2.y));
  handle1.style.display = visible ? "" : "none";
  handle2.style.display = visible ? "" : "none";
}

export function attachFibonacciTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: any;
  series: any;
  candles: { time: number }[];
  fibonacciRetracements: FibonacciRetracement[];
  drawingMode: DrawingMode;
  datasetId: string;
  pricePrecision: number;
  callbacks: FibonacciCallbacks;
}): () => void {
  const { container, chart, series, candles, drawingMode, datasetId, pricePrecision, callbacks, manager } = opts;
  let fibonacciRetracements = [...opts.fibonacciRetracements];

  const overlay = createDrawingOverlay(container, chart, "fib-overlay");
  const { svg } = overlay;

  let selectedId: string | null = null;
  let drawPoint1: { time: number; price: number } | null = null;
  let ghostGroup: SVGGElement | null = null;
  let ghostTrendLine: SVGLineElement | null = null;
  let ghostLevelLines: SVGLineElement[] | null = null;
  let ghostLevelLabels: SVGTextElement[] | null = null;
  let ghostHandle1: SVGCircleElement | null = null;
  let ghostHandle2: SVGCircleElement | null = null;
  let dragActive = false;
  let dragRaf = 0;
  let ghostRaf = 0;
  let latestDrawPointer: { x: number; y: number } | null = null;

  let toolbar: HTMLDivElement | null = null;
  let cleanupToolbarDrag: (() => void) | null = null;
  let cleanupPalette: (() => void) | null = null;

  interface LevelEls {
    line: SVGLineElement;
    hit: SVGLineElement;
    label: SVGTextElement;
  }

  interface FibEls {
    group: SVGGElement;
    labelGroup: SVGGElement;
    trendLine: SVGLineElement;
    trendHit: SVGLineElement;
    handle1: SVGCircleElement;
    handle2: SVGCircleElement;
    levels: LevelEls[];
  }

  const elMap = new Map<string, FibEls>();

  const axisLayer = document.createElement("div");
  axisLayer.className = "fib-axis-layer";
  container.appendChild(axisLayer);
  const axisBadgeMap = new Map<string, { p100: HTMLDivElement; p0: HTMLDivElement }>();

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

  function clampPlotPair(p1: PixelPoint, p2: PixelPoint) {
    return { p1: clampPlotPoint(p1), p2: clampPlotPoint(p2) };
  }

  function getPriceScaleWidth() {
    return Math.max(70, Number(chart.priceScale("right").width()) || 70);
  }

  function makeAxisBadge(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "fib-axis-badge";
    el.style.visibility = "hidden";
    return el;
  }

  function showAxisBadge(el: HTMLDivElement, text: string, y: number) {
    el.textContent = text;
    el.style.width = `${getPriceScaleWidth()}px`;
    el.style.top = `${y}px`;
    el.style.visibility = "visible";
  }

  function hideAxisBadge(el: HTMLDivElement) {
    el.style.visibility = "hidden";
  }

  function removeAxisBadges(id: string) {
    const badges = axisBadgeMap.get(id);
    if (!badges) return;
    badges.p100.remove();
    badges.p0.remove();
    axisBadgeMap.delete(id);
  }

  function syncAxisBadges(fib: FibonacciRetracement, visible: boolean) {
    let badges = axisBadgeMap.get(fib.id);
    if (!badges) {
      badges = { p100: makeAxisBadge(), p0: makeAxisBadge() };
      axisBadgeMap.set(fib.id, badges);
      axisLayer.append(badges.p100, badges.p0);
    }
    if (!visible) {
      hideAxisBadge(badges.p100);
      hideAxisBadge(badges.p0);
      return;
    }
    const y100 = series.priceToCoordinate(fib.point1.price);
    const y0 = series.priceToCoordinate(fib.point2.price);
    const { plotHeight } = getPlotLayout();
    if (y100 == null || y0 == null) {
      hideAxisBadge(badges.p100);
      hideAxisBadge(badges.p0);
      return;
    }
    if (y100 >= 0 && y100 <= plotHeight) {
      showAxisBadge(badges.p100, formatPrice(fib.point1.price, pricePrecision), y100);
    } else {
      hideAxisBadge(badges.p100);
    }
    if (y0 >= 0 && y0 <= plotHeight) {
      showAxisBadge(badges.p0, formatPrice(fib.point2.price, pricePrecision), y0);
    } else {
      hideAxisBadge(badges.p0);
    }
  }

  function removeToolbar() {
    cleanupPalette?.();
    cleanupPalette = null;
    cleanupToolbarDrag?.();
    cleanupToolbarDrag = null;
    toolbar?.remove();
    toolbar = null;
  }

  function createToolbar(fib: FibonacciRetracement) {
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
        persistenceKey: `fibonacci:${fib.id}`,
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
          const current = fibonacciRetracements.find((item) => item.id === fib.id);
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
      const current = fibonacciRetracements.find((item) => item.id === fib.id);
      if (current) createToolbar(current);
    });
    div.querySelector(".rect-tb-del")!.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFib(fib.id);
    });
    div.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candles);
  }

  function updateFib(id: string, patch: Partial<FibonacciRetracement>) {
    const idx = fibonacciRetracements.findIndex((item) => item.id === id);
    if (idx < 0) return;
    fibonacciRetracements[idx] = { ...fibonacciRetracements[idx], ...patch };
    callbacks.onUpdate(fibonacciRetracements[idx]);
    syncAll();
  }

  function deleteFib(id: string) {
    fibonacciRetracements = fibonacciRetracements.filter((item) => item.id !== id);
    const els = elMap.get(id);
    els?.group.remove();
    els?.labelGroup.remove();
    elMap.delete(id);
    removeAxisBadges(id);
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("fibonacci");
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
      manager.clearSelection("fibonacci");
      return;
    }
    selectedId = id;
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (fib) createToolbar(fib);
    manager.activateSelection("fibonacci", elMap.get(id)?.group ?? null);
    syncAll();
  }

  function buildFibEls(fib: FibonacciRetracement): FibEls {
    const group = overlay.createClippedGroup();
    group.dataset.fibId = fib.id;

    const labelGroup = overlay.createClippedGroup();
    labelGroup.setAttribute("class", "fib-label-group");
    labelGroup.dataset.fibId = fib.id;

    const trendLine = document.createElementNS(SVG_NS, "line");
    trendLine.setAttribute("class", "fib-trend-line");

    const trendHit = document.createElementNS(SVG_NS, "line");
    trendHit.setAttribute("class", "fib-trend-hit");

    const handle1 = document.createElementNS(SVG_NS, "circle");
    handle1.setAttribute("class", "rect-handle-el fib-handle");
    handle1.setAttribute("r", String(TV_HANDLE_RADIUS));

    const handle2 = document.createElementNS(SVG_NS, "circle");
    handle2.setAttribute("class", "rect-handle-el fib-handle");
    handle2.setAttribute("r", String(TV_HANDLE_RADIUS));

    const levels: LevelEls[] = FIB_LEVELS.map(() => {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "fib-level-line");
      const hit = document.createElementNS(SVG_NS, "line");
      hit.setAttribute("class", "fib-level-hit");
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "fib-level-label");
      return { line, hit, label };
    });

    group.append(trendLine, trendHit, ...levels.flatMap((level) => [level.line, level.hit]), handle1, handle2);
    labelGroup.append(...levels.map((level) => level.label));

    const onBodyDown = (event: PointerEvent) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciRetracements.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragBody(fib.id, event);
    };

    trendHit.addEventListener("pointerdown", onBodyDown);
    levels.forEach((level) => level.hit.addEventListener("pointerdown", onBodyDown));

    handle1.addEventListener("pointerdown", (event) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciRetracements.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragHandle(fib.id, "point1", event);
    });

    handle2.addEventListener("pointerdown", (event) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.preventDefault();
      selectFib(fib.id);
      const current = fibonacciRetracements.find((item) => item.id === fib.id);
      if (current?.locked) return;
      startDragHandle(fib.id, "point2", event);
    });

    return { group, labelGroup, trendLine, trendHit, handle1, handle2, levels };
  }

  function renderFibLevels(
    levels: LevelEls[],
    p1: PixelPoint,
    p2: PixelPoint,
    showLabels: boolean,
    width: number,
    style: DrawingLineStyle,
  ) {
    const anchors = anchorPricesFromPixels(series, p1, p2);
    if (!anchors) return;
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight } = horizontalSpan(p1, p2, plotWidth);
    FIB_LEVELS.forEach((level, index) => {
      const price = levelPriceFromAnchors(anchors.p0, anchors.p100, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      const levelEls = levels[index];
      applyLevelLine(levelEls, xLeft, xRight, y, level.color, width, style);
      if (showLabels && levelEls.label) {
        applyLevelLabel(levelEls.label, xRight, y, level.ratio, price, level.color, pricePrecision);
      } else if (levelEls.label) {
        levelEls.label.setAttribute("visibility", "hidden");
      }
    });
  }

  function renderFibGeometry(
    fib: FibonacciRetracement,
    els: FibEls,
    p1: PixelPoint,
    p2: PixelPoint,
    isSelected: boolean,
  ) {
    const { p1: cp1, p2: cp2 } = clampPlotPair(p1, p2);
    const lineStyle = fibLineStyle(fib);
    els.trendLine.setAttribute("x1", String(cp1.x));
    els.trendLine.setAttribute("y1", String(cp1.y));
    els.trendLine.setAttribute("x2", String(cp2.x));
    els.trendLine.setAttribute("y2", String(cp2.y));
    applyLineStroke(els.trendLine, "#787b86", lineStyle.width, lineStyle.style);

    els.trendHit.setAttribute("x1", String(cp1.x));
    els.trendHit.setAttribute("y1", String(cp1.y));
    els.trendHit.setAttribute("x2", String(cp2.x));
    els.trendHit.setAttribute("y2", String(cp2.y));

    renderFibLevels(els.levels, cp1, cp2, fib.showLabels !== false, lineStyle.width, lineStyle.style);
    applyHandles(els.handle1, els.handle2, cp1, cp2, !fib.locked);
    els.group.classList.toggle("selected", isSelected);
  }

  function syncOne(fib: FibonacciRetracement) {
    let els = elMap.get(fib.id);
    if (!els) {
      els = buildFibEls(fib);
      elMap.set(fib.id, els);
    }
    const p1 = toPixel(fib.point1);
    const p2 = toPixel(fib.point2);
    if (!p1 || !p2) {
      els.group.setAttribute("visibility", "hidden");
      els.labelGroup.setAttribute("visibility", "hidden");
      syncAxisBadges(fib, false);
      return;
    }
    els.group.setAttribute("visibility", "visible");
    els.labelGroup.setAttribute("visibility", "visible");
    renderFibGeometry(fib, els, p1, p2, selectedId === fib.id);
    syncAxisBadges(fib, true);
  }

  function syncAll() {
    overlay.sync();
    fibonacciRetracements.forEach(syncOne);
    for (const id of axisBadgeMap.keys()) {
      if (!fibonacciRetracements.some((fib) => fib.id === id)) removeAxisBadges(id);
    }
  }

  function previewAtPixels(fib: FibonacciRetracement, p1: PixelPoint, p2: PixelPoint) {
    const els = elMap.get(fib.id);
    if (!els) return;
    renderFibGeometry(fib, els, p1, p2, selectedId === fib.id);
    const previewFib: FibonacciRetracement = {
      ...fib,
      point1: { ...fib.point1, price: pxToPrice(series, p1.y) ?? fib.point1.price },
      point2: { ...fib.point2, price: pxToPrice(series, p2.y) ?? fib.point2.price },
    };
    syncAxisBadges(previewFib, true);
  }

  function ensureGhostElements() {
    if (ghostGroup && ghostTrendLine && ghostLevelLines && ghostLevelLabels && ghostHandle1 && ghostHandle2) return;

    const lineGroup = overlay.createClippedGroup();
    lineGroup.setAttribute("class", "fib-ghost fib-ghost-lines");

    const labelGroup = overlay.createClippedGroup();
    labelGroup.setAttribute("class", "fib-ghost fib-ghost-labels");

    ghostGroup = lineGroup;

    ghostTrendLine = document.createElementNS(SVG_NS, "line");
    ghostTrendLine.setAttribute("class", "fib-trend-line");
    lineGroup.appendChild(ghostTrendLine);

    ghostLevelLines = [];
    ghostLevelLabels = [];
    FIB_LEVELS.forEach(() => {
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
    lineGroup.append(ghostHandle1, ghostHandle2);
  }

  function clearGhost() {
    if (ghostRaf) {
      cancelAnimationFrame(ghostRaf);
      ghostRaf = 0;
    }
    latestDrawPointer = null;
    svg.querySelectorAll(".fib-ghost").forEach((node) => node.remove());
    ghostGroup = null;
    ghostTrendLine = null;
    ghostLevelLines = null;
    ghostLevelLabels = null;
    ghostHandle1 = null;
    ghostHandle2 = null;
  }

  function updateGhost(p1: PixelPoint, p2: PixelPoint) {
    ensureGhostElements();
    const { p1: cp1, p2: cp2 } = clampPlotPair(p1, p2);
    ghostTrendLine!.setAttribute("x1", String(cp1.x));
    ghostTrendLine!.setAttribute("y1", String(cp1.y));
    ghostTrendLine!.setAttribute("x2", String(cp2.x));
    ghostTrendLine!.setAttribute("y2", String(cp2.y));

    const anchors = anchorPricesFromPixels(series, cp1, cp2);
    if (!anchors) return;
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight } = horizontalSpan(cp1, cp2, plotWidth);
    const ghostStyle = DEFAULT_FIB_LINE;
    FIB_LEVELS.forEach((level, index) => {
      const price = levelPriceFromAnchors(anchors.p0, anchors.p100, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      applyLevelLine({ line: ghostLevelLines![index] }, xLeft, xRight, y, level.color, ghostStyle.width, ghostStyle.style);
      applyLevelLabel(ghostLevelLabels![index], xRight, y, level.ratio, price, level.color, pricePrecision);
    });
    applyLineStroke(ghostTrendLine!, "#787b86", ghostStyle.width, ghostStyle.style);
    applyHandles(ghostHandle1!, ghostHandle2!, cp1, cp2, true);
  }

  function flushGhostPreview() {
    ghostRaf = 0;
    if (!drawPoint1 || !latestDrawPointer) return;
    const p1 = toPixel(drawPoint1);
    if (!p1) return;
    updateGhost(p1, latestDrawPointer);
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

  function startDragHandle(id: string, which: "point1" | "point2", startEvent: PointerEvent) {
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (!fib) return;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(fib.point1);
    const originalP2 = toPixel(fib.point2);
    if (!originalP1 || !originalP2) return;
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
      const p1 = which === "point1" ? dragged : (toPixel(fib.point1) ?? originalP1);
      const p2 = which === "point2" ? dragged : (toPixel(fib.point2) ?? originalP2);
      previewAtPixels(fib, p1, p2);
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
      const current = fibonacciRetracements.find((item) => item.id === id);
      if (current && moved && latestEvent) {
        const clamped = clampPlotPoint({
          x: latestEvent.clientX - rect.left,
          y: latestEvent.clientY - rect.top,
        });
        const time = xToTime(chart, clamped.x, candles);
        const price = pxToPrice(series, clamped.y);
        if (time != null && price != null && price > 0) current[which] = { time, price };
        syncAll();
        callbacks.onUpdate(current);
      }
    };

    dragActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function startDragBody(id: string, startEvent: PointerEvent) {
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (!fib) return;
    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...fib.point1 };
    const origP2 = { ...fib.point2 };
    const p1Px = toPixel(origP1);
    const p2Px = toPixel(origP2);
    if (!p1Px || !p2Px) return;
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
      const current = fibonacciRetracements.find((item) => item.id === id);
      if (current && moved) {
        const fp1 = clampPlotPoint({ x: p1Px.x + finalDx, y: p1Px.y + finalDy });
        const fp2 = clampPlotPoint({ x: p2Px.x + finalDx, y: p2Px.y + finalDy });
        const newP1Time = xToTime(chart, fp1.x, candles);
        const newP1Price = pxToPrice(series, fp1.y);
        const newP2Time = xToTime(chart, fp2.x, candles);
        const newP2Price = pxToPrice(series, fp2.y);
        if (
          newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null
          && newP1Price > 0 && newP2Price > 0
        ) {
          current.point1 = { time: newP1Time, price: newP1Price };
          current.point2 = { time: newP2Time, price: newP2Price };
        }
        syncAll();
        callbacks.onUpdate(current);
      }
    };

    dragActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function handleDrawClick(event: any) {
    if (drawingMode !== "fibonacci") return;
    const rect = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    let x = sourceEvent ? sourceEvent.clientX - rect.left : null;
    let y = sourceEvent ? sourceEvent.clientY - rect.top : null;
    if (x != null && y != null) {
      const clamped = clampPlotPoint({ x, y });
      x = clamped.x;
      y = clamped.y;
    }
    const time = x != null ? xToTime(chart, x, candles) : (event.time as number | undefined);
    const price = y != null ? pxToPrice(series, y) : (event.seriesData?.get(series)?.close as number | undefined);
    if (time == null || price == null || price <= 0) return;

    if (!drawPoint1) {
      drawPoint1 = { time, price };
      window.addEventListener("pointermove", handleDrawPointerMove);
    } else {
      const newFib: FibonacciRetracement = {
        id: crypto.randomUUID(),
        datasetId,
        point1: drawPoint1,
        point2: { time, price },
        showLabels: true,
        locked: false,
        lineWidth: DEFAULT_FIB_LINE.width,
        lineStyle: DEFAULT_FIB_LINE.style,
      };
      fibonacciRetracements.push(newFib);
      callbacks.onCreate(newFib);
      drawPoint1 = null;
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
      if (drawPoint1) {
        drawPoint1 = null;
        window.removeEventListener("pointermove", handleDrawPointerMove);
        clearGhost();
        callbacks.onDrawingComplete();
      }
      if (selectedId) selectFib(null);
    }
  }

  let rafId = 0;
  function loop() {
    if (!dragActive) syncAll();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  const unregisterDeselect = manager.registerDeselect("fibonacci", () => {
    if (selectedId === null) return;
    selectedId = null;
    removeToolbar();
    syncAll();
  });

  if (drawingMode === "fibonacci") {
    chart.subscribeClick(handleDrawClick);
  }
  container.addEventListener("pointerdown", handleBackgroundClick);
  document.addEventListener("keydown", handleKeyDown);

  return () => {
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(dragRaf);
    cancelAnimationFrame(ghostRaf);
    unregisterDeselect();
    try { chart.unsubscribeClick(handleDrawClick); } catch { }
    window.removeEventListener("pointermove", handleDrawPointerMove);
    container.removeEventListener("pointerdown", handleBackgroundClick);
    document.removeEventListener("keydown", handleKeyDown);
    overlay.remove();
    axisLayer.remove();
    removeToolbar();
    clearGhost();
  };
}
