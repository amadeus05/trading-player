/**
 * RectangleTool – рисует, выделяет и редактирует прямоугольники на оверлее графика.
 */

import type { Rectangle } from "../../types";
import { snapXToNearestCandle, timeToX, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { attachManagedDrawingLifecycle, createClipboardBridge, getPlotWidth, runManagedDragSession } from "../shared/ManagedDrawingTool";
import { createDrawingOverlay } from "../shared/overlay";
import { forgetFloatingPanelPosition } from "../shared/floatingPanel";
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

function wrapRectangleText(value: string, width: number, height: number): string[] {
  const safeWidth = Number.isFinite(width) ? width : 70;
  const safeHeight = Number.isFinite(height) ? height : 28;
  const maxChars = Math.max(1, Math.floor((safeWidth - 16) / 7.5));
  const maxLines = Math.max(1, Math.floor((safeHeight - 12) / 18));
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks: string[] = [];
    if (word.length > maxChars) {
      for (let offset = 0; offset < word.length; offset += maxChars) {
        chunks.push(word.slice(offset, offset + maxChars));
      }
    } else chunks.push(word);
    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (candidate.length <= maxChars) current = candidate;
      else {
        if (current) lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const last = visible.length - 1;
  if (last >= 0 && visible[last]) {
    visible[last] = `${visible[last].slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }
  return visible;
}

function hexToRgba(hex: string, opacity: number): string {
  if (opacity === 0) return "transparent";
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  return `rgba(${r},${g},${b},${opacity / 100})`;
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
  const { container, chart, series, candleStore, drawingMode, datasetId, callbacks, manager } = opts;
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
  let textEditor: HTMLInputElement | null = null;
  let dragActive = false;

  let isDrawing = false;
  let drawStart: { x: number; y: number } | null = null;
  let ghostRect: SVGRectElement | null = null;

  interface RectEls {
    group: SVGGElement;
    fill: SVGRectElement;
    border: SVGRectElement;
    hit: SVGRectElement;
    text: SVGTextElement;
    handles: SVGCircleElement[];
  }
  const elMap = new Map<string, RectEls>();

  function closeTextEditor() {
    textEditor?.remove();
    textEditor = null;
  }

  function removeToolbar() {
    closeTextEditor();
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

  function openTextEditor(rect: Rectangle) {
    if (rect.locked) return;
    closeTextEditor();
    const bounds = getBounds(rect, chart, series, candleStore.candles);
    if (!bounds) return;
    const visibleBounds = clampHorizontalBounds(bounds);
    const input = document.createElement("input");
    input.className = "rect-inline-text-editor";
    input.value = rect.text ?? "";
    input.placeholder = "Add text";
    input.style.left = `${visibleBounds.x + visibleBounds.w / 2}px`;
    input.style.top = `${visibleBounds.y + visibleBounds.h / 2}px`;
    input.style.color = rectTextColor(rect);
    container.appendChild(input);
    textEditor = input;

    const commit = () => {
      if (textEditor !== input) return;
      rect.text = input.value.trim();
      callbacks.onUpdate(rect);
      closeTextEditor();
      syncOne(rect);
    };
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); closeTextEditor(); syncOne(rect); }
    });
    requestAnimationFrame(() => {
      if (textEditor !== input) return;
      input.focus();
      input.select();
    });
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
    text.setAttribute("class", "rect-label-el");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("pointer-events", "all");

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
      if (!r || r.locked) return;
      selectRect(rect.id);
      startBodyDrag(rect.id, e);
    });
    hit.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const current = rectangles.find((item) => item.id === rect.id);
      if (current) openTextEditor(current);
    });
    text.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
    });
    text.addEventListener("pointerup", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      const current = rectangles.find((item) => item.id === rect.id);
      if (!current) return;
      if (selectedId !== rect.id) selectRect(rect.id);
      openTextEditor(current);
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
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("rectangle");
    }
    callbacks.onDelete(id);
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "full",
    className: "rect-toolbar",
    persistenceKey: (rect) => `rectangle:${rect.id}`,
    getState: (rect) => ({
      lineColor: rect.borderColor,
      fillColor: rect.fillColor,
      fillOpacity: rect.fillOpacity,
      textColor: rectTextColor(rect),
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
      cancelDrawing: () => {
        if (!isDrawing) return false;
        isDrawing = false;
        drawStart = null;
        ghostRect?.remove();
        ghostRect = null;
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
    const centerX = safe.x + safe.w / 2;
    const labelValue = rect.text || (selected ? "+ Add text" : "");
    const labelLines = labelValue ? wrapRectangleText(labelValue, safe.w, safe.h) : [];
    els.text.textContent = "";
    try {
      labelLines.forEach((line, index) => {
        const tspan = document.createElementNS(SVG_NS, "tspan");
        tspan.setAttribute("x", String(centerX));
        tspan.setAttribute("y", String(safe.y + safe.h / 2 - ((labelLines.length - 1) * 18) / 2 + index * 18));
        tspan.textContent = line;
        els.text.appendChild(tspan);
      });
    } catch {
      // Text rendering must never interrupt the rectangle render loop.
      els.text.textContent = labelValue;
      els.text.setAttribute("x", String(centerX));
      els.text.setAttribute("y", String(safe.y + safe.h / 2));
    }
    els.text.setAttribute("fill", rectTextColor(rect));
    els.text.style.display = safe.w >= 70 && safe.h >= 28 && Boolean(labelValue) ? "" : "none";
    els.text.classList.toggle("is-placeholder", !rect.text);

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
    if (!b) { els.group.setAttribute("visibility", "hidden"); return; }
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
        applyPixelBounds(els, { x: origB.x + dx, y: origB.y + dy, w: origB.w, h: origB.h }, rect, true);
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

  let drawOverlay: HTMLDivElement | null = null;

  if (drawingMode === "rectangle") {
    drawOverlay = document.createElement("div");
    drawOverlay.className = "rect-draw-overlay";
    container.appendChild(drawOverlay);

    drawOverlay.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const cb = container.getBoundingClientRect();
      drawStart = { x: snapXToNearestCandle(chart, Math.max(0, Math.min(e.clientX - cb.left, getPlotWidthLocal()))), y: e.clientY - cb.top };
      isDrawing = true;
      ghostRect = document.createElementNS(SVG_NS, "rect");
      ghostRect.setAttribute("class", "rect-ghost-el");
      svg.appendChild(ghostRect);
      try { (drawOverlay as any).setPointerCapture?.(e.pointerId); } catch { }
    });

    drawOverlay.addEventListener("pointermove", (e) => {
      if (!isDrawing || !drawStart || !ghostRect) return;
      const cb = container.getBoundingClientRect();
      const mx = snapXToNearestCandle(chart, Math.max(0, Math.min(e.clientX - cb.left, getPlotWidthLocal()))), my = e.clientY - cb.top;
      ghostRect.setAttribute("x", String(Math.min(mx, drawStart.x)));
      ghostRect.setAttribute("y", String(Math.min(my, drawStart.y)));
      ghostRect.setAttribute("width", String(Math.abs(mx - drawStart.x)));
      ghostRect.setAttribute("height", String(Math.abs(my - drawStart.y)));
    });

    drawOverlay.addEventListener("pointerup", (e) => {
      if (!isDrawing || !drawStart) return;
      isDrawing = false;
      ghostRect?.remove(); ghostRect = null;

      const cb = container.getBoundingClientRect();
      const ex = snapXToNearestCandle(chart, Math.max(0, Math.min(e.clientX - cb.left, getPlotWidthLocal()))), ey = e.clientY - cb.top;

      if (Math.abs(ex - drawStart.x) > 5 && Math.abs(ey - drawStart.y) > 5) {
        const xMin = Math.min(ex, drawStart.x), xMax = Math.max(ex, drawStart.x);
        const yMin = Math.min(ey, drawStart.y), yMax = Math.max(ey, drawStart.y);
        const tL = xToSnappedTime(chart, xMin, candleStore.candles);
        const tR = xToSnappedTime(chart, xMax, candleStore.candles);
        const pT = series.coordinateToPrice(yMin);
        const pB = series.coordinateToPrice(yMax);

        if (tL != null && tR != null && pT != null && pB != null) {
          const newRect: Rectangle = {
            id: crypto.randomUUID(),
            datasetId,
            timeLeft: tL, timeRight: tR,
            priceTop: Math.max(pT, pB),
            priceBottom: Math.min(pT, pB),
            borderColor: "#ff2727",
            fillColor: "#2962ff",
            fillOpacity: 20,
            textColor: "#2962ff",
            text: "",
            borderWidth: 2,
            borderStyle: "solid",
            locked: false,
          };
          rectangles.push(newRect);
          callbacks.onCreate(newRect);
          selectRect(newRect.id);
          syncAll();
        }
      }

      drawStart = null;
      callbacks.onDrawingComplete();
    });
  }

  const onBgPointerDown = (e: PointerEvent) => {
    if (drawingMode !== "none") return;
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
    container.removeEventListener("pointerdown", onBgPointerDown);
    drawOverlay?.remove();
    overlay.remove();
    toolbarController.destroy();
    removeToolbar();
    ghostRect?.remove();
  };
}
