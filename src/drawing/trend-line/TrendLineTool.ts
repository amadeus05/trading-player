/**
 * TrendLineTool – renders, draws, edits and manages trend lines on the
 * lightweight-charts SVG overlay.  Designed to be called inside the Chart
 * component's useEffect so it can access chart / series APIs directly.
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { TrendLine } from "../../types";
import { pointToPixel, snapXToNearestCandle, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { getDefaultDrawingTemplateState } from "../shared/drawingTemplates";
import { lineLabelLayout } from "../shared/lineLabelLayout";
import { createTrendLineExtendSlots } from "./trendLineToolbarSlots";
import { createDrawingOverlay } from "../shared/overlay";
import { attachManagedDrawingLifecycle, createClipboardBridge, runManagedDragSession } from "../shared/ManagedDrawingTool";
import { createDrawingSession, drawingPointFromClick } from "../shared/drawingSession";
import { createEditableLabelStore } from "../shared/editableLabel";
import { createSelectionController } from "../shared/selection";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore, SeriesApiLike } from "../shared/types";
export type { DrawingMode } from "../shared/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TrendLineCallbacks = DrawingCrudCallbacks<TrendLine>;

interface PixelPoint {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function strokeDashForStyle(style: TrendLine["lineStyle"]): string {
  if (style === "dashed") return "8 4";
  if (style === "dotted") return "2 4";
  return "";
}

function trendLineTextColor(tl: TrendLine): string {
  return tl.textColor ?? tl.color;
}

/* ------------------------------------------------------------------ */
/*  Coordinate conversions                                             */
/* ------------------------------------------------------------------ */

function pxToPrice(series: SeriesApiLike, y: number): number | null {
  return series.coordinateToPrice(y);
}

/* ------------------------------------------------------------------ */
/*  Main attach function                                               */
/* ------------------------------------------------------------------ */

/**
 * Call once inside the Chart useEffect.  Returns a cleanup function.
 */
