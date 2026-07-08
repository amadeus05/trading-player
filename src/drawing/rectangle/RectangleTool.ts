/**
 * RectangleTool – рисует, выделяет и редактирует прямоугольники на оверлее графика.
 */

import type { Rectangle } from "../../types";
import { pointToPixel, snapXToNearestCandle, timeToX, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { getDefaultDrawingTemplateState } from "../shared/drawingTemplates";
import { attachManagedDrawingLifecycle, createClipboardBridge, getPlotWidth, runManagedDragSession } from "../shared/ManagedDrawingTool";
import { createDrawingOverlay } from "../shared/overlay";
import { forgetFloatingPanelPosition } from "../shared/floatingPanel";
import { bindDrawingPointerClick, type DrawingPointerClickEvent } from "../shared/drawingPointerClick";
import { createEditableLabelStore } from "../shared/editableLabel";
import { hexToRgba } from "../shared/colorUtils";
import type { DrawingCrudCallbacks, ManagedDrawingToolOptions, ChartCandleStore } from "../shared/types";

export type RectangleCallbacks = DrawingCrudCallbacks<Rectangle>;

const SVG_NS = "http://www.w3.org/2000/svg";

type HandlePos = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";
const HANDLE_POSITIONS: HandlePos[] = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];

const HANDLE_CURSORS: Record<HandlePos, string> = {
  tl: "nwse-resize", tc: "ns-resize", tr: "nesw-resize",
  ml: "ew-resize", mr: "ew-resize",
  bl: "nesw-resize", bc: "ns-resize", br: "nwse-resize",
};

function rectTextColor(rect: Rectangle): string {
  return rect.textColor ?? "#2962ff";
}

function strokeDash(style: Rectangle["borderStyle"]): string {
  if (style === "dashed") return "8 4";
  if (style === "dotted") return "2 4";
  return "";
}

interface PixelBounds { x: number; y: number; w: number; h: number; }

function getBounds(rect: Rectangle, chart: any, series: any, candles: { time: number }[]): PixelBounds | null {
  const xL = timeToX(chart, rect.timeLeft, candles);
  const xR = timeToX(chart, rect.timeRight, candles);
  const yT = series.priceToCoordinate(rect.priceTop);
  const yB = series.priceToCoordinate(rect.priceBottom);
  if (xL == null || xR == null || yT == null || yB == null) return null;
  return {
    x: Math.min(xL, xR),
    y: Math.min(yT, yB),
    w: Math.abs(xR - xL),
    h: Math.abs(yB - yT),
  };
}

function getHandleCoords(b: PixelBounds): [number, number][] {
  const { x, y, w, h } = b;
  return [
    [x, y], [x + w / 2, y], [x + w, y],
    [x, y + h / 2], [x + w, y + h / 2],
    [x, y + h], [x + w / 2, y + h], [x + w, y + h],
  ];
}

function calcResizedBounds(orig: PixelBounds, pos: HandlePos, mx: number, my: number): PixelBounds {
  const { x, y, w, h } = orig;
  const x2 = x + w, y2 = y + h;
  switch (pos) {
    case "tl": return { x: Math.min(mx, x2), y: Math.min(my, y2), w: Math.abs(x2 - mx), h: Math.abs(y2 - my) };
    case "tc": return { x, y: Math.min(my, y2), w, h: Math.abs(y2 - my) };
    case "tr": return { x: Math.min(x, mx), y: Math.min(my, y2), w: Math.abs(mx - x), h: Math.abs(y2 - my) };
    case "ml": return { x: Math.min(mx, x2), y, w: Math.abs(x2 - mx), h };
    case "mr": return { x: Math.min(x, mx), y, w: Math.abs(mx - x), h };
    case "bl": return { x: Math.min(mx, x2), y: Math.min(y, my), w: Math.abs(x2 - mx), h: Math.abs(my - y) };
    case "bc": return { x, y: Math.min(y, my), w, h: Math.abs(my - y) };
    case "br": return { x: Math.min(x, mx), y: Math.min(y, my), w: Math.abs(mx - x), h: Math.abs(my - y) };
  }
}

