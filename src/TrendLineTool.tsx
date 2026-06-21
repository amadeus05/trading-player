/**
 * TrendLineTool – renders, draws, edits and manages trend lines on the
 * lightweight-charts SVG overlay.  Designed to be called inside the Chart
 * component's useEffect so it can access chart / series APIs directly.
 */

import type { TrendLine } from "./types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DrawingMode = "none" | "trendline" | "measure";

export interface TrendLineCallbacks {
  onCreate: (line: TrendLine) => void;
  onUpdate: (line: TrendLine) => void;
  onDelete: (id: string) => void;
  onDrawingComplete: () => void;
}

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

function timeToLogical(time: number, candles: { time: number }[]): number | null {
  if (!candles.length) return null;
  let low = 0, high = candles.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time === time) return mid;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid - 1;
  }
  if (high < 0) {
    const tf = candles.length > 1 ? candles[1].time - candles[0].time : 60;
    return (time - candles[0].time) / tf;
  }
  if (low >= candles.length) {
    const tf = candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time : 60;
    return candles.length - 1 + (time - candles[candles.length - 1].time) / tf;
  }
  const tf = candles[low].time - candles[high].time;
  const fraction = (time - candles[high].time) / tf;
  return high + fraction;
}

function pxToTime(chart: any, x: number, candles: { time: number }[]): number | null {
  const logical = chart.timeScale().coordinateToLogical(x);
  if (logical == null) return null;
  if (!candles.length) return null;

  if (logical < 0) {
    const tf = candles.length > 1 ? candles[1].time - candles[0].time : 60;
    return candles[0].time + logical * tf;
  }
  if (logical >= candles.length - 1) {
    const tf = candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time : 60;
    return candles[candles.length - 1].time + (logical - (candles.length - 1)) * tf;
  }

  const idx = Math.floor(logical as number);
  const frac = (logical as number) - idx;
  const tf = candles[idx + 1].time - candles[idx].time;
  return candles[idx].time + frac * tf;
}

function pxToPrice(series: any, y: number): number | null {
  return series.coordinateToPrice(y);
}

/* ------------------------------------------------------------------ */
/*  Main attach function                                               */
/* ------------------------------------------------------------------ */

/**
 * Call once inside the Chart useEffect.  Returns a cleanup function.
 */
