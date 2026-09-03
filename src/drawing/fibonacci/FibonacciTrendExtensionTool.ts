/**
 * FibonacciTrendExtensionTool – Fibonacci Trend-Based Extension with three anchor points.
 * Points 1 and 2 define the trend, Point 3 defines the retracement from which extensions are drawn.
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { FibonacciTrendExtension } from "../../types";
import { pointToPixel, snapXToNearestCandle, xToSnappedTime } from "../shared/coordinates";
import { magnetPlotHeight, snapPixelsWithMagnet } from "../shared/magnet";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { getNewDrawingStyle } from "../shared/drawingTemplates";
import { attachManagedDrawingLifecycle, attachScaleInteractionSync, createClipboardBridge, runManagedDragSession } from "../shared/ManagedDrawingTool";
import type { DrawingLineStyle } from "../shared/DrawingToolbar";
import { createDrawingOverlay } from "../shared/overlay";
import { createDrawingSession, drawingPointFromClick } from "../shared/drawingSession";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore, SeriesApiLike } from "../shared/types";
import { createSelectionController } from "../shared/selection";

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

function pxToPrice(series: SeriesApiLike, y: number): number | null {
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
  return { xLeft, xRight };
}

function levelLabelSpan(p2: PixelPoint, p3: PixelPoint) {
  const labelLeft = Math.min(p2.x, p3.x);
  const labelRight = Math.max(p2.x, p3.x);
  // Подписи на стороне точки 3; при пересечении через точку 2 — инверсия
  const labelOnRight = p3.x >= p2.x;
  return { labelLeft, labelRight, labelOnRight };
}

function anchorPricesFromPixels(
  series: SeriesApiLike,
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
  const impulse = price2 - price1;
  return price3 + impulse * ratio;
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
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  fibonacciTrendExtensions: FibonacciTrendExtension[];
  drawingMode: DrawingMode;
  datasetId: string;
  pricePrecision: number;
  callbacks: FibonacciTrendExtensionCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, pricePrecision, callbacks, manager } = opts;
  let fibonacciTrendExtensions = [...opts.fibonacciTrendExtensions];

  const overlay = createDrawingOverlay(container, chart, "fib-overlay", { shared: true });
  const { svg } = overlay;

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

  let toolbarController: DrawingToolbarController<FibonacciTrendExtension>;

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

  function removeToolbar() {
    toolbarController.hide();
  }

  function createToolbar(fib: FibonacciTrendExtension) {
    toolbarController.show(fib);
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

  const selection = createSelectionController<FibonacciTrendExtension>({
    kind: "fibtrendext",
    manager,
    container,
    findById: (id) => fibonacciTrendExtensions.find((item) => item.id === id),
    getSelectionElement: (id) => elMap.get(id)?.group ?? null,
    onShow: (fib) => createToolbar(fib),
    onHide: () => removeToolbar(),
    syncAll,
    ignoreSelector: ".fib-trend-hit, .fib-level-hit, .fib-handle",
  });
  const selectFib = selection.select;

  function deleteFib(id: string) {
    fibonacciTrendExtensions = fibonacciTrendExtensions.filter((item) => item.id !== id);
    const els = elMap.get(id);
    els?.group.remove();
    els?.labelGroup.remove();
    elMap.delete(id);
    selection.handleDeleted(id);
    callbacks.onDelete(id);
  }

  function purgeAllFib() {
    for (const els of elMap.values()) {
      els.group.remove();
      els.labelGroup.remove();
    }
    elMap.clear();
    fibonacciTrendExtensions = [];
    selection.reset();
    syncAll();
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "line-only",
    templateKind: "fibtrendext",
    persistenceKey: (fib) => `fibtrendext:${fib.id}`,
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
    kind: "fibtrendext",
    bridge: createClipboardBridge({
      kind: "fibtrendext",
      datasetId,
      candleStore,
      getSelectedId: () => selection.getSelectedId(),
      findById: (id) => fibonacciTrendExtensions.find((item) => item.id === id),
      append: (fib) => { fibonacciTrendExtensions.push(fib); },
      onCreate: callbacks.onCreate,
      select: (id) => selectFib(id),
      deleteSelected: () => {
        const id = selection.getSelectedId();
        if (id) deleteFib(id);
      },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      syncAll,
      cancelDrawing: (silent?: boolean) => drawingSession.cancel(silent),
    }),
    syncAll,
    isDragActive: () => dragActive,
    // Отмена и повтор подменяют коллекцию снаружи. Сбрасываем своё и заливаем
    // новое — график при этом не пересоздаётся и положение не теряется.
    replaceAll: (items) => {
      purgeAllFib();
      fibonacciTrendExtensions = (items as FibonacciTrendExtension[]).map((item) => ({ ...item }));
      syncAll();
    },
    onDeselect: () => selection.handleManagerDeselect(),
    purgeAll: purgeAllFib,
  });

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
    const { xLeft, xRight } = levelHorizontalSpan(p2, p3, plotWidth);
    const { labelLeft, labelRight, labelOnRight } = levelLabelSpan(p2, p3);

    const levelYs: number[] = [];

    FIB_TREND_EXT_LEVELS.forEach((level, index) => {
      const price = trendExtensionPrice(price1, price2, price3, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      levelYs[index] = y;
      const levelEls = levels[index];
      applyLevelLine(levelEls, xLeft, xRight, y, level.color, width, style);
      if (showLabels && levelEls.label) {
        applyLevelLabel(levelEls.label, labelLeft, labelRight, y, level.ratio, price, level.color, pricePrecision, labelOnRight);
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
    const { xLeft, xRight } = levelHorizontalSpan(p2, p3, plotWidth);
    const { labelLeft, labelRight, labelOnRight } = levelLabelSpan(p2, p3);

    const levelYs: number[] = [];
    FIB_TREND_EXT_LEVELS.forEach((level, index) => {
      const price = trendExtensionPrice(price1, price2, price3, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      levelYs[index] = y;
      applyLevelLine({ line: levelLines[index] }, xLeft, xRight, y, level.color, lineWidth, lineStyle);
      if (showLabels && levelLabels) {
        applyLevelLabel(levelLabels[index], labelLeft, labelRight, y, level.ratio, price, level.color, pricePrecision, labelOnRight);
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
    const lineStyle = fibLineStyle(fib);

    let price1 = fib.point1.price;
    let price2 = fib.point2.price;
    let price3 = fib.point3.price;
    if (priceSource === "pixels") {
      const anchors = anchorPricesFromPixels(series, p1, p2, p3);
      if (anchors) {
        price1 = anchors.price1;
        price2 = anchors.price2;
        price3 = anchors.price3;
      }
    }

    // Первая трендовая линия (от p1 к p2)
    els.trendLine1.setAttribute("x1", String(p1.x));
    els.trendLine1.setAttribute("y1", String(p1.y));
    els.trendLine1.setAttribute("x2", String(p2.x));
    els.trendLine1.setAttribute("y2", String(p2.y));
    applyTrendLineStroke(els.trendLine1, "#787b86", lineStyle.width);

    els.trendHit1.setAttribute("x1", String(p1.x));
    els.trendHit1.setAttribute("y1", String(p1.y));
    els.trendHit1.setAttribute("x2", String(p2.x));
    els.trendHit1.setAttribute("y2", String(p2.y));

    // Вторая трендовая линия (от p2 к p3)
    els.trendLine2.setAttribute("x1", String(p2.x));
    els.trendLine2.setAttribute("y1", String(p2.y));
    els.trendLine2.setAttribute("x2", String(p3.x));
    els.trendLine2.setAttribute("y2", String(p3.y));
    applyTrendLineStroke(els.trendLine2, "#787b86", lineStyle.width);

    els.trendHit2.setAttribute("x1", String(p2.x));
    els.trendHit2.setAttribute("y1", String(p2.y));
    els.trendHit2.setAttribute("x2", String(p3.x));
    els.trendHit2.setAttribute("y2", String(p3.y));

    renderFibLevels(
      els.levels,
      els.fills,
      p2,
      p3,
      price1,
      price2,
      price3,
      fib.showLabels !== false,
      lineStyle.width,
      lineStyle.style,
    );
    applyHandles(els.handle1, els.handle2, els.handle3, p1, p2, p3, !fib.locked);
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
    renderFibGeometry(fib, els, p1, p2, p3, selection.isSelected(fib.id));
  }

  function syncAll() {
    if (dragActive) return;
    overlay.sync();
    fibonacciTrendExtensions.forEach(syncOne);
  }

  const scaleInteractionSync = attachScaleInteractionSync({
    isDragActive: () => dragActive,
    syncAll,
    shouldIgnorePointerDown: (target) => Boolean(
      target.closest(".fib-toolbar, .fib-trend-hit, .fib-level-hit, .fib-handle"),
    ),
  });

  function previewAtPixels(fib: FibonacciTrendExtension, p1: PixelPoint, p2: PixelPoint, p3: PixelPoint) {
    const els = elMap.get(fib.id);
    if (!els) return;
    overlay.sync();
    renderFibGeometry(fib, els, p1, p2, p3, selection.isSelected(fib.id), "pixels");
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

    ghostTrendLine1!.setAttribute("x1", String(p1.x));
    ghostTrendLine1!.setAttribute("y1", String(p1.y));
    ghostTrendLine1!.setAttribute("x2", String(p2.x));
    ghostTrendLine1!.setAttribute("y2", String(p2.y));
    applyTrendLineStroke(ghostTrendLine1!, "#787b86", DEFAULT_FIB_LINE.width);

    if (p3) {
      ghostTrendLine2!.setAttribute("x1", String(p2.x));
      ghostTrendLine2!.setAttribute("y1", String(p2.y));
      ghostTrendLine2!.setAttribute("x2", String(p3.x));
      ghostTrendLine2!.setAttribute("y2", String(p3.y));
      applyTrendLineStroke(ghostTrendLine2!, "#787b86", DEFAULT_FIB_LINE.width);
      ghostTrendLine2!.style.display = "";
      ghostLevelLines!.forEach((line) => { line.style.display = ""; });
      const anchors = anchorPricesFromPixels(series, p1, p2, p3);
      if (anchors) {
        renderFibLevelsToLines(
          ghostLevelLines!,
          ghostLevelLabels,
          ghostLevelFills,
          p2,
          p3,
          anchors.price1,
          anchors.price2,
          anchors.price3,
          DEFAULT_FIB_LINE.width,
          DEFAULT_FIB_LINE.style,
          true,
        );
      }
      applyHandles(ghostHandle1!, ghostHandle2!, ghostHandle3!, p1, p2, p3, true);
    } else {
      ghostTrendLine2!.style.display = "none";
      ghostLevelLines?.forEach((line) => { line.style.display = "none"; });
      ghostLevelLabels?.forEach((label) => label.setAttribute("visibility", "hidden"));
      ghostLevelFills?.forEach((fill) => fill.setAttribute("visibility", "hidden"));
      ghostHandle1!.setAttribute("cx", String(p1.x));
      ghostHandle1!.setAttribute("cy", String(p1.y));
      ghostHandle2!.setAttribute("cx", String(p2.x));
      ghostHandle2!.setAttribute("cy", String(p2.y));
      ghostHandle1!.style.display = "";
      ghostHandle2!.style.display = "";
      ghostHandle3!.style.display = "none";
    }
  }

  function startDragHandle(id: string, which: "point1" | "point2" | "point3", startEvent: PointerEvent) {
    const fib = fibonacciTrendExtensions.find((item) => item.id === id);
    if (!fib) return;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(fib.point1);
    const originalP2 = toPixel(fib.point2);
    const originalP3 = toPixel(fib.point3);
    if (!originalP1 || !originalP2 || !originalP3) return;

    let latestEvent: PointerEvent | null = null;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      onMove: (event) => {
        latestEvent = event;
        const snap = snapPixelsWithMagnet(
          manager, chart, series, candleStore.candles,
          event.clientX - rect.left, event.clientY - rect.top, magnetPlotHeight(container, chart),
          { clampX: true, plotWidth: chart.timeScale().width() },
        );
        const dragged = clampPlotPoint({ x: snap.x, y: snap.y });
        const p1 = which === "point1" ? dragged : originalP1;
        const p2 = which === "point2" ? dragged : originalP2;
        const p3 = which === "point3" ? dragged : originalP3;
        previewAtPixels(fib, p1, p2, p3);
      },
      onEnd: (_event, moved) => {
        if (!moved || !latestEvent) return;
        const snap = snapPixelsWithMagnet(
          manager, chart, series, candleStore.candles,
          latestEvent.clientX - rect.left, latestEvent.clientY - rect.top, magnetPlotHeight(container, chart),
          { clampX: true, plotWidth: chart.timeScale().width() },
        );
        const time = snap.time;
        const price = snap.price;
        if (time != null && price != null && price > 0) {
          updateFib(id, { [which]: { time, price } } as Partial<FibonacciTrendExtension>);
        } else {
          syncAll();
        }
      },
    });
  }

  function startDragBody(id: string, startEvent: PointerEvent) {
    const fib = fibonacciTrendExtensions.find((item) => item.id === id);
    if (!fib) return;
    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...fib.point1 };
    const origP2 = { ...fib.point2 };
    const origP3 = { ...fib.point3 };
    const p1Px = toPixel(origP1);
    const p2Px = toPixel(origP2);
    const p3Px = toPixel(origP3);
    if (!p1Px || !p2Px || !p3Px) return;

    let finalDx = 0;
    let finalDy = 0;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      moveThreshold: 3,
      onMove: (event) => {
        finalDx = snapXToNearestCandle(chart, p1Px.x + (event.clientX - rect.left) - startX) - p1Px.x;
        finalDy = (event.clientY - rect.top) - startY;
        previewAtPixels(
          fib,
          clampPlotPoint({ x: p1Px.x + finalDx, y: p1Px.y + finalDy }),
          clampPlotPoint({ x: p2Px.x + finalDx, y: p2Px.y + finalDy }),
          clampPlotPoint({ x: p3Px.x + finalDx, y: p3Px.y + finalDy }),
        );
      },
      onEnd: (_event, moved) => {
        if (!moved) return;
        const fp1 = clampPlotPoint({ x: p1Px.x + finalDx, y: p1Px.y + finalDy });
        const fp2 = clampPlotPoint({ x: p2Px.x + finalDx, y: p2Px.y + finalDy });
        const fp3 = clampPlotPoint({ x: p3Px.x + finalDx, y: p3Px.y + finalDy });
        const newP1Time = xToSnappedTime(chart, fp1.x, candleStore.candles);
        const newP1Price = pxToPrice(series, fp1.y);
        const newP2Time = xToSnappedTime(chart, fp2.x, candleStore.candles);
        const newP2Price = pxToPrice(series, fp2.y);
        const newP3Time = xToSnappedTime(chart, fp3.x, candleStore.candles);
        const newP3Price = pxToPrice(series, fp3.y);
        if (
          newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null && newP3Time != null && newP3Price != null
          && newP1Price > 0 && newP2Price > 0 && newP3Price > 0
        ) {
          updateFib(id, {
            point1: { time: newP1Time, price: newP1Price },
            point2: { time: newP2Time, price: newP2Price },
            point3: { time: newP3Time, price: newP3Price },
          });
        } else {
          syncAll();
        }
      },
    });
  }

  const drawingSession = createDrawingSession<{ time: number; price: number }>({
    mode: "fibtrendext",
    manager,
    container,
    chart,
    series,
    candleStore,
    pointCount: 3,
    clampCursorX: true,
    pointFromClick: (event) => drawingPointFromClick(event, { container, chart, series, candleStore, manager, clampX: true }),
    ghostUpdate: (points, cursor) => {
      const p1 = toPixel(points[0]);
      if (!p1) return;
      const clampedCursor = clampPlotPoint(cursor);
      if (points.length === 1) {
        updateGhost(p1, clampedCursor);
        return;
      }
      const p2 = toPixel(points[1]);
      if (p2) updateGhost(p1, p2, clampedCursor);
    },
    ghostRemove: clearGhost,
    commit: ([point1, point2, point3]) => {
      const tpl = getNewDrawingStyle("fibtrendext");
      const newFib: FibonacciTrendExtension = {
        id: crypto.randomUUID(),
        datasetId,
        point1,
        point2,
        point3,
        showLabels: true,
        locked: false,
        lineWidth: tpl.width,
        lineStyle: tpl.style,
      };
      fibonacciTrendExtensions.push(newFib);
      callbacks.onCreate(newFib);
      selectFib(newFib.id);
      syncAll();
    },
    onComplete: () => callbacks.onDrawingComplete(),
  });

  syncAll();

  const onVisibleRangeChange = () => {
    if (!dragActive) manager.scheduleOverlaySync();
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
  container.addEventListener("wheel", scaleInteractionSync.handleScaleWheel, { capture: true, passive: true });
  container.addEventListener("pointerdown", scaleInteractionSync.handlePointerDown, { capture: true });
  window.addEventListener("pointerup", scaleInteractionSync.handlePointerUp);
  window.addEventListener("pointercancel", scaleInteractionSync.handlePointerUp);

  return () => {
    scaleInteractionSync.destroy();
    unregisterLifecycle();
    drawingSession.destroy();
    try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange); } catch { }
    container.removeEventListener("wheel", scaleInteractionSync.handleScaleWheel, { capture: true });
    container.removeEventListener("pointerdown", scaleInteractionSync.handlePointerDown, { capture: true });
    window.removeEventListener("pointerup", scaleInteractionSync.handlePointerUp);
    window.removeEventListener("pointercancel", scaleInteractionSync.handlePointerUp);
    selection.destroy();
    overlay.remove();
    toolbarController.destroy();
    removeToolbar();
  };
}
