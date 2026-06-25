/**
 * TrendLineTool – renders, draws, edits and manages trend lines on the
 * lightweight-charts SVG overlay.  Designed to be called inside the Chart
 * component's useEffect so it can access chart / series APIs directly.
 */

import type { TrendLine } from "../../types";
import { pointToPixel, snapXToNearestCandle, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { createTrendLineExtendSlots } from "./trendLineToolbarSlots";
import { createDrawingOverlay } from "../shared/overlay";
import { attachManagedDrawingLifecycle, createClipboardBridge, runManagedDragSession } from "../shared/ManagedDrawingTool";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore } from "../shared/types";
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

/* ------------------------------------------------------------------ */
/*  Coordinate conversions                                             */
/* ------------------------------------------------------------------ */

function pxToPrice(series: any, y: number): number | null {
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
  chart: any;
  series: any;
  candleStore: ChartCandleStore;
  trendLines: TrendLine[];
  drawingMode: DrawingMode;
  datasetId: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  callbacks: TrendLineCallbacks;
}): () => void {
  const { container, chart, series, candleStore, drawingMode, datasetId, callbacks, onSelect, manager } = opts;
  let trendLines = [...opts.trendLines];

  /* ---- SVG overlay ---- */
  const overlay = createDrawingOverlay(container, chart, "trend-line-overlay");
  const { svg } = overlay;

  /* ---- Selection state ---- */
  let selectedId: string | null = opts.selectedId ?? null;
  let ghostLine: SVGLineElement | null = null;
  let drawPoint1: { time: number; price: number } | null = null;
  let dragActive = false;

  /* ---- Elements per line ---- */
  interface LineEls {
    group: SVGGElement;
    line: SVGLineElement;
    extLine: SVGLineElement;
    hitArea: SVGLineElement;
    handle1: SVGCircleElement;
    handle2: SVGCircleElement;
    labelText: SVGTextElement;
  }
  const lineElements = new Map<string, LineEls>();

  /* ---- Toolbar ---- */
  let toolbarController: DrawingToolbarController<TrendLine>;
  let textEditor: HTMLDivElement | null = null;

  function removeToolbar() {
    textEditor?.remove();
    textEditor = null;
    toolbarController.hide();
  }

  function openTrendLineTextEditor(tl: TrendLine, anchor: HTMLElement) {
    textEditor?.remove();
    textEditor = document.createElement("div");
    textEditor.className = "trend-text-editor";
    textEditor.innerHTML = `<input type="text" placeholder="Текст" value="${tl.label.replaceAll('"', "&quot;")}"><button title="Убрать текст">×</button>`;
    container.appendChild(textEditor);
    const input = textEditor.querySelector("input")!;
    const bounds = anchor.getBoundingClientRect();
    const host = container.getBoundingClientRect();
    textEditor.style.left = `${bounds.left - host.left}px`;
    textEditor.style.top = `${bounds.bottom - host.top + 6}px`;
    const preview = () => {
      const line = trendLines.find((item) => item.id === tl.id);
      if (!line) return;
      line.label = input.value;
      line.showLabel = Boolean(input.value.trim());
      syncOne(line);
    };
    const commit = () => {
      const line = trendLines.find((item) => item.id === tl.id);
      if (line) callbacks.onUpdate(line);
    };
    input.addEventListener("input", preview);
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (key) => {
      if (key.key === "Enter") { commit(); textEditor?.remove(); textEditor = null; }
      if (key.key === "Escape") { textEditor?.remove(); textEditor = null; }
    });
    textEditor.querySelector("button")!.addEventListener("click", () => {
      input.value = "";
      preview();
      commit();
      textEditor?.remove();
      textEditor = null;
    });
    textEditor.addEventListener("pointerdown", (pointer) => pointer.stopPropagation());
    input.focus();
    input.select();
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
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("trendline");
    }
    callbacks.onDelete(id);
  }

  function purgeAllLines() {
    for (const els of lineElements.values()) {
      els.group.remove();
    }
    lineElements.clear();
    trendLines = [];
    if (selectedId !== null) {
      selectedId = null;
      onSelect?.(null);
      removeToolbar();
    }
    manager.clearSelection("trendline");
    syncAll();
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "full",
    className: "trend-toolbar",
    persistenceKey: (tl) => `trend-line:${tl.id}`,
    getState: (tl) => ({
      lineColor: tl.color,
      textColor: tl.color,
      width: tl.width,
      style: tl.lineStyle,
      locked: Boolean(tl.locked),
    }),
    onPatch: (tl, patch) => {
      updateLine(tl.id, {
        ...(patch.lineColor != null ? { color: patch.lineColor } : {}),
        ...(patch.width != null ? { width: patch.width } : {}),
        ...(patch.style ? { lineStyle: patch.style } : {}),
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
    onTextButtonClick: (tl, anchor) => openTrendLineTextEditor(tl, anchor),
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "trendline",
    bridge: createClipboardBridge({
      kind: "trendline",
      datasetId,
      candleStore,
      getSelectedId: () => selectedId,
      findById: (id) => trendLines.find((item) => item.id === id),
      append: (line) => { trendLines.push(line); },
      onCreate: callbacks.onCreate,
      select: (id) => selectLine(id),
      deleteSelected: () => { if (selectedId) deleteLine(selectedId); },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      cancelDrawing: () => {
        if (!drawPoint1) return false;
        drawPoint1 = null;
        if (ghostLine) { ghostLine.remove(); ghostLine = null; }
        callbacks.onDrawingComplete();
        return true;
      },
    }),
    syncAll,
    isDragActive: () => dragActive,
    onDeselect: () => {
      if (selectedId === null) return;
      selectedId = null;
      onSelect?.(null);
      removeToolbar();
      syncAll();
    },
    purgeAll: purgeAllLines,
  });

  function selectLine(id: string | null) {
    if (!id) {
      if (selectedId !== null) {
        selectedId = null;
        onSelect?.(null);
        removeToolbar();
        syncAll();
      }
      manager.clearSelection("trendline");
      return;
    }
    selectedId = id;
    onSelect?.(id);
    const tl = trendLines.find((l) => l.id === id);
    if (tl) createToolbar(tl);
    manager.activateSelection("trendline", lineElements.get(id)?.group ?? null, id);
    syncAll();
  }

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

    const labelText = document.createElementNS(SVG_NS, "text");
    labelText.setAttribute("class", "trend-label");

    group.append(extLine, line, hitArea, handle1, handle2, labelText);

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

    return { group, line, extLine, hitArea, handle1, handle2, labelText };
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

    const isSelected = selectedId === tl.id;

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
    if (tl.showLabel && tl.label) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
      if (angle > 90 || angle < -90) angle += 180;
      els.labelText.setAttribute("x", String(mx));
      els.labelText.setAttribute("y", String(my - 8));
      els.labelText.setAttribute("transform", `rotate(${angle} ${mx} ${my})`);
      els.labelText.setAttribute("fill", tl.color);
      els.labelText.textContent = tl.label;
      els.labelText.setAttribute("visibility", "visible");
    } else {
      els.labelText.removeAttribute("transform");
      els.labelText.setAttribute("visibility", "hidden");
    }

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
    if (tl.showLabel && tl.label) {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
      if (angle > 90 || angle < -90) angle += 180;
      els.labelText.setAttribute("x", String(mx));
      els.labelText.setAttribute("y", String(my - 8));
      els.labelText.setAttribute("transform", `rotate(${angle} ${mx} ${my})`);
    }
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
        const lineObj = trendLines.find((l) => l.id === id);
        if (!lineObj || !moved || !latestEvent) return;
        const x = latestEvent.clientX - rect.left;
        const y = latestEvent.clientY - rect.top;
        const time = xToSnappedTime(chart, x, candleStore.candles);
        const price = pxToPrice(series, y);
        if (time != null && price != null && price > 0) lineObj[which] = { time, price };
        syncAll();
        callbacks.onUpdate(lineObj);
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
        const lineObj = trendLines.find((l) => l.id === id);
        if (!lineObj || !moved) return;
        const newP1Time = xToSnappedTime(chart, p1Px.x + finalDx, candleStore.candles);
        const newP1Price = pxToPrice(series, p1Px.y + finalDy);
        const newP2Time = xToSnappedTime(chart, p2Px.x + finalDx, candleStore.candles);
        const newP2Price = pxToPrice(series, p2Px.y + finalDy);
        if (newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null && newP1Price > 0 && newP2Price > 0) {
          lineObj.point1 = { time: newP1Time, price: newP1Price };
          lineObj.point2 = { time: newP2Time, price: newP2Price };
        }
        syncAll();
        callbacks.onUpdate(lineObj);
      },
    });
  }

  /* ---- Drawing mode ---- */

  function handleDrawClick(event: any) {
    if (drawingMode !== "trendline") return;
    const rect = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    const x = sourceEvent ? sourceEvent.clientX - rect.left : null;
    const y = sourceEvent ? sourceEvent.clientY - rect.top : null;
    const time = x != null ? xToSnappedTime(chart, x, candleStore.candles) : (event.time as number | undefined);
    const price = y != null ? pxToPrice(series, y) : (event.seriesData?.get(series)?.close as number | undefined);
    if (time == null || price == null || price <= 0) return;

    if (!drawPoint1) {
      drawPoint1 = { time, price };
      // Create ghost line
      ghostLine = document.createElementNS(SVG_NS, "line");
      ghostLine.setAttribute("class", "trend-ghost-line");
      svg.appendChild(ghostLine);
      const px = toPixel(drawPoint1);
      if (px) {
        ghostLine.setAttribute("x1", String(px.x));
        ghostLine.setAttribute("y1", String(px.y));
        ghostLine.setAttribute("x2", String(px.x));
        ghostLine.setAttribute("y2", String(px.y));
      }
    } else {
      // Second click – create line
      const newLine: TrendLine = {
        id: crypto.randomUUID(),
        datasetId,
        point1: drawPoint1,
        point2: { time, price },
        color: "#ff4976",
        width: 2,
        lineStyle: "solid",
        extendLeft: false,
        extendRight: false,
        showLabel: false,
        label: "",
        locked: false,
      };
      trendLines.push(newLine);
      callbacks.onCreate(newLine);
      drawPoint1 = null;
      if (ghostLine) { ghostLine.remove(); ghostLine = null; }
      // Select the new line and show toolbar
      selectLine(newLine.id);
      syncAll();
      callbacks.onDrawingComplete();
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (!ghostLine || !drawPoint1) return;
    const rect = container.getBoundingClientRect();
    const x = snapXToNearestCandle(chart, event.clientX - rect.left);
    const y = event.clientY - rect.top;
    ghostLine.setAttribute("x2", String(x));
    ghostLine.setAttribute("y2", String(y));
    // Update start pos too in case chart scrolled
    const px = toPixel(drawPoint1);
    if (px) {
      ghostLine.setAttribute("x1", String(px.x));
      ghostLine.setAttribute("y1", String(px.y));
    }
  }

  /* ---- Deselect on background click ---- */
  function handleBackgroundClick(event: PointerEvent) {
    if (drawingMode !== "none") return;
    const target = event.target as Element;
    if (target.closest(".trend-toolbar") || target.closest(".trend-hit-area") || target.closest(".rect-handle-el")) return;
    if (selectedId) {
      selectLine(null);
    }
  }

  /* ---- Attach events ---- */
  if (drawingMode === "trendline") {
    chart.subscribeClick(handleDrawClick);
  }
  container.addEventListener("mousemove", handleMouseMove);
  container.addEventListener("pointerdown", handleBackgroundClick);

  /* ---- Cleanup ---- */
  return () => {
    unregisterLifecycle();
    try { chart.unsubscribeClick(handleDrawClick); } catch { }
    container.removeEventListener("mousemove", handleMouseMove);
    container.removeEventListener("pointerdown", handleBackgroundClick);
    overlay.remove();
    toolbarController.destroy();
    removeToolbar();
    if (ghostLine) ghostLine.remove();
  };
}
