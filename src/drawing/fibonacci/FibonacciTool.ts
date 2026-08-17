/**
 * FibonacciTool – retracement / extension grid with two anchor points.
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { FibonacciLevel, FibonacciRetracement } from "../../types";
import { pointToPixel, snapXToNearestCandle, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { mountDrawingSettingsPanel, type DrawingSettingsPanelController, type DrawingSettingsTabId } from "../shared/DrawingSettingsPanel";
import { getNewDrawingStyle, rememberDrawingStyle } from "../shared/drawingTemplates";
import { attachManagedDrawingLifecycle, attachScaleInteractionSync, createClipboardBridge, runManagedDragSession } from "../shared/ManagedDrawingTool";
import type { DrawingLineStyle } from "../shared/DrawingToolbar";
import { createDrawingOverlay } from "../shared/overlay";
import { createSelectionController } from "../shared/selection";
import { createDrawingSession, drawingPointFromClick } from "../shared/drawingSession";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore, SeriesApiLike } from "../shared/types";
import { DEFAULT_FIB_LEVEL_DEFS, getDefaultFibLevels, resolveFibLevels as resolveLevelList } from "./fibLevels";

export type FibonacciCallbacks = DrawingCrudCallbacks<FibonacciRetracement>;
export { DEFAULT_FIB_LEVEL_DEFS, getDefaultFibLevels };

const SVG_NS = "http://www.w3.org/2000/svg";

const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"></path><path fill-rule="evenodd" d="M8.5 5h11l5 9-5 9h-11l-5-9 5-9Zm-3.86 9L9.1 6h9.82l4.45 8-4.45 8H9.1l-4.45-8Z"></path></svg>`;

/** @deprecated используйте DEFAULT_FIB_LEVEL_DEFS / getDefaultFibLevels */
export const FIB_LEVELS = DEFAULT_FIB_LEVEL_DEFS.filter((level) => level.enabled).map(({ ratio, color }) => ({ ratio, color }));

const TV_HANDLE_RADIUS = 4;
const FIB_LABEL_GAP = 8;
const DEFAULT_FIB_LINE = {
  width: 1,
  style: "solid" as DrawingLineStyle,
};

export function resolveFibLevels(fib: FibonacciRetracement): FibonacciLevel[] {
  return resolveLevelList(fib.levels);
}

function formatLevelInput(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0";
  const rounded = Math.round(ratio * 1e6) / 1e6;
  return String(rounded);
}

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

function pxToPrice(series: SeriesApiLike, y: number): number | null {
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
  enabled = true,
) {
  const visibility = enabled ? "visible" : "hidden";
  levelEls.line.setAttribute("x1", String(xLeft));
  levelEls.line.setAttribute("x2", String(xRight));
  levelEls.line.setAttribute("y1", String(y));
  levelEls.line.setAttribute("y2", String(y));
  levelEls.line.setAttribute("visibility", visibility);
  applyLineStroke(levelEls.line, color, width, style);
  if (levelEls.hit) {
    levelEls.hit.setAttribute("x1", String(xLeft));
    levelEls.hit.setAttribute("x2", String(xRight));
    levelEls.hit.setAttribute("y1", String(y));
    levelEls.hit.setAttribute("y2", String(y));
    levelEls.hit.setAttribute("visibility", visibility);
    levelEls.hit.style.pointerEvents = enabled ? "stroke" : "none";
  }
}

function levelPriceFromAnchors(p0: number, p100: number, ratio: number): number {
  return p0 + ratio * (p100 - p0);
}