export function attachTrendLineTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  trendLines: TrendLine[];
  drawingMode: DrawingMode;
  datasetId: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  callbacks: TrendLineCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, callbacks, onSelect, manager } = opts;
  let trendLines = [...opts.trendLines];

  /* ---- SVG overlay ---- */
  const overlay = createDrawingOverlay(container, chart, "trend-line-overlay");
  const { svg } = overlay;

  /* ---- Selection state ---- */
  let ghostLine: SVGLineElement | null = null;
  let dragActive = false;

  /* ---- Elements per line ---- */
  interface LineEls {
    group: SVGGElement;
    line: SVGLineElement;
    extLine: SVGLineElement;
    hitArea: SVGLineElement;
    handle1: SVGCircleElement;
    handle2: SVGCircleElement;
  }
  const lineElements = new Map<string, LineEls>();

  /* ---- Toolbar ---- */
  let toolbarController: DrawingToolbarController<TrendLine>;

  const selection = createSelectionController<TrendLine>({
    kind: "trendline",
    manager,
    container,
    findById: (id) => trendLines.find((item) => item.id === id),
    getSelectionElement: (id) => lineElements.get(id)?.group ?? null,
    onShow: (tl) => createToolbar(tl),
    onHide: () => removeToolbar(),
    onChange: (id) => onSelect?.(id),
    syncAll,
    ignoreSelector: ".trend-hit-area, .rect-handle-el, .trend-line-label",
    initialSelectedId: opts.selectedId ?? null,
  });
  const selectLine = selection.select;

  const labelStore = createEditableLabelStore({
    container,
    className: "trend-line-label",
    canEdit: (id) => {
      if (!manager.canEditExistingDrawings()) return false;
      const line = trendLines.find((item) => item.id === id);
      return Boolean(line && !line.locked);
    },
    getText: (id) => trendLines.find((item) => item.id === id)?.label ?? "",
    getTextColor: (id) => {
      const line = trendLines.find((item) => item.id === id);
      return line ? trendLineTextColor(line) : "#d1d4dc";
    },
    onBeforeEdit: (id) => {
      if (!selection.isSelected(id)) selectLine(id);
    },
    onCommit: (id, value) => {
      updateLine(id, { label: value, showLabel: Boolean(value) });
    },
    onCancel: (id) => {
      const line = trendLines.find((item) => item.id === id);
      if (line) syncOne(line);
    },
    emptyCaretAtEnd: true,
  });

  function applyLabelPosition(el: HTMLElement, p1: PixelPoint, p2: PixelPoint) {
    const layout = lineLabelLayout(p1, p2);
    el.style.left = `${layout.x}px`;
    el.style.top = `${layout.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${layout.angle}deg)`;
  }

  function removeToolbar() {
    labelStore.commitActive();
    toolbarController.hide();
  }

  function createToolbar(tl: TrendLine) {
    toolbarController.show(tl);
  }

  /* ---- Helpers ---- */

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candleStore.candles);
  }

  function extendedPoints(tl: TrendLine, p1: PixelPoint, p2: PixelPoint): { ep1: PixelPoint; ep2: PixelPoint } {
    const rect = container.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    let ep1 = { ...p1 }, ep2 = { ...p2 };

    if (tl.extendLeft && (dx !== 0 || dy !== 0)) {
      // extend p1 backwards to edge
      const tVals: number[] = [];
      if (dx !== 0) { tVals.push(-p1.x / dx); tVals.push((w - p1.x) / dx); }
      if (dy !== 0) { tVals.push(-p1.y / dy); tVals.push((h - p1.y) / dy); }
      const negT = tVals.filter((t) => t < 0);
      if (negT.length) {
        const t = Math.max(...negT);
        ep1 = { x: p1.x + t * dx, y: p1.y + t * dy };
      }
    }

    if (tl.extendRight && (dx !== 0 || dy !== 0)) {
      const tVals: number[] = [];
      if (dx !== 0) { tVals.push(-p1.x / dx); tVals.push((w - p1.x) / dx); }
      if (dy !== 0) { tVals.push(-p1.y / dy); tVals.push((h - p1.y) / dy); }
      // t for p2 is 1, we want t > 1
      const posT = tVals.filter((t) => t > 1);
      if (posT.length) {
        const t = Math.min(...posT);
        ep2 = { x: p1.x + t * dx, y: p1.y + t * dy };
      }
    }
    return { ep1, ep2 };
  }

  /* ---- CRUD ---- */

  function updateLine(id: string, patch: Partial<TrendLine>) {
    const idx = trendLines.findIndex((l) => l.id === id);
    if (idx < 0) return;
    trendLines[idx] = { ...trendLines[idx], ...patch };
    callbacks.onUpdate(trendLines[idx]);
    syncAll();
  }

  function deleteLine(id: string) {
    trendLines = trendLines.filter((l) => l.id !== id);
    const els = lineElements.get(id);
    if (els) { els.group.remove(); lineElements.delete(id); }
    labelStore.remove(id);
    selection.handleDeleted(id);
    callbacks.onDelete(id);
  }

  function purgeAllLines() {
    for (const els of lineElements.values()) {
      els.group.remove();
    }
    lineElements.clear();
    labelStore.destroy();
    trendLines = [];
    selection.reset();
    syncAll();
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "full",
    className: "trend-toolbar",
    templateKind: "trendline",
    persistenceKey: (tl) => `trend-line:${tl.id}`,
    getState: (tl) => ({
      lineColor: tl.color,
      textColor: trendLineTextColor(tl),
      text: tl.label,
      showLabel: tl.showLabel,
      width: tl.width,
      style: tl.lineStyle,
      locked: Boolean(tl.locked),
    }),
    onPatch: (tl, patch) => {
      updateLine(tl.id, {
        ...(patch.lineColor != null ? { color: patch.lineColor } : {}),
        ...(patch.textColor != null ? { textColor: patch.textColor } : {}),
        ...(patch.width != null ? { width: patch.width } : {}),
        ...(patch.style ? { lineStyle: patch.style } : {}),
        ...(patch.text != null ? { label: patch.text, showLabel: patch.showLabel ?? Boolean(patch.text.trim()) } : {}),
        ...(patch.showLabel != null && patch.text == null ? { showLabel: patch.showLabel } : {}),
        ...(patch.locked != null ? { locked: patch.locked } : {}),
      });
    },
    onDelete: (tl) => deleteLine(tl.id),
    onSync: () => syncAll(),
    slots: createTrendLineExtendSlots(
      (drawing) => trendLines.find((item) => item.id === drawing.id),
      (drawing, direction, enabled) => {
        updateLine(drawing.id, direction === "left" ? { extendLeft: enabled } : { extendRight: enabled });
      },
    ),
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "trendline",
    bridge: createClipboardBridge({
      kind: "trendline",
      datasetId,
      candleStore,
      getSelectedId: () => selection.getSelectedId(),
      findById: (id) => trendLines.find((item) => item.id === id),
      append: (line) => { trendLines.push(line); },
      onCreate: callbacks.onCreate,
      select: (id) => selectLine(id),
      deleteSelected: () => {
        const id = selection.getSelectedId();
        if (id) deleteLine(id);
      },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      syncAll,
      cancelDrawing: (silent?: boolean) => drawingSession.cancel(silent),
    }),
    syncAll,
    isDragActive: () => dragActive,
    onDeselect: () => selection.handleManagerDeselect(),
    purgeAll: purgeAllLines,
  });

  /* ---- Build SVG elements for one line ---- */

  function buildLineEls(tl: TrendLine): LineEls {
    const group = overlay.createClippedGroup();
    group.dataset.trendId = tl.id;

    const extLine = document.createElementNS(SVG_NS, "line");
    extLine.setAttribute("class", "trend-ext-line");

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "trend-main-line");

    const hitArea = document.createElementNS(SVG_NS, "line");
    hitArea.setAttribute("class", "trend-hit-area");

    const handle1 = document.createElementNS(SVG_NS, "circle");
    handle1.setAttribute("class", "rect-handle-el");
    handle1.setAttribute("r", "5");
    handle1.style.cursor = "grab";

    const handle2 = document.createElementNS(SVG_NS, "circle");
    handle2.setAttribute("class", "rect-handle-el");
    handle2.setAttribute("r", "5");
    handle2.style.cursor = "grab";

    group.append(extLine, line, hitArea, handle1, handle2);

    // Interaction: select on click
    hitArea.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      const current = trendLines.find((item) => item.id === tl.id);
      if (current?.locked) return;
      startDragBody(tl.id, e);
    });

    handle1.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      const current = trendLines.find((item) => item.id === tl.id);
      if (current?.locked) return;
      startDragHandle(tl.id, "point1", e);
    });

    handle2.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      const current = trendLines.find((item) => item.id === tl.id);
      if (current?.locked) return;
      startDragHandle(tl.id, "point2", e);
    });

    return { group, line, extLine, hitArea, handle1, handle2 };
  }

  function syncLabelOverlay(tl: TrendLine, p1: PixelPoint, p2: PixelPoint, isSelected: boolean) {
    const el = labelStore.ensure(tl.id);
    applyLabelPosition(el, p1, p2);
    const state = labelStore.syncContent(tl.id, isSelected);
    if (state === "editing") return;
    el.style.display = state === "hidden" ? "none" : "";
  }

  /* ---- Sync visual positions ---- */

  function syncOne(tl: TrendLine) {
    let els = lineElements.get(tl.id);
    if (!els) {
      els = buildLineEls(tl);
      lineElements.set(tl.id, els);
    }

    const p1 = toPixel(tl.point1);
    const p2 = toPixel(tl.point2);

    if (!p1 || !p2) {
      els.group.setAttribute("visibility", "hidden");
      return;
    }
    els.group.setAttribute("visibility", "visible");

    const isSelected = selection.isSelected(tl.id);

    // Main line
    els.line.setAttribute("x1", String(p1.x));
    els.line.setAttribute("y1", String(p1.y));
    els.line.setAttribute("x2", String(p2.x));
    els.line.setAttribute("y2", String(p2.y));
    els.line.setAttribute("stroke", tl.color);
    els.line.setAttribute("stroke-width", String(tl.width));
    els.line.setAttribute("stroke-dasharray", strokeDashForStyle(tl.lineStyle));

    // Extended line
    if (tl.extendLeft || tl.extendRight) {
      const { ep1, ep2 } = extendedPoints(tl, p1, p2);
      els.extLine.setAttribute("x1", String(ep1.x));
      els.extLine.setAttribute("y1", String(ep1.y));
      els.extLine.setAttribute("x2", String(ep2.x));
      els.extLine.setAttribute("y2", String(ep2.y));
      els.extLine.setAttribute("stroke", tl.color);
      els.extLine.setAttribute("stroke-width", String(tl.width));
      els.extLine.setAttribute("stroke-dasharray", strokeDashForStyle(tl.lineStyle));
      els.extLine.setAttribute("stroke-opacity", "0.4");
      els.extLine.setAttribute("visibility", "visible");
    } else {
      els.extLine.setAttribute("visibility", "hidden");
    }

    // Hit area (invisible thick line for easy clicking)
    els.hitArea.setAttribute("x1", String(p1.x));
    els.hitArea.setAttribute("y1", String(p1.y));
    els.hitArea.setAttribute("x2", String(p2.x));
    els.hitArea.setAttribute("y2", String(p2.y));

    // Handles
    els.handle1.setAttribute("cx", String(p1.x));
    els.handle1.setAttribute("cy", String(p1.y));
    els.handle1.style.display = isSelected && !tl.locked ? "" : "none";

    els.handle2.setAttribute("cx", String(p2.x));
    els.handle2.setAttribute("cy", String(p2.y));
    els.handle2.style.display = isSelected && !tl.locked ? "" : "none";

    // Label
    syncLabelOverlay(tl, p1, p2, isSelected);

    // Selection glow
    els.group.classList.toggle("selected", isSelected);
  }

  function syncAll() {
    overlay.sync();
    trendLines.forEach(syncOne);
  }

  function previewAtPixels(tl: TrendLine, p1: PixelPoint, p2: PixelPoint) {
    const els = lineElements.get(tl.id);
    if (!els) return;
    for (const element of [els.line, els.hitArea]) {
      element.setAttribute("x1", String(p1.x)); element.setAttribute("y1", String(p1.y));
      element.setAttribute("x2", String(p2.x)); element.setAttribute("y2", String(p2.y));
    }
    els.handle1.setAttribute("cx", String(p1.x)); els.handle1.setAttribute("cy", String(p1.y));
    els.handle2.setAttribute("cx", String(p2.x)); els.handle2.setAttribute("cy", String(p2.y));
    if (tl.extendLeft || tl.extendRight) {
      const { ep1, ep2 } = extendedPoints(tl, p1, p2);
      els.extLine.setAttribute("x1", String(ep1.x)); els.extLine.setAttribute("y1", String(ep1.y));
      els.extLine.setAttribute("x2", String(ep2.x)); els.extLine.setAttribute("y2", String(ep2.y));
    }
    syncLabelOverlay(tl, p1, p2, selection.isSelected(tl.id));
  }

  /* ---- Drag handlers ---- */

  function startDragHandle(id: string, which: "point1" | "point2", startEvent: PointerEvent) {
    const tl = trendLines.find((l) => l.id === id);
    if (!tl) return;

    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(tl.point1);
    const originalP2 = toPixel(tl.point2);
    if (!originalP1 || !originalP2) return;

    let latestEvent: PointerEvent | null = null;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      onMove: (event) => {
        latestEvent = event;
        const x = snapXToNearestCandle(chart, event.clientX - rect.left);
        const y = event.clientY - rect.top;
        previewAtPixels(tl, which === "point1" ? { x, y } : originalP1, which === "point2" ? { x, y } : originalP2);
      },
      onEnd: (_event, moved) => {
        if (!moved || !latestEvent) return;
        const x = latestEvent.clientX - rect.left;
        const y = latestEvent.clientY - rect.top;
        const time = xToSnappedTime(chart, x, candleStore.candles);
        const price = pxToPrice(series, y);
        if (time != null && price != null && price > 0) {
          updateLine(id, which === "point1" ? { point1: { time, price } } : { point2: { time, price } });
        } else {
          syncAll();
        }
      },
    });
  }

  function startDragBody(id: string, startEvent: PointerEvent) {
    const tl = trendLines.find((l) => l.id === id);
    if (!tl) return;

    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...tl.point1 };
    const origP2 = { ...tl.point2 };
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
          tl,
          { x: p1Px.x + finalDx, y: p1Px.y + finalDy },
          { x: p2Px.x + finalDx, y: p2Px.y + finalDy },
        );
      },
      onEnd: (_event, moved) => {
        if (!moved) return;
        const newP1Time = xToSnappedTime(chart, p1Px.x + finalDx, candleStore.candles);
        const newP1Price = pxToPrice(series, p1Px.y + finalDy);
        const newP2Time = xToSnappedTime(chart, p2Px.x + finalDx, candleStore.candles);
        const newP2Price = pxToPrice(series, p2Px.y + finalDy);
        if (newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null && newP1Price > 0 && newP2Price > 0) {
          updateLine(id, {
            point1: { time: newP1Time, price: newP1Price },
            point2: { time: newP2Time, price: newP2Price },
          });
        } else {
          syncAll();
        }
      },
    });
  }

  /* ---- Drawing mode ---- */

  const drawingSession = createDrawingSession<{ time: number; price: number }>({
    mode: "trendline",
    manager,
    container,
    chart,
    pointCount: 2,
    pointFromClick: (event) => drawingPointFromClick(event, { container, chart, series, candleStore }),
    ghostUpdate: (points, cursor) => {
      if (!ghostLine) {
        ghostLine = document.createElementNS(SVG_NS, "line");
        ghostLine.setAttribute("class", "trend-ghost-line");
        svg.appendChild(ghostLine);
      }
      const p1 = toPixel(points[0]) ?? cursor;
      ghostLine.setAttribute("x1", String(p1.x));
      ghostLine.setAttribute("y1", String(p1.y));
      ghostLine.setAttribute("x2", String(cursor.x));
      ghostLine.setAttribute("y2", String(cursor.y));
    },
    ghostRemove: () => {
      ghostLine?.remove();
      ghostLine = null;
    },
    commit: ([point1, point2]) => {
      const tpl = getDefaultDrawingTemplateState("trendline");
      const newLine: TrendLine = {
        id: crypto.randomUUID(),
        datasetId,
        point1,
        point2,
        color: tpl.lineColor,
        textColor: tpl.textColor ?? tpl.lineColor,
        width: tpl.width,
        lineStyle: tpl.style,
        extendLeft: false,
        extendRight: false,
        showLabel: false,
        label: "",
        locked: false,
      };
      trendLines.push(newLine);
      callbacks.onCreate(newLine);
      selectLine(newLine.id);
      syncAll();
    },
    onComplete: () => callbacks.onDrawingComplete(),
  });

  /* ---- Cleanup ---- */
  return () => {
    unregisterLifecycle();
    drawingSession.destroy();
    selection.destroy();
    overlay.remove();
    labelStore.destroy();
    toolbarController.destroy();
    removeToolbar();
    if (ghostLine) ghostLine.remove();
  };
}