export function attachTrendLineTool(opts: {
  container: HTMLDivElement;
  chart: any;
  series: any;
  candles: { time: number }[];
  trendLines: TrendLine[];
  drawingMode: DrawingMode;
  datasetId: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  callbacks: TrendLineCallbacks;
}): () => void {
  const { container, chart, series, candles, drawingMode, datasetId, callbacks, onSelect } = opts;
  let trendLines = [...opts.trendLines];

  /* ---- SVG overlay ---- */
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("trend-line-overlay");
  container.appendChild(svg);

  /* ---- Selection state ---- */
  let selectedId: string | null = opts.selectedId ?? null;
  let ghostLine: SVGLineElement | null = null;
  let drawPoint1: { time: number; price: number } | null = null;
  let dragActive = false;
  let dragRaf = 0;

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
  let toolbar: HTMLDivElement | null = null;
  let toolbarLineId: string | null = null;
  let textEditor: HTMLDivElement | null = null;

  function removeToolbar() {
    textEditor?.remove(); textEditor = null;
    if (toolbar) { toolbar.remove(); toolbar = null; toolbarLineId = null; }
  }

  function createToolbar(tl: TrendLine) {
    removeToolbar();
    toolbarLineId = tl.id;
    const div = document.createElement("div");
    div.className = "trend-toolbar";
    div.innerHTML = `
      <div class="trend-toolbar-row">
        <label class="trend-toolbar-color" title="Цвет">
          <input type="color" value="${tl.color}" />
        </label>
        <div class="trend-toolbar-sep"></div>
        <button class="trend-toolbar-width" data-w="1" title="1px"${tl.width === 1 ? ' data-active="1"' : ""}>
          <svg width="20" height="16"><line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" stroke-width="1"/></svg>
        </button>
        <button class="trend-toolbar-width" data-w="2" title="2px"${tl.width === 2 ? ' data-active="1"' : ""}>
          <svg width="20" height="16"><line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button class="trend-toolbar-width" data-w="3" title="3px"${tl.width === 3 ? ' data-active="1"' : ""}>
          <svg width="20" height="16"><line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" stroke-width="3"/></svg>
        </button>
        <button class="trend-toolbar-width" data-w="4" title="4px"${tl.width === 4 ? ' data-active="1"' : ""}>
          <svg width="20" height="16"><line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" stroke-width="4"/></svg>
        </button>
        <div class="trend-toolbar-sep"></div>
        <button class="trend-toolbar-style" data-s="solid" title="Сплошная"${tl.lineStyle === "solid" ? ' data-active="1"' : ""}>
          <svg width="22" height="16"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button class="trend-toolbar-style" data-s="dashed" title="Пунктир"${tl.lineStyle === "dashed" ? ' data-active="1"' : ""}>
          <svg width="22" height="16"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/></svg>
        </button>
        <button class="trend-toolbar-style" data-s="dotted" title="Точки"${tl.lineStyle === "dotted" ? ' data-active="1"' : ""}>
          <svg width="22" height="16"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="2 3"/></svg>
        </button>
        <div class="trend-toolbar-sep"></div>
        <button class="trend-toolbar-extend" data-dir="left" title="Продлить влево"${tl.extendLeft ? ' data-active="1"' : ""}>
          <svg width="18" height="16" viewBox="0 0 18 16"><polyline points="7,4 2,8 7,12" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        <button class="trend-toolbar-extend" data-dir="right" title="Продлить вправо"${tl.extendRight ? ' data-active="1"' : ""}>
          <svg width="18" height="16" viewBox="0 0 18 16"><polyline points="11,4 16,8 11,12" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        <div class="trend-toolbar-sep"></div>
        <button class="trend-toolbar-delete" title="Удалить">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4.5 3V2.5a1.5 1.5 0 013 0V3h4a.5.5 0 010 1h-.554l-.602 8.43A1.5 1.5 0 018.85 13.5H3.15a1.5 1.5 0 01-1.494-1.07L1.054 4H.5a.5.5 0 010-1h4zm1 0h1V2.5a.5.5 0 00-1 0V3zM2.06 4l.579 8.14a.5.5 0 00.498.36h5.726a.5.5 0 00.498-.36L9.94 4H2.06z" fill="currentColor"/></svg>
        </button>
      </div>
    `;
    const extendButtons = [...div.querySelectorAll(".trend-toolbar-extend")];
    extendButtons[0]?.previousElementSibling?.remove();
    extendButtons.forEach((button) => button.remove());
    div.querySelector(".trend-toolbar-color")!.insertAdjacentHTML("afterend", `<button class="trend-toolbar-text" title="Текст">T</button>`);
    container.appendChild(div);
    toolbar = div;

    // Color
    const colorInput = div.querySelector('input[type="color"]') as HTMLInputElement;
    colorInput.addEventListener("input", () => {
      const line = trendLines.find((item) => item.id === tl.id);
      if (!line) return;
      line.color = colorInput.value;
      syncOne(line);
    });
    colorInput.addEventListener("change", () => {
      const line = trendLines.find((item) => item.id === tl.id);
      if (line) callbacks.onUpdate(line);
    });
    div.querySelector(".trend-toolbar-text")!.addEventListener("click", (event) => {
      event.stopPropagation();
      textEditor?.remove();
      textEditor = document.createElement("div");
      textEditor.className = "trend-text-editor";
      textEditor.innerHTML = `<input type="text" placeholder="Текст" value="${tl.label.replaceAll('"', '&quot;')}"><button title="Убрать текст">×</button>`;
      container.appendChild(textEditor);
      const input = textEditor.querySelector("input")!;
      const bounds = div.getBoundingClientRect(), host = container.getBoundingClientRect();
      textEditor.style.left = `${bounds.left - host.left}px`;
      textEditor.style.top = `${bounds.bottom - host.top + 6}px`;
      const preview = () => { const line = trendLines.find((item) => item.id === tl.id); if (!line) return; line.label = input.value; line.showLabel = Boolean(input.value.trim()); syncOne(line); };
      const commit = () => { const line = trendLines.find((item) => item.id === tl.id); if (line) callbacks.onUpdate(line); };
      input.addEventListener("input", preview);
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (key) => { if (key.key === "Enter") { commit(); textEditor?.remove(); textEditor = null } if (key.key === "Escape") { textEditor?.remove(); textEditor = null } });
      textEditor.querySelector("button")!.addEventListener("click", () => { input.value = ""; preview(); commit(); textEditor?.remove(); textEditor = null });
      textEditor.addEventListener("pointerdown", (pointer) => pointer.stopPropagation());
      input.focus(); input.select();
    });

    // Width buttons
    div.querySelectorAll<HTMLButtonElement>(".trend-toolbar-width").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const w = Number(btn.dataset.w);
        updateLine(tl.id, { width: w });
        div.querySelectorAll(".trend-toolbar-width").forEach((b) => b.removeAttribute("data-active"));
        btn.setAttribute("data-active", "1");
      });
    });

    // Style buttons
    div.querySelectorAll<HTMLButtonElement>(".trend-toolbar-style").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const s = btn.dataset.s as TrendLine["lineStyle"];
        updateLine(tl.id, { lineStyle: s });
        div.querySelectorAll(".trend-toolbar-style").forEach((b) => b.removeAttribute("data-active"));
        btn.setAttribute("data-active", "1");
      });
    });

    // Extend buttons
    div.querySelectorAll<HTMLButtonElement>(".trend-toolbar-extend").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const dir = btn.dataset.dir;
        const line = trendLines.find((l) => l.id === tl.id);
        if (!line) return;
        if (dir === "left") {
          const next = !line.extendLeft;
          updateLine(tl.id, { extendLeft: next });
          if (next) btn.setAttribute("data-active", "1"); else btn.removeAttribute("data-active");
        } else {
          const next = !line.extendRight;
          updateLine(tl.id, { extendRight: next });
          if (next) btn.setAttribute("data-active", "1"); else btn.removeAttribute("data-active");
        }
      });
    });

    // Delete
    div.querySelector(".trend-toolbar-delete")!.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLine(tl.id);
    });

    // Stop clicks from deselecting
    div.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  function positionToolbar(tl: TrendLine) {
    if (!toolbar || toolbarLineId !== tl.id) return;
    const p1 = toPixel(tl.point1);
    const p2 = toPixel(tl.point2);
    if (!p1 || !p2) return;
    const mx = (p1.x + p2.x) / 2;
    const my = Math.min(p1.y, p2.y) - 44;
    const rect = container.getBoundingClientRect();
    const tbW = toolbar.offsetWidth || 380;
    toolbar.style.left = `${Math.max(4, Math.min(mx - tbW / 2, rect.width - tbW - 4))}px`;
    toolbar.style.top = `${Math.max(4, my)}px`;
  }

  /* ---- Helpers ---- */

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    const logical = timeToLogical(pt.time, candles);
    if (logical == null) return null;
    const x = chart.timeScale().logicalToCoordinate(logical);
    const y = series.priceToCoordinate(pt.price);
    if (x == null || y == null) return null;
    return { x, y };
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
    if (selectedId === id) { selectedId = null; removeToolbar(); }
    callbacks.onDelete(id);
  }

  function selectLine(id: string | null) {
    selectedId = id;
    if (onSelect) onSelect(id);
    if (id) {
      const tl = trendLines.find((l) => l.id === id);
      if (tl) createToolbar(tl);
    } else {
      removeToolbar();
    }
    syncAll();
  }

  /* ---- Build SVG elements for one line ---- */

  function buildLineEls(tl: TrendLine): LineEls {
    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.trendId = tl.id;

    const extLine = document.createElementNS(SVG_NS, "line");
    extLine.setAttribute("class", "trend-ext-line");

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "trend-main-line");

    const hitArea = document.createElementNS(SVG_NS, "line");
    hitArea.setAttribute("class", "trend-hit-area");

    const handle1 = document.createElementNS(SVG_NS, "circle");
    handle1.setAttribute("class", "trend-handle");
    handle1.setAttribute("r", "5");

    const handle2 = document.createElementNS(SVG_NS, "circle");
    handle2.setAttribute("class", "trend-handle");
    handle2.setAttribute("r", "5");

    const labelText = document.createElementNS(SVG_NS, "text");
    labelText.setAttribute("class", "trend-label");

    group.append(extLine, line, hitArea, handle1, handle2, labelText);
    svg.appendChild(group);

    // Interaction: select on click
    hitArea.addEventListener("pointerdown", (e) => {
      if (drawingMode !== "none") return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      startDragBody(tl.id, e);
    });

    handle1.addEventListener("pointerdown", (e) => {
      if (drawingMode !== "none") return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      startDragHandle(tl.id, "point1", e);
    });

    handle2.addEventListener("pointerdown", (e) => {
      if (drawingMode !== "none") return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
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
    els.handle1.setAttribute("fill", tl.color);
    els.handle1.style.display = isSelected ? "" : "none";

    els.handle2.setAttribute("cx", String(p2.x));
    els.handle2.setAttribute("cy", String(p2.y));
    els.handle2.setAttribute("fill", tl.color);
    els.handle2.style.display = isSelected ? "" : "none";

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
    trendLines.forEach(syncOne);
    // Position toolbar if visible
    const tl = trendLines.find((l) => l.id === toolbarLineId);
    if (tl) positionToolbar(tl);
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
    let moved = false;

    // Attempt pointer capture
    const target = startEvent.target as Element;
    if (target.setPointerCapture) target.setPointerCapture(startEvent.pointerId);

    let latestEvent: PointerEvent | null = null;
    const renderMove = () => {
      dragRaf = 0;
      const e = latestEvent;
      if (!e) return;
      moved = true;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      previewAtPixels(tl, which === "point1" ? { x, y } : originalP1, which === "point2" ? { x, y } : originalP2);
    };
    const onMove = (e: PointerEvent) => {
      latestEvent = e;
      if (!dragRaf) dragRaf = requestAnimationFrame(renderMove);
    };

    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; renderMove(); }
      dragActive = false;
      if (target.releasePointerCapture) target.releasePointerCapture(e.pointerId);
      const lineObj = trendLines.find((l) => l.id === id);
      if (lineObj && moved && latestEvent) {
        const x = latestEvent.clientX - rect.left;
        const y = latestEvent.clientY - rect.top;
        const time = pxToTime(chart, x, candles);
        const price = pxToPrice(series, y);
        if (time != null && price != null && price > 0) lineObj[which] = { time, price };
        syncAll();
        callbacks.onUpdate(lineObj);
      }
    };

    dragActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
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

    let moved = false;

    // Attempt pointer capture
    const target = startEvent.target as Element;
    if (target.setPointerCapture) target.setPointerCapture(startEvent.pointerId);

    let latestEvent: PointerEvent | null = null;
    let finalDx = 0, finalDy = 0;
    const renderMove = () => {
      dragRaf = 0;
      const e = latestEvent;
      if (!e) return;
      const dx = (e.clientX - rect.left) - startX;
      const dy = (e.clientY - rect.top) - startY;

      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      finalDx = dx; finalDy = dy;
      previewAtPixels(tl, { x: p1Px.x + dx, y: p1Px.y + dy }, { x: p2Px.x + dx, y: p2Px.y + dy });
    };
    const onMove = (e: PointerEvent) => {
      latestEvent = e;
      if (!dragRaf) dragRaf = requestAnimationFrame(renderMove);
    };

    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; renderMove(); }
      dragActive = false;
      if (target.releasePointerCapture) target.releasePointerCapture(e.pointerId);
      const lineObj = trendLines.find((l) => l.id === id);
      if (lineObj && moved) {
        const newP1Time = pxToTime(chart, p1Px.x + finalDx, candles);
        const newP1Price = pxToPrice(series, p1Px.y + finalDy);
        const newP2Time = pxToTime(chart, p2Px.x + finalDx, candles);
        const newP2Price = pxToPrice(series, p2Px.y + finalDy);
        if (newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null && newP1Price > 0 && newP2Price > 0) {
          lineObj.point1 = { time: newP1Time, price: newP1Price };
          lineObj.point2 = { time: newP2Time, price: newP2Price };
        }
        syncAll();
        callbacks.onUpdate(lineObj);
      }
    };

    dragActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  /* ---- Drawing mode ---- */

  function handleDrawClick(event: any) {
    if (drawingMode !== "trendline") return;
    const rect = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    const x = sourceEvent ? sourceEvent.clientX - rect.left : null;
    const y = sourceEvent ? sourceEvent.clientY - rect.top : null;
    const time = x != null ? pxToTime(chart, x, candles) : (event.time as number | undefined);
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
    const x = event.clientX - rect.left;
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
    if (target.closest(".trend-toolbar") || target.closest(".trend-hit-area") || target.closest(".trend-handle")) return;
    if (selectedId) {
      selectLine(null);
    }
  }

  /* ---- Delete key ---- */
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Delete" || event.key === "Backspace") {
      // Don't delete if user is typing in an input
      if ((event.target as Element)?.tagName === "INPUT" || (event.target as Element)?.tagName === "TEXTAREA") return;
      if (selectedId) {
        event.preventDefault();
        deleteLine(selectedId);
      }
    }
    if (event.key === "Escape") {
      if (drawPoint1) {
        drawPoint1 = null;
        if (ghostLine) { ghostLine.remove(); ghostLine = null; }
        callbacks.onDrawingComplete();
      }
      if (selectedId) selectLine(null);
    }
  }

  /* ---- Sync loop ---- */
  let rafId = 0;
  function loop() {
    if (!dragActive) syncAll();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  /* ---- Attach events ---- */
  if (drawingMode === "trendline") {
    chart.subscribeClick(handleDrawClick);
  }
  container.addEventListener("mousemove", handleMouseMove);
  container.addEventListener("pointerdown", handleBackgroundClick);
  document.addEventListener("keydown", handleKeyDown);

  /* ---- Cleanup ---- */
  return () => {
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(dragRaf);
    try { chart.unsubscribeClick(handleDrawClick); } catch { }
    container.removeEventListener("mousemove", handleMouseMove);
    container.removeEventListener("pointerdown", handleBackgroundClick);
    document.removeEventListener("keydown", handleKeyDown);
    svg.remove();
    removeToolbar();
    if (ghostLine) ghostLine.remove();
  };
}