export function attachRectangleTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: any;
  series: any;
  candleStore: ChartCandleStore;
  rectangles: Rectangle[];
  drawingMode: string;
  datasetId: string;
  callbacks: RectangleCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, callbacks, manager } = opts;
  let rectangles = [...opts.rectangles];

  const getPlotWidthLocal = () => getPlotWidth(chart);
  const clampHorizontalBounds = (bounds: PixelBounds): PixelBounds => {
    const plotWidth = getPlotWidthLocal();
    const left = Math.max(0, Math.min(bounds.x, plotWidth));
    const right = Math.max(left, Math.min(bounds.x + bounds.w, plotWidth));
    return { ...bounds, x: left, w: right - left };
  };
  const overlay = createDrawingOverlay(container, chart, "rect-overlay");
  const { svg } = overlay;

  let selectedId: string | null = null;
  let toolbarController: DrawingToolbarController<Rectangle>;
  let dragActive = false;

  let drawPoint1: { time: number; price: number } | null = null;
  interface GhostEls {
    group: SVGGElement;
    fill: SVGRectElement;
    border: SVGRectElement;
    handles: SVGCircleElement[];
  }
  let ghostEls: GhostEls | null = null;
  let lastGhostPointer: { x: number; y: number } | null = null;

  interface RectEls {
    group: SVGGElement;
    fill: SVGRectElement;
    border: SVGRectElement;
    hit: SVGRectElement;
    text: SVGTextElement;
    handles: SVGCircleElement[];
  }
  const elMap = new Map<string, RectEls>();

  const labelStore = createEditableLabelStore({
    container,
    className: "rectangle-label",
    canEdit: (id) => {
      if (!manager.canEditExistingDrawings()) return false;
      const rect = rectangles.find((item) => item.id === id);
      return Boolean(rect && !rect.locked);
    },
    getText: (id) => rectangles.find((item) => item.id === id)?.text ?? "",
    getTextColor: (id) => {
      const rect = rectangles.find((item) => item.id === id);
      return rect ? rectTextColor(rect) : "#d1d4dc";
    },
    onBeforeEdit: (id) => {
      if (selectedId !== id) selectRect(id);
      const rect = rectangles.find((item) => item.id === id);
      if (rect) syncOne(rect);
    },
    onCommit: (id, value) => {
      const rect = rectangles.find((item) => item.id === id);
      if (!rect) return;
      rect.text = value;
      callbacks.onUpdate(rect);
      syncOne(rect);
    },
    onCancel: (id) => {
      const rect = rectangles.find((item) => item.id === id);
      if (rect) syncOne(rect);
    },
    emptyCaretAtEnd: false,
  });

  function removeToolbar() {
    labelStore.commitActive();
    toolbarController.hide();
  }

  function createToolbar(rect: Rectangle) {
    toolbarController.show(rect);
  }

  function patchRect(rect: Rectangle, patch: Partial<Rectangle>) {
    const idx = rectangles.findIndex((item) => item.id === rect.id);
    if (idx < 0) return;
    rectangles[idx] = { ...rectangles[idx], ...patch };
    callbacks.onUpdate(rectangles[idx]);
    syncAll();
  }

  function visibleBoundsCenter(rect: Rectangle) {
    const bounds = getBounds(rect, chart, series, candleStore.candles);
    if (!bounds) return { x: 0, y: 0 };
    const visibleBounds = clampHorizontalBounds(bounds);
    return {
      x: visibleBounds.x + visibleBounds.w / 2,
      y: visibleBounds.y + visibleBounds.h / 2,
    };
  }

  function buildEls(rect: Rectangle): RectEls {
    const group = overlay.createClippedGroup();
    group.dataset.rectId = rect.id;

    const fill = document.createElementNS(SVG_NS, "rect");
    fill.setAttribute("pointer-events", "none");

    const border = document.createElementNS(SVG_NS, "rect");
    border.setAttribute("fill", "none");
    border.setAttribute("pointer-events", "none");

    const hit = document.createElementNS(SVG_NS, "rect");
    hit.setAttribute("class", "rect-hit-el");
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("stroke", "none");

    const text = document.createElementNS(SVG_NS, "text");
    text.style.display = "none";

    const handles: SVGCircleElement[] = HANDLE_POSITIONS.map((pos) => {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("class", "rect-handle-el");
      c.setAttribute("r", "5");
      c.dataset.pos = pos;
      c.style.cursor = HANDLE_CURSORS[pos];
      c.style.display = "none";
      return c;
    });

    group.append(fill, border, hit, text, ...handles);

    hit.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation(); e.preventDefault();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      selectRect(rect.id);
      if (r.locked) return;
      startBodyDrag(rect.id, e);
    });
    hit.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      labelStore.startEdit(rect.id);
    });
    handles.forEach((h, i) => {
      h.addEventListener("pointerdown", (e) => {
        if (!manager.canEditExistingDrawings()) return;
        e.stopPropagation(); e.preventDefault();
        const r = rectangles.find((item) => item.id === rect.id);
        if (!r || r.locked) return;
        selectRect(rect.id);
        startHandleDrag(rect.id, HANDLE_POSITIONS[i], e);
      });
    });

    return { group, fill, border, hit, text, handles };
  }

  function deleteRect(id: string) {
    rectangles = rectangles.filter((r) => r.id !== id);
    forgetFloatingPanelPosition(`rectangle:${id}`);
    const els = elMap.get(id);
    if (els) { els.group.remove(); elMap.delete(id); }
    labelStore.remove(id);
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("rectangle");
    }
    callbacks.onDelete(id);
  }

  function purgeAllRects() {
    for (const [id, els] of elMap) {
      forgetFloatingPanelPosition(`rectangle:${id}`);
      els.group.remove();
    }
    elMap.clear();
    labelStore.destroy();
    rectangles = [];
    if (selectedId !== null) {
      selectedId = null;
      removeToolbar();
    }
    manager.clearSelection("rectangle");
    syncAll();
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "full",
    className: "rect-toolbar",
    templateKind: "rectangle",
    persistenceKey: (rect) => `rectangle:${rect.id}`,
    getState: (rect) => ({
      lineColor: rect.borderColor,
      fillColor: rect.fillColor,
      fillOpacity: rect.fillOpacity,
      textColor: rectTextColor(rect),
      text: rect.text ?? "",
      width: rect.borderWidth,
      style: rect.borderStyle,
      locked: rect.locked,
    }),
    onPatch: (rect, patch) => {
      patchRect(rect, {
        ...(patch.lineColor != null ? { borderColor: patch.lineColor } : {}),
        ...(patch.fillColor != null ? { fillColor: patch.fillColor } : {}),
        ...(patch.fillOpacity != null ? { fillOpacity: patch.fillOpacity } : {}),
        ...(patch.textColor != null ? { textColor: patch.textColor } : {}),
        ...(patch.text != null ? { text: patch.text } : {}),
        ...(patch.width != null ? { borderWidth: patch.width } : {}),
        ...(patch.style ? { borderStyle: patch.style } : {}),
        ...(patch.locked != null ? { locked: patch.locked } : {}),
      });
    },
    onDelete: (rect) => deleteRect(rect.id),
    onSync: () => syncAll(),
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "rectangle",
    bridge: createClipboardBridge({
      kind: "rectangle",
      datasetId,
      candleStore,
      getSelectedId: () => selectedId,
      findById: (id) => rectangles.find((item) => item.id === id),
      append: (rect) => { rectangles.push(rect); },
      onCreate: callbacks.onCreate,
      select: (id) => selectRect(id),
      deleteSelected: () => { if (selectedId) deleteRect(selectedId); },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      syncAll,
      cancelDrawing: (silent?: boolean) => {
        if (!drawPoint1) return false;
        drawPoint1 = null;
        clearGhost();
        if (!silent) callbacks.onDrawingComplete();
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
    purgeAll: purgeAllRects,
  });

  function selectRect(id: string | null) {
    if (!id) {
      if (selectedId !== null) {
        selectedId = null;
        removeToolbar();
        syncAll();
      }
      manager.clearSelection("rectangle");
      return;
    }
    selectedId = id;
    const r = rectangles.find((item) => item.id === id);
    if (r) createToolbar(r);
    manager.activateSelection("rectangle", elMap.get(id)?.group ?? null, id);
    syncAll();
  }

  function syncLabelOverlay(rect: Rectangle, bounds: PixelBounds, selected: boolean) {
    const el = labelStore.ensure(rect.id);
    const safe = { x: bounds.x, y: bounds.y, w: Math.max(0, bounds.w), h: Math.max(0, bounds.h) };
    const visibleBounds = clampHorizontalBounds(safe);
    el.style.left = `${visibleBounds.x + visibleBounds.w / 2}px`;
    el.style.top = `${visibleBounds.y + visibleBounds.h / 2}px`;
    el.style.width = `${Math.max(1, visibleBounds.w)}px`;
    el.style.transform = "translate(-50%, -50%)";

    const state = labelStore.syncContent(rect.id, selected);
    if (state === "editing") {
      el.style.display = "";
      return;
    }
    if (state === "hidden") {
      el.style.display = "none";
      return;
    }
    el.style.display = safe.w >= 70 && safe.h >= 28 ? "" : "none";
  }

  function applyPixelBounds(els: RectEls, b: PixelBounds, rect: Rectangle, selected: boolean) {
    const { x, y, w, h } = b;
    const safe = { x, y, w: Math.max(0, w), h: Math.max(0, h) };

    [els.fill, els.border, els.hit].forEach((el) => {
      el.setAttribute("x", String(safe.x));
      el.setAttribute("y", String(safe.y));
      el.setAttribute("width", String(safe.w));
      el.setAttribute("height", String(safe.h));
    });

    els.fill.setAttribute("fill", hexToRgba(rect.fillColor, rect.fillOpacity));
    els.border.setAttribute("stroke", rect.borderColor);
    els.border.setAttribute("stroke-width", String(rect.borderWidth));
    els.border.setAttribute("stroke-dasharray", strokeDash(rect.borderStyle));
    els.hit.style.cursor = rect.locked ? "default" : "move";
    els.text.style.display = "none";
    syncLabelOverlay(rect, safe, selected);

    const coords = getHandleCoords(safe);
    els.handles.forEach((h, i) => {
      h.setAttribute("cx", String(coords[i][0]));
      h.setAttribute("cy", String(coords[i][1]));
      h.style.display = selected && !rect.locked ? "" : "none";
    });
    els.group.classList.toggle("rect-selected", selected);
  }

  function syncOne(rect: Rectangle) {
    let els = elMap.get(rect.id);
    if (!els) { els = buildEls(rect); elMap.set(rect.id, els); }
    const b = getBounds(rect, chart, series, candleStore.candles);
    if (!b) {
      els.group.setAttribute("visibility", "hidden");
      const label = labelStore.get(rect.id);
      if (label) label.style.display = "none";
      return;
    }
    els.group.setAttribute("visibility", "visible");
    applyPixelBounds(els, b, rect, selectedId === rect.id);
  }

  function syncAll() {
    overlay.sync();
    rectangles.forEach(syncOne);
  }

  function startBodyDrag(id: string, startEv: PointerEvent) {
    const rect = rectangles.find((r) => r.id === id);
    if (!rect) return;
    const cb = container.getBoundingClientRect();
    const sx = startEv.clientX - cb.left;
    const sy = startEv.clientY - cb.top;
    const origB = getBounds(rect, chart, series, candleStore.candles);
    if (!origB) return;

    let latestEv: PointerEvent | null = null;
    runManagedDragSession(startEv, (active) => { dragActive = active; }, {
      target: startEv.target as Element,
      moveThreshold: 2,
      onMove: (event) => {
        latestEv = event;
        const dx = snapXToNearestCandle(chart, origB.x + (event.clientX - cb.left) - sx) - origB.x;
        const dy = (event.clientY - cb.top) - sy;
        const els = elMap.get(id);
        if (!els) return;
        const previewBounds = { x: origB.x + dx, y: origB.y + dy, w: origB.w, h: origB.h };
        applyPixelBounds(els, previewBounds, rect, true);
      },
      onEnd: (_event, moved) => {
        if (!moved || !latestEv) return;
        const dx = snapXToNearestCandle(chart, origB.x + (latestEv.clientX - cb.left) - sx) - origB.x;
        const dy = (latestEv.clientY - cb.top) - sy;
        const nb = { x: origB.x + dx, y: origB.y + dy, w: origB.w, h: origB.h };
        const tL = xToSnappedTime(chart, nb.x, candleStore.candles);
        const tR = xToSnappedTime(chart, nb.x + nb.w, candleStore.candles);
        const pT = series.coordinateToPrice(nb.y);
        const pB = series.coordinateToPrice(nb.y + nb.h);
        const r = rectangles.find((item) => item.id === id);
        if (r && tL != null && tR != null && pT != null && pB != null) {
          r.timeLeft = Math.min(tL, tR);
          r.timeRight = Math.max(tL, tR);
          r.priceTop = Math.max(pT, pB);
          r.priceBottom = Math.min(pT, pB);
          syncAll();
          callbacks.onUpdate(r);
        } else {
          syncAll();
        }
      },
    });
  }

  function startHandleDrag(id: string, pos: HandlePos, startEv: PointerEvent) {
    const rect = rectangles.find((r) => r.id === id);
    if (!rect) return;
    const cb = container.getBoundingClientRect();
    const origB = getBounds(rect, chart, series, candleStore.candles);
    if (!origB) return;

    let latestEv: PointerEvent | null = null;
    runManagedDragSession(startEv, (active) => { dragActive = active; }, {
      target: startEv.target as Element,
      onMove: (event) => {
        latestEv = event;
        const mx = snapXToNearestCandle(chart, event.clientX - cb.left);
        const my = event.clientY - cb.top;
        const nb = calcResizedBounds(origB, pos, mx, my);
        const els = elMap.get(id);
        if (!els) return;
        applyPixelBounds(els, nb, rect, true);
      },
      onEnd: (_event, moved) => {
        if (!moved || !latestEv) return;
        const mx = snapXToNearestCandle(chart, latestEv.clientX - cb.left);
        const my = latestEv.clientY - cb.top;
        const nb = calcResizedBounds(origB, pos, mx, my);
        const r = rectangles.find((item) => item.id === id);
        if (!r) return;
        const tL = xToSnappedTime(chart, nb.x, candleStore.candles);
        const tR = xToSnappedTime(chart, nb.x + nb.w, candleStore.candles);
        const pT = series.coordinateToPrice(nb.y);
        const pB = series.coordinateToPrice(nb.y + nb.h);
        if (tL != null && tR != null && pT != null && pB != null) {
          r.timeLeft = Math.min(tL, tR);
          r.timeRight = Math.max(tL, tR);
          r.priceTop = Math.max(pT, pB);
          r.priceBottom = Math.min(pT, pB);
        }
        syncAll();
        callbacks.onUpdate(r);
      },
    });
  }

  function clearGhost() {
    ghostEls?.group.remove();
    ghostEls = null;
    lastGhostPointer = null;
  }

  function createGhostEls(): GhostEls {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "rect-ghost");
    const fill = document.createElementNS(SVG_NS, "rect");
    fill.setAttribute("pointer-events", "none");
    fill.setAttribute("fill", hexToRgba("#2962ff", 20));
    const border = document.createElementNS(SVG_NS, "rect");
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", "#ff2727");
    border.setAttribute("stroke-width", "2");
    border.setAttribute("pointer-events", "none");
    const handles = HANDLE_POSITIONS.map((pos) => {
      const handle = document.createElementNS(SVG_NS, "circle");
      handle.setAttribute("class", "rect-handle-el");
      handle.setAttribute("r", "5");
      handle.dataset.pos = pos;
      handle.style.pointerEvents = "none";
      return handle;
    });
    group.append(fill, border, ...handles);
    svg.appendChild(group);
    return { group, fill, border, handles };
  }

  function applyGhostBounds(bounds: PixelBounds) {
    if (!ghostEls) return;
    const safe = {
      x: bounds.x,
      y: bounds.y,
      w: Math.max(0, bounds.w),
      h: Math.max(0, bounds.h),
    };
    [ghostEls.fill, ghostEls.border].forEach((el) => {
      el.setAttribute("x", String(safe.x));
      el.setAttribute("y", String(safe.y));
      el.setAttribute("width", String(safe.w));
      el.setAttribute("height", String(safe.h));
    });
    const coords = getHandleCoords(safe);
    ghostEls.handles.forEach((handle, index) => {
      handle.setAttribute("cx", String(coords[index][0]));
      handle.setAttribute("cy", String(coords[index][1]));
    });
  }

  function updateGhostRect(mx: number, my: number) {
    if (!ghostEls || !drawPoint1) return;
    const p1 = pointToPixel(chart, series, drawPoint1, candleStore.candles);
    if (!p1) return;
    applyGhostBounds({
      x: Math.min(mx, p1.x),
      y: Math.min(my, p1.y),
      w: Math.abs(mx - p1.x),
      h: Math.abs(my - p1.y),
    });
  }

  function handleDrawClick(event: DrawingPointerClickEvent) {
    if (manager.getMode() !== "rectangle") return;
    const bounds = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent;
    const rawX = sourceEvent ? sourceEvent.clientX - bounds.left : null;
    const rawY = sourceEvent ? sourceEvent.clientY - bounds.top : null;
    const x = rawX != null
      ? snapXToNearestCandle(chart, Math.max(0, Math.min(rawX, getPlotWidthLocal())))
      : null;
    const y = rawY;
    const time = x != null ? xToSnappedTime(chart, x, candleStore.candles) : null;
    const price = y != null ? series.coordinateToPrice(y) : null;
    if (time == null || price == null || price <= 0) return;

    if (!drawPoint1) {
      drawPoint1 = { time, price };
      ghostEls = createGhostEls();
      if (x != null && y != null) {
        lastGhostPointer = { x, y };
        updateGhostRect(x, y);
      }
      return;
    }

    const p1 = pointToPixel(chart, series, drawPoint1, candleStore.candles);
    const p2 = pointToPixel(chart, series, { time, price }, candleStore.candles);
    if (p1 && p2 && Math.abs(p2.x - p1.x) <= 5 && Math.abs(p2.y - p1.y) <= 5) {
      drawPoint1 = null;
      clearGhost();
      return;
    }

    const tL = Math.min(drawPoint1.time, time);
    const tR = Math.max(drawPoint1.time, time);
    const pT = Math.max(drawPoint1.price, price);
    const pB = Math.min(drawPoint1.price, price);
    const tpl = getDefaultDrawingTemplateState("rectangle");
    const newRect: Rectangle = {
      id: crypto.randomUUID(),
      datasetId,
      timeLeft: tL,
      timeRight: tR,
      priceTop: pT,
      priceBottom: pB,
      borderColor: tpl.lineColor,
      fillColor: tpl.fillColor ?? "#2962ff",
      fillOpacity: tpl.fillOpacity ?? 20,
      textColor: tpl.textColor ?? tpl.fillColor ?? "#2962ff",
      text: "",
      borderWidth: tpl.width,
      borderStyle: tpl.style,
      locked: false,
    };
    rectangles.push(newRect);
    callbacks.onCreate(newRect);
    drawPoint1 = null;
    clearGhost();
    selectRect(newRect.id);
    syncAll();
    callbacks.onDrawingComplete();
  }

  function handleMouseMove(event: MouseEvent) {
    if (!drawPoint1 || !ghostEls) return;
    const bounds = container.getBoundingClientRect();
    const mx = snapXToNearestCandle(chart, Math.max(0, Math.min(event.clientX - bounds.left, getPlotWidthLocal())));
    const my = event.clientY - bounds.top;
    lastGhostPointer = { x: mx, y: my };
    updateGhostRect(mx, my);
  }

  const refreshGhostAfterViewportChange = () => {
    if (!drawPoint1 || !ghostEls || !lastGhostPointer) return;
    updateGhostRect(lastGhostPointer.x, lastGhostPointer.y);
  };

  const cleanupDrawingClick = bindDrawingPointerClick({
    container,
    chart,
    manager,
    mode: "rectangle",
    onClick: handleDrawClick,
  });
  chart.timeScale().subscribeVisibleLogicalRangeChange(refreshGhostAfterViewportChange);
  container.addEventListener("mousemove", handleMouseMove);

  const onBgPointerDown = (e: PointerEvent) => {
    if (manager.getMode() !== "none") return;
    const t = e.target as Element;
    if (
      t.closest(".rect-toolbar") ||
      t.closest(".rect-palette") ||
      t.classList.contains("rect-hit-el") ||
      t.classList.contains("rect-handle-el")
    ) return;
    if (selectedId) selectRect(null);
  };
  container.addEventListener("pointerdown", onBgPointerDown);

  return () => {
    unregisterLifecycle();
    cleanupDrawingClick();
    try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(refreshGhostAfterViewportChange); } catch { }
    container.removeEventListener("mousemove", handleMouseMove);
    container.removeEventListener("pointerdown", onBgPointerDown);
    removeToolbar();
    toolbarController.destroy();
    overlay.remove();
    labelStore.destroy();
    clearGhost();
  };
}