function anchorPricesFromPixels(series: SeriesApiLike, p1: PixelPoint, p2: PixelPoint): { p0: number; p100: number } | null {
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
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  fibonacciRetracements: FibonacciRetracement[];
  drawingMode: DrawingMode;
  datasetId: string;
  pricePrecision: number;
  callbacks: FibonacciCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, pricePrecision, callbacks, manager } = opts;
  let fibonacciRetracements = [...opts.fibonacciRetracements];

  const overlay = createDrawingOverlay(container, chart, "fib-overlay", { shared: true });
  const { svg } = overlay;

  let ghostGroup: SVGGElement | null = null;
  let ghostTrendLine: SVGLineElement | null = null;
  let ghostLevelLines: SVGLineElement[] | null = null;
  let ghostLevelLabels: SVGTextElement[] | null = null;
  let ghostHandle1: SVGCircleElement | null = null;
  let ghostHandle2: SVGCircleElement | null = null;
  let dragActive = false;

  let toolbarController: DrawingToolbarController<FibonacciRetracement>;
  let settingsPanel: DrawingSettingsPanelController | null = null;
  let settingsFibId: string | null = null;

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
    levelCount: number;
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

  function removeSettingsPanel() {
    toolbarController.dismissPopups();
    settingsPanel?.destroy();
    settingsPanel = null;
    settingsFibId = null;
  }

  function toggleSettingsPanel(fib: FibonacciRetracement) {
    if (settingsPanel && settingsFibId === fib.id) {
      removeSettingsPanel();
      return;
    }
    createSettingsPanel(fib);
  }

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candleStore.candles);
  }

  function updateFib(id: string, patch: Partial<FibonacciRetracement>) {
    const idx = fibonacciRetracements.findIndex((item) => item.id === id);
    if (idx < 0) return;
    fibonacciRetracements[idx] = { ...fibonacciRetracements[idx], ...patch };
    const next = fibonacciRetracements[idx];
    callbacks.onUpdate(next);
    // Уровни правятся в settings, не через тулбар — запоминаем для следующих фигур.
    if (patch.levels || patch.lineWidth != null || patch.lineStyle || patch.trendColor != null) {
      const lineStyle = fibLineStyle(next);
      rememberDrawingStyle("fibonacci", {
        lineColor: next.trendColor ?? "#787b86",
        width: lineStyle.width,
        style: lineStyle.style,
        levels: resolveFibLevels(next),
      });
    }
    syncAll();
    toolbarController.refresh();
    if (settingsPanel && settingsFibId === id) settingsPanel.refresh();
  }

  function patchFibLevel(id: string, index: number, patch: Partial<FibonacciLevel>) {
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (!fib) return;
    const levels = resolveFibLevels(fib).map((level, i) => (i === index ? { ...level, ...patch } : level));
    updateFib(id, { levels });
  }

  const selection = createSelectionController<FibonacciRetracement>({
    kind: "fibonacci",
    manager,
    container,
    findById: (id) => fibonacciRetracements.find((item) => item.id === id),
    getSelectionElement: (id) => elMap.get(id)?.group ?? null,
    onShow: (fib) => createToolbar(fib),
    onHide: () => {
      removeToolbar();
      removeSettingsPanel();
    },
    syncAll,
    ignoreSelector: ".fib-trend-hit, .fib-level-hit, .fib-handle",
  });
  const selectFib = selection.select;

  function deleteFib(id: string) {
    if (settingsFibId === id) removeSettingsPanel();
    fibonacciRetracements = fibonacciRetracements.filter((item) => item.id !== id);
    const els = elMap.get(id);
    els?.group.remove();
    els?.labelGroup.remove();
    elMap.delete(id);
    selection.handleDeleted(id);
    callbacks.onDelete(id);
  }

  function purgeAllFib() {
    removeSettingsPanel();
    for (const els of elMap.values()) {
      els.group.remove();
      els.labelGroup.remove();
    }
    elMap.clear();
    fibonacciRetracements = [];
    selection.reset();
    syncAll();
  }

  function renderPanelPlaceholder(tabId: DrawingSettingsTabId, body: HTMLDivElement) {
    const placeholder = document.createElement("div");
    placeholder.className = "drawing-settings-placeholder";
    placeholder.textContent = `${tabId[0].toUpperCase()}${tabId.slice(1)} settings will be configured here.`;
    body.appendChild(placeholder);
  }

  function renderStylePanel(fib: FibonacciRetracement, body: HTMLDivElement) {
    const levels = resolveFibLevels(fib);
    const grid = document.createElement("div");
    grid.className = "fib-settings-levels";

    levels.forEach((level, index) => {
      const row = document.createElement("div");
      row.className = "fib-settings-level-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "fib-settings-level-check";
      checkbox.checked = level.enabled;
      checkbox.title = level.enabled ? "Hide level" : "Show level";
      checkbox.addEventListener("change", () => {
        patchFibLevel(fib.id, index, { enabled: checkbox.checked });
      });

      const valueInput = document.createElement("input");
      valueInput.type = "text";
      valueInput.className = "fib-settings-level-value";
      valueInput.value = formatLevelInput(level.ratio);
      valueInput.addEventListener("change", () => {
        const next = Number(valueInput.value);
        if (!Number.isFinite(next)) {
          valueInput.value = formatLevelInput(level.ratio);
          return;
        }
        patchFibLevel(fib.id, index, { ratio: next });
      });

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "fib-settings-level-color";
      colorInput.value = /^#[0-9a-fA-F]{6}$/.test(level.color) ? level.color : "#787b86";
      colorInput.addEventListener("input", () => {
        patchFibLevel(fib.id, index, { color: colorInput.value });
      });

      row.append(checkbox, valueInput, colorInput);
      grid.appendChild(row);
    });

    body.appendChild(grid);
  }

  function createSettingsPanel(fib: FibonacciRetracement) {
    removeSettingsPanel();
    settingsPanel = mountDrawingSettingsPanel({
      container,
      persistenceKey: `fibonacci-settings:${fib.id}`,
      title: "Fib retracement",
      initialTab: "style",
      tabs: [
        { id: "style", label: "Style" },
        { id: "coordinates", label: "Coordinates" },
        { id: "visibility", label: "Visibility" },
      ],
      renderTab: (tabId, tabBody) => {
        if (tabId === "style") {
          const current = fibonacciRetracements.find((item) => item.id === fib.id) ?? fib;
          renderStylePanel(current, tabBody);
          return;
        }
        renderPanelPlaceholder(tabId, tabBody);
      },
      onTemplateClick: (anchor) => {
        toolbarController.openTemplatesFrom(anchor);
      },
      onDragStart: () => toolbarController.dismissPopups(),
      onClose: removeSettingsPanel,
      onCancel: removeSettingsPanel,
      onOk: removeSettingsPanel,
    });
    settingsPanel.panel.classList.add("drawing-settings-panel--fib");
    settingsFibId = fib.id;
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "line-only",
    templateKind: "fibonacci",
    persistenceKey: (fib) => `fibonacci:${fib.id}`,
    resolveDrawing: (fib) => fibonacciRetracements.find((item) => item.id === fib.id) ?? fib,
    getState: (fib) => {
      const live = fibonacciRetracements.find((item) => item.id === fib.id) ?? fib;
      const lineStyle = fibLineStyle(live);
      return {
        lineColor: live.trendColor ?? "#787b86",
        width: lineStyle.width,
        style: lineStyle.style,
        locked: Boolean(live.locked),
        showLabel: live.showLabels !== false,
        levels: resolveFibLevels(live),
      };
    },
    onPatch: (fib, patch) => {
      updateFib(fib.id, {
        ...(patch.width != null ? { lineWidth: patch.width } : {}),
        ...(patch.style ? { lineStyle: patch.style } : {}),
        ...(patch.locked != null ? { locked: patch.locked } : {}),
        ...(patch.showLabel != null ? { showLabels: patch.showLabel } : {}),
        ...(patch.lineColor != null ? { trendColor: patch.lineColor } : {}),
        ...(patch.levels?.length ? { levels: patch.levels.map((level) => ({ ...level })) } : {}),
      });
    },
    onDelete: (fib) => deleteFib(fib.id),
    onSync: () => syncAll(),
    slots: [{
      id: "settings",
      anchor: "before-lock",
      mount: () => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rect-tb-settings rect-tb-icon-btn";
        button.title = "Настройки";
        button.innerHTML = SETTINGS_ICON;
        return button;
      },
      bind: (element, ctx) => {
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          ctx.closePopups();
          toggleSettingsPanel(ctx.drawing);
        });
      },
    }],
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "fibonacci",
    bridge: createClipboardBridge({
      kind: "fibonacci",
      datasetId,
      candleStore,
      getSelectedId: () => selection.getSelectedId(),
      findById: (id) => fibonacciRetracements.find((item) => item.id === id),
      append: (fib) => { fibonacciRetracements.push(fib); },
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
      fibonacciRetracements = (items as FibonacciRetracement[]).map((item) => ({ ...item }));
      syncAll();
    },
    onDeselect: () => selection.handleManagerDeselect(),
    purgeAll: purgeAllFib,
  });

  function destroyFibEls(els: FibEls) {
    els.group.remove();
    els.labelGroup.remove();
  }

  function buildFibEls(fib: FibonacciRetracement): FibEls {
    const levelDefs = resolveFibLevels(fib);
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

    const levels: LevelEls[] = levelDefs.map(() => {
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

    return { group, labelGroup, trendLine, trendHit, handle1, handle2, levels, levelCount: levelDefs.length };
  }

  function renderFibLevels(
    levelDefs: FibonacciLevel[],
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
    levelDefs.forEach((level, index) => {
      const levelEls = levels[index];
      if (!levelEls) return;
      if (!level.enabled) {
        applyLevelLine(levelEls, xLeft, xRight, 0, level.color, width, style, false);
        if (levelEls.label) levelEls.label.setAttribute("visibility", "hidden");
        return;
      }
      const price = levelPriceFromAnchors(p0, p100, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) {
        applyLevelLine(levelEls, xLeft, xRight, 0, level.color, width, style, false);
        if (levelEls.label) levelEls.label.setAttribute("visibility", "hidden");
        return;
      }
      applyLevelLine(levelEls, xLeft, xRight, y, level.color, width, style, true);
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
    const levelDefs = resolveFibLevels(fib);
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
    renderFibLevels(levelDefs, els.levels, p1, p2, p0, p100, fib.showLabels !== false, lineStyle.width, lineStyle.style);
    applyHandles(els.handle1, els.handle2, p1, p2, !fib.locked);
    els.group.classList.toggle("selected", isSelected);
  }

  function syncOne(fib: FibonacciRetracement) {
    const levelCount = resolveFibLevels(fib).length;
    let els = elMap.get(fib.id);
    if (els && els.levelCount !== levelCount) {
      destroyFibEls(els);
      elMap.delete(fib.id);
      els = undefined;
    }
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
    renderFibGeometry(fib, els, p1, p2, selection.isSelected(fib.id));
  }

  function syncAll() {
    if (dragActive) return;
    overlay.sync();
    fibonacciRetracements.forEach(syncOne);
  }

  const scaleInteractionSync = attachScaleInteractionSync({
    isDragActive: () => dragActive,
    syncAll,
    shouldIgnorePointerDown: (target) => Boolean(
      target.closest(".fib-toolbar, .fib-trend-hit, .fib-level-hit, .fib-handle"),
    ),
  });

  function previewAtPixels(fib: FibonacciRetracement, p1: PixelPoint, p2: PixelPoint) {
    const els = elMap.get(fib.id);
    if (!els) return;
    renderFibGeometry(fib, els, p1, p2, selection.isSelected(fib.id), "pixels");
  }

  function ensureGhostElements(levelCount: number) {
    if (
      ghostGroup
      && ghostTrendLine
      && ghostLevelLines
      && ghostLevelLabels
      && ghostHandle1
      && ghostHandle2
      && ghostLevelLines.length === levelCount
    ) return;

    clearGhost();

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
    for (let i = 0; i < levelCount; i += 1) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "fib-level-line");
      lineGroup.appendChild(line);
      ghostLevelLines.push(line);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "fib-level-label");
      labelGroup.appendChild(label);
      ghostLevelLabels.push(label);
    }

    ghostHandle1 = document.createElementNS(SVG_NS, "circle");
    ghostHandle1.setAttribute("class", "fib-handle");
    ghostHandle1.setAttribute("r", String(TV_HANDLE_RADIUS));
    ghostHandle2 = document.createElementNS(SVG_NS, "circle");
    ghostHandle2.setAttribute("class", "fib-handle");
    ghostHandle2.setAttribute("r", String(TV_HANDLE_RADIUS));
    lineGroup.append(ghostHandle1, ghostHandle2);
  }

  function clearGhost() {
    svg.querySelectorAll(".fib-ghost").forEach((node) => node.remove());
    ghostGroup = null;
    ghostTrendLine = null;
    ghostLevelLines = null;
    ghostLevelLabels = null;
    ghostHandle1 = null;
    ghostHandle2 = null;
  }

  function updateGhost(p1: PixelPoint, p2: PixelPoint) {
    // Тот же last-used стиль, что и у commit — иначе превью рисует заводские уровни.
    const tpl = getNewDrawingStyle("fibonacci");
    const levelDefs = tpl.levels?.length
      ? tpl.levels.map((level) => ({ ...level }))
      : getDefaultFibLevels();
    const ghostStyle = {
      width: tpl.width ?? DEFAULT_FIB_LINE.width,
      style: tpl.style ?? DEFAULT_FIB_LINE.style,
    };
    const showLabels = tpl.showLabel !== false;
    ensureGhostElements(levelDefs.length);
    ghostTrendLine!.setAttribute("x1", String(p1.x));
    ghostTrendLine!.setAttribute("y1", String(p1.y));
    ghostTrendLine!.setAttribute("x2", String(p2.x));
    ghostTrendLine!.setAttribute("y2", String(p2.y));

    const anchors = anchorPricesFromPixels(series, p1, p2);
    if (!anchors) return;
    const { plotWidth } = getPlotLayout();
    const { xLeft, xRight } = horizontalSpan(p1, p2, plotWidth);
    const labelAnchorX = retracementLabelAnchorX(p1, p2);
    levelDefs.forEach((level, index) => {
      if (!level.enabled) {
        applyLevelLine({ line: ghostLevelLines![index] }, xLeft, xRight, 0, level.color, ghostStyle.width, ghostStyle.style, false);
        ghostLevelLabels![index].setAttribute("visibility", "hidden");
        return;
      }
      const price = levelPriceFromAnchors(anchors.p0, anchors.p100, level.ratio);
      const y = series.priceToCoordinate(price);
      if (y == null) {
        applyLevelLine({ line: ghostLevelLines![index] }, xLeft, xRight, 0, level.color, ghostStyle.width, ghostStyle.style, false);
        ghostLevelLabels![index].setAttribute("visibility", "hidden");
        return;
      }
      applyLevelLine({ line: ghostLevelLines![index] }, xLeft, xRight, y, level.color, ghostStyle.width, ghostStyle.style, true);
      if (showLabels) {
        applyLevelLabel(ghostLevelLabels![index], labelAnchorX, y, level.ratio, price, level.color, pricePrecision);
      } else {
        ghostLevelLabels![index].setAttribute("visibility", "hidden");
      }
    });
    applyTrendLineStroke(ghostTrendLine!, tpl.lineColor ?? "#787b86", ghostStyle.width);
    applyHandles(ghostHandle1!, ghostHandle2!, p1, p2, true);
  }

  function startDragHandle(id: string, which: "point1" | "point2", startEvent: PointerEvent) {
    const fib = fibonacciRetracements.find((item) => item.id === id);
    if (!fib) return;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(fib.point1);
    const originalP2 = toPixel(fib.point2);
    if (!originalP1 || !originalP2) return;

    let latestEvent: PointerEvent | null = null;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      onMove: (event) => {
        latestEvent = event;
        const dragged = clampPlotPoint({
          x: snapXToNearestCandle(chart, event.clientX - rect.left),
          y: event.clientY - rect.top,
        });
        const p1 = which === "point1" ? dragged : (toPixel(fib.point1) ?? originalP1);
        const p2 = which === "point2" ? dragged : (toPixel(fib.point2) ?? originalP2);
        previewAtPixels(fib, p1, p2);
      },
      onEnd: (_event, moved) => {
        if (!moved || !latestEvent) return;
        const clamped = clampPlotPoint({
          x: latestEvent.clientX - rect.left,
          y: latestEvent.clientY - rect.top,
        });
        const time = xToSnappedTime(chart, clamped.x, candleStore.candles);
        const price = pxToPrice(series, clamped.y);
        if (time != null && price != null && price > 0) {
          updateFib(id, which === "point1" ? { point1: { time, price } } : { point2: { time, price } });
        } else {
          syncAll();
        }
      },
    });
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
        );
      },
      onEnd: (_event, moved) => {
        if (!moved) return;
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
          updateFib(id, {
            point1: { time: newP1Time, price: newP1Price },
            point2: { time: newP2Time, price: newP2Price },
          });
        } else {
          syncAll();
        }
      },
    });
  }

  const drawingSession = createDrawingSession<{ time: number; price: number }>({
    mode: "fibonacci",
    manager,
    container,
    chart,
    pointCount: 2,
    clampCursorX: true,
    pointFromClick: (event) => drawingPointFromClick(event, { container, chart, series, candleStore, clampX: true }),
    ghostUpdate: (points, cursor) => {
      const p1 = toPixel(points[0]);
      if (!p1) return;
      updateGhost(p1, clampPlotPoint(cursor));
    },
    ghostRemove: clearGhost,
    commit: ([point1, point2]) => {
      const tpl = getNewDrawingStyle("fibonacci");
      const newFib: FibonacciRetracement = {
        id: crypto.randomUUID(),
        datasetId,
        point1,
        point2,
        showLabels: tpl.showLabel !== false,
        locked: false,
        lineWidth: tpl.width,
        lineStyle: tpl.style,
        trendColor: tpl.lineColor,
        levels: tpl.levels?.length
          ? tpl.levels.map((level) => ({ ...level }))
          : getDefaultFibLevels(),
      };
      fibonacciRetracements.push(newFib);
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
    removeSettingsPanel();
    selection.destroy();
    overlay.remove();
    toolbarController.destroy();
    removeToolbar();
  };
}
