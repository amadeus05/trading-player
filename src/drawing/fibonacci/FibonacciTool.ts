/**
 * FibonacciTool – retracement / extension grid with two anchor points.
 */

import type { FibonacciRetracement } from "../../types";
import { pointToPixel, snapXToNearestCandle, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { attachManagedDrawingLifecycle, createClipboardBridge } from "../shared/ManagedDrawingTool";
import type { DrawingLineStyle } from "../shared/DrawingToolbar";
import { createDrawingOverlay } from "../shared/overlay";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore } from "../shared/types";

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

function retracementLabelAnchorX(p1: PixelPoint, p2: PixelPoint) {
  return Math.max(p1.x, p2.x);
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
  candleStore: ChartCandleStore;
  fibonacciRetracements: FibonacciRetracement[];
  drawingMode: DrawingMode;
  datasetId: string;
  pricePrecision: number;
  callbacks: FibonacciCallbacks;
}): () => void {
  const { container, chart, series, candleStore, drawingMode, datasetId, pricePrecision, callbacks, manager } = opts;
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
  let interactionSyncRaf = 0;
  let finalSyncRaf = 0;
  let wheelSyncTimer = 0;
  let latestDrawPointer: { x: number; y: number } | null = null;

  let toolbarController: DrawingToolbarController<FibonacciRetracement>;

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

  function removeToolbar() {
    toolbarController.hide();
  }

  function createToolbar(fib: FibonacciRetracement) {
    toolbarController.show(fib);
  }

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candleStore.candles);
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
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("fibonacci");
    }
    callbacks.onDelete(id);
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "line-only",
    persistenceKey: (fib) => `fibonacci:${fib.id}`,
    getState: (fib) => {
      const lineStyle = fibLineStyle(fib);
      return {
        lineColor: "#787b86",
        width: lineStyle.width,
        style: lineStyle.style,
        locked: Boolean(fib.locked),
      };
    },
    onPatch: (fib, patch) => {
      updateFib(fib.id, {
        ...(patch.width != null ? { lineWidth: patch.width } : {}),
        ...(patch.style ? { lineStyle: patch.style } : {}),
        ...(patch.locked != null ? { locked: patch.locked } : {}),
      });
    },
    onDelete: (fib) => deleteFib(fib.id),
    onSync: () => syncAll(),
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "fibonacci",
    bridge: createClipboardBridge({
      kind: "fibonacci",
      datasetId,
      candleStore,
      getSelectedId: () => selectedId,
      findById: (id) => fibonacciRetracements.find((item) => item.id === id),
      append: (fib) => { fibonacciRetracements.push(fib); },
      onCreate: callbacks.onCreate,
      select: (id) => selectFib(id),
      deleteSelected: () => { if (selectedId) deleteFib(selectedId); },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      cancelDrawing: () => {
        if (!drawPoint1) return false;
        drawPoint1 = null;
        window.removeEventListener("pointermove", handleDrawPointerMove);
        clearGhost();
        callbacks.onDrawingComplete();
        return true;
      },
    }),
    syncAll,
    isDragActive: () => dragActive,
    onDeselect: () => {
      if (selectedId === null) return;
      selectedId = null;
      removeToolbar();
      syncAll();
    },
  });

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
    manager.activateSelection("fibonacci", elMap.get(id)?.group ?? null, id);
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
    p0: number,
    p100: number,
    showLabels: boolean,
    width: number,
    style: DrawingLineStyle,
  ) {
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight } = horizontalSpan(p1, p2, plotWidth);
    const labelAnchorX = retracementLabelAnchorX(p1, p2);
    FIB_LEVELS.forEach((level, index) => {
      const price = levelPriceFromAnchors(p0, p100, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      const levelEls = levels[index];
      applyLevelLine(levelEls, xLeft, xRight, y, level.color, width, style);
      if (showLabels && levelEls.label) {
        applyLevelLabel(levelEls.label, labelAnchorX, y, level.ratio, price, level.color, pricePrecision);
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
    priceSource: "stored" | "pixels" = "stored",
  ) {
    const lineStyle = fibLineStyle(fib);
    els.trendLine.setAttribute("x1", String(p1.x));
    els.trendLine.setAttribute("y1", String(p1.y));
    els.trendLine.setAttribute("x2", String(p2.x));
    els.trendLine.setAttribute("y2", String(p2.y));
    applyTrendLineStroke(els.trendLine, "#787b86", lineStyle.width);

    els.trendHit.setAttribute("x1", String(p1.x));
    els.trendHit.setAttribute("y1", String(p1.y));
    els.trendHit.setAttribute("x2", String(p2.x));
    els.trendHit.setAttribute("y2", String(p2.y));

    let p0 = fib.point2.price;
    let p100 = fib.point1.price;
    if (priceSource === "pixels") {
      const anchors = anchorPricesFromPixels(series, p1, p2);
      if (anchors) {
        p0 = anchors.p0;
        p100 = anchors.p100;
      }
    }
    renderFibLevels(els.levels, p1, p2, p0, p100, fib.showLabels !== false, lineStyle.width, lineStyle.style);
    applyHandles(els.handle1, els.handle2, p1, p2, !fib.locked);
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
      return;
    }
    els.group.setAttribute("visibility", "visible");
    els.labelGroup.setAttribute("visibility", "visible");
    renderFibGeometry(fib, els, p1, p2, selectedId === fib.id);
  }

  function syncAll() {
    if (dragActive) return;
    overlay.sync();
    fibonacciRetracements.forEach(syncOne);
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

  function previewAtPixels(fib: FibonacciRetracement, p1: PixelPoint, p2: PixelPoint) {
    const els = elMap.get(fib.id);
    if (!els) return;
    renderFibGeometry(fib, els, p1, p2, selectedId === fib.id, "pixels");
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
    ghostTrendLine!.setAttribute("x1", String(p1.x));
    ghostTrendLine!.setAttribute("y1", String(p1.y));
    ghostTrendLine!.setAttribute("x2", String(p2.x));
    ghostTrendLine!.setAttribute("y2", String(p2.y));

    const anchors = anchorPricesFromPixels(series, p1, p2);
    if (!anchors) return;
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight } = horizontalSpan(p1, p2, plotWidth);
    const labelAnchorX = retracementLabelAnchorX(p1, p2);
    const ghostStyle = DEFAULT_FIB_LINE;
    FIB_LEVELS.forEach((level, index) => {
      const price = levelPriceFromAnchors(anchors.p0, anchors.p100, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      applyLevelLine({ line: ghostLevelLines![index] }, xLeft, xRight, y, level.color, ghostStyle.width, ghostStyle.style);
      applyLevelLabel(ghostLevelLabels![index], labelAnchorX, y, level.ratio, price, level.color, pricePrecision);
    });
    applyTrendLineStroke(ghostTrendLine!, "#787b86", ghostStyle.width);
    applyHandles(ghostHandle1!, ghostHandle2!, p1, p2, true);
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
      x: snapXToNearestCandle(chart, event.clientX - rect.left),
      y: event.clientY - rect.top,
    });
    if (!ghostRaf) ghostRaf = requestAnimationFrame(flushGhostPreview);
  }

  function startDragHandle(id: string, which: "point1" | "point2", startEvent: PointerEvent) {
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (!fib) return;
    dragActive = true;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(fib.point1);
    const originalP2 = toPixel(fib.point2);
    if (!originalP1 || !originalP2) {
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
        x: snapXToNearestCandle(chart, event.clientX - rect.left),
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
        const time = xToSnappedTime(chart, clamped.x, candleStore.candles);
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
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (!fib) return;
    dragActive = true;
    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...fib.point1 };
    const origP2 = { ...fib.point2 };
    const p1Px = toPixel(origP1);
    const p2Px = toPixel(origP2);
    if (!p1Px || !p2Px) {
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
      const dx = snapXToNearestCandle(chart, p1Px.x + (event.clientX - rect.left) - startX) - p1Px.x;
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
        const newP1Time = xToSnappedTime(chart, fp1.x, candleStore.candles);
        const newP1Price = pxToPrice(series, fp1.y);
        const newP2Time = xToSnappedTime(chart, fp2.x, candleStore.candles);
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
    const time = x != null ? xToSnappedTime(chart, x, candleStore.candles) : (event.time as number | undefined);
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

  syncAll();

  const onVisibleRangeChange = () => {
    if (!dragActive) manager.scheduleOverlaySync();
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
  container.addEventListener("wheel", handleScaleWheel, { capture: true, passive: true });
  container.addEventListener("pointerdown", handlePointerDown, { capture: true });
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);

  if (drawingMode === "fibonacci") {
    chart.subscribeClick(handleDrawClick);
  }
  container.addEventListener("pointerdown", handleBackgroundClick);

  return () => {
    cancelAnimationFrame(dragRaf);
    cancelAnimationFrame(ghostRaf);
    cancelAnimationFrame(interactionSyncRaf);
    cancelAnimationFrame(finalSyncRaf);
    window.clearTimeout(wheelSyncTimer);
    unregisterLifecycle();
    try { chart.unsubscribeClick(handleDrawClick); } catch { }
    try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange); } catch { }
    container.removeEventListener("wheel", handleScaleWheel, { capture: true });
    container.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("pointermove", handleDrawPointerMove);
    container.removeEventListener("pointerdown", handleBackgroundClick);
    overlay.remove();
    toolbarController.destroy();
    removeToolbar();
    clearGhost();
  };
}
