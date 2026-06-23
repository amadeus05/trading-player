/**
 * RectangleTool – рисует, выделяет и редактирует прямоугольники на оверлее графика.
 */

import type { Rectangle } from "../../types";
import { snapXToNearestCandle, timeToX, xToSnappedTime } from "../shared/coordinates";
import { createDrawingOverlay } from "../shared/overlay";
import { forgetFloatingPanelPosition, mountFloatingPanel } from "../shared/floatingPanel";
import { mountAnchoredPopup } from "../shared/popup";
import type { DrawingCrudCallbacks, ManagedDrawingToolOptions, ChartCandleStore } from "../shared/types";
import { createDrawingToolbar } from "../shared/DrawingToolbar";

export type RectangleCallbacks = DrawingCrudCallbacks<Rectangle>;

const SVG_NS = "http://www.w3.org/2000/svg";

type HandlePos = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";
const HANDLE_POSITIONS: HandlePos[] = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];

const HANDLE_CURSORS: Record<HandlePos, string> = {
  tl: "nwse-resize", tc: "ns-resize", tr: "nesw-resize",
  ml: "ew-resize", mr: "ew-resize",
  bl: "nesw-resize", bc: "ns-resize", br: "nwse-resize",
};

const PALETTE_COLORS = [
  "#ffffff", "#d1d4dc", "#b2b5be", "#9598a1", "#787b86", "#4c525e", "#2a2e39", "#131722",
  "#ffd2d2", "#ffdfc5", "#fff3c2", "#d7f5dc", "#c2eef5", "#c5d8f8", "#d2c5f8", "#f5c2f0",
  "#ff8888", "#ffb36a", "#ffe066", "#66d68a", "#4dd8e0", "#6699f5", "#9580f5", "#f075e8",
  "#ff2727", "#ff6d00", "#ffd600", "#00c853", "#00bcd4", "#2962ff", "#7c4dff", "#e040fb",
  "#c62828", "#e65100", "#f9a825", "#1b5e20", "#006064", "#0d47a1", "#4527a0", "#880e4f",
  "#b71c1c", "#bf360c", "#ff8f00", "#2e7d32", "#00695c", "#1565c0", "#283593", "#6a1b9a",
  "#ff1744", "#ff9100", "#ffd740", "#69f0ae", "#18ffff", "#448aff", "#e040fb", "#ff4081",
  "#7f0000", "#662200", "#665500", "#004d1a", "#003d40", "#002266", "#1a0066", "#550033",
];

type PaletteTarget = "border" | "fill" | "text" | "width" | "style";

const TB_PENCIL = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12.1 2.9a1 1 0 0 1 1.4 0l1.5 1.5a1 1 0 0 1 0 1.4l-8.4 8.4H3.5v-2.5l8.4-8.4z" stroke="currentColor" stroke-width="1.35"/><path d="M10.6 4.4l2.5 2.5" stroke="currentColor" stroke-width="1.35"/></svg>`;
const TB_BUCKET = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.2 14.2h11.6" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M5.8 14.2l1-5.8h7.4l1 5.8" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M7.8 8.4V6.4a1.6 1.6 0 0 1 3.2 0v2" stroke="currentColor" stroke-width="1.35"/><path d="M13.8 5.2l1.6-1.6 1.3 1.3-1.6 1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M15.5 3.5c.4.4.4 1 0 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const TB_LINE = `<svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><line x1="0" y1="5" x2="14" y2="5" stroke="currentColor" stroke-width="1.5"/></svg>`;

function styleIcon(style: Rectangle["borderStyle"]): string {
  const dash = style === "dashed" ? " stroke-dasharray=\"4 3\"" : style === "dotted" ? " stroke-dasharray=\"2 3\"" : "";
  return `<svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2"${dash}/></svg>`;
}

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

  const getPlotWidth = () => Math.max(0, Number(chart.timeScale().width()) || 0);
  const clampHorizontalBounds = (bounds: PixelBounds): PixelBounds => {
    const plotWidth = getPlotWidth();
    const left = Math.max(0, Math.min(bounds.x, plotWidth));
    const right = Math.max(left, Math.min(bounds.x + bounds.w, plotWidth));
    return { ...bounds, x: left, w: right - left };
  };
  const overlay = createDrawingOverlay(container, chart, "rect-overlay");
  const { svg } = overlay;

  let selectedId: string | null = null;
  let toolbar: HTMLDivElement | null = null;
  let cleanupToolbarDrag: (() => void) | null = null;
  let toolbarRectId: string | null = null;
  let paletteEl: HTMLDivElement | null = null;
  let cleanupPopup: (() => void) | null = null;
  let paletteTarget: PaletteTarget | null = null;
  let textEditor: HTMLInputElement | null = null;
  let dragActive = false;
  let dragRaf = 0;

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

  function closePalette() {
    cleanupPopup?.();
    cleanupPopup = null;
    paletteEl?.remove();
    paletteEl = null;
    paletteTarget = null;
  }

  function closeTextEditor() {
    textEditor?.remove();
    textEditor = null;
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

  function openPalette(target: PaletteTarget, rect: Rectangle, anchor: Element) {
    if (target === "width" || target === "style") return;
    closePalette();
    paletteTarget = target;

    const currentColor = target === "border"
      ? rect.borderColor
      : target === "fill"
        ? rect.fillColor
        : rectTextColor(rect);
    const currentOpacity = target === "fill" ? rect.fillOpacity : 100;

    let div = document.createElement("div");
    div.className = "rect-palette";

    const grid = document.createElement("div");
    grid.className = "rect-palette-grid";
    PALETTE_COLORS.forEach((color) => {
      const btn = document.createElement("button");
      btn.className = "rect-palette-swatch";
      btn.style.background = color;
      if (color.toLowerCase() === currentColor.toLowerCase()) btn.classList.add("is-active");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = rectangles.find((item) => item.id === rect.id);
        if (!r) return;
        if (target === "border") r.borderColor = color;
        else if (target === "fill") r.fillColor = color;
        else r.textColor = color;
        callbacks.onUpdate(r);
        syncAll();
        refreshToolbar(r);
        grid.querySelectorAll(".rect-palette-swatch").forEach((s) => s.classList.remove("is-active"));
        btn.classList.add("is-active");
        updateSliderGradient?.(color);
      });
      grid.appendChild(btn);
    });
    div.appendChild(grid);

    const customRow = document.createElement("div");
    customRow.className = "rect-palette-custom";
    const customInput = document.createElement("input");
    customInput.type = "color";
    customInput.value = /^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : "#ffffff";
    customInput.className = "rect-palette-hidden-input";
    const addBtn = document.createElement("button");
    addBtn.className = "rect-palette-add";
    addBtn.textContent = "+";
    addBtn.title = "Другой цвет";
    addBtn.addEventListener("click", (e) => { e.stopPropagation(); customInput.click(); });
    customInput.addEventListener("change", () => {
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      if (target === "border") r.borderColor = customInput.value;
      else if (target === "fill") r.fillColor = customInput.value;
      else r.textColor = customInput.value;
      callbacks.onUpdate(r);
      syncAll();
      refreshToolbar(r);
      updateSliderGradient?.(customInput.value);
    });
    customRow.append(addBtn, customInput);
    div.appendChild(customRow);

    let updateSliderGradient: ((color: string) => void) | null = null;

    if (target === "fill") {
      const opRow = document.createElement("div");
      opRow.className = "rect-palette-opacity-row";

      const opLabel = document.createElement("span");
      opLabel.className = "rect-palette-op-label";
      opLabel.textContent = "Opacity";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(currentOpacity);
      slider.className = "rect-palette-op-slider";

      const valBox = document.createElement("div");
      valBox.className = "rect-palette-op-value";
      valBox.textContent = `${currentOpacity}%`;

      updateSliderGradient = (color: string) => {
        slider.style.setProperty("--grad-start", hexToRgba(color, 0));
        slider.style.setProperty("--grad-end", hexToRgba(color, 100));
      };
      updateSliderGradient(currentColor);

      slider.addEventListener("input", () => {
        const val = Number(slider.value);
        valBox.textContent = `${val}%`;
        const r = rectangles.find((item) => item.id === rect.id);
        if (!r) return;
        r.fillOpacity = val;
        callbacks.onUpdate(r);
        syncAll();
        refreshToolbar(r);
      });

      opRow.append(opLabel, slider, valBox);
      div.appendChild(opRow);
    }

    paletteEl = div;
    cleanupPopup = mountAnchoredPopup({
      container, anchor, popup: div, width: 210,
      onDismiss: () => { cleanupPopup = null; paletteEl = null; paletteTarget = null; },
    });
  }

  function openLineMenu(target: "width" | "style", rect: Rectangle, anchor: Element) {
    closePalette();
    paletteTarget = target;
    const div = document.createElement("div");
    div.className = "rect-line-menu";
    const options = target === "width"
      ? ([1, 2, 3, 4] as const).map((value) => ({ value: String(value), label: `${value}px`, icon: `<span class="rect-line-sample" style="height:${value}px"></span>`, active: rect.borderWidth === value }))
      : ([
          { value: "solid", label: "Line", icon: styleIcon("solid"), active: rect.borderStyle === "solid" },
          { value: "dashed", label: "Dashed line", icon: styleIcon("dashed"), active: rect.borderStyle === "dashed" },
          { value: "dotted", label: "Dotted line", icon: styleIcon("dotted"), active: rect.borderStyle === "dotted" },
        ]);

    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rect-line-menu-item${option.active ? " is-active" : ""}`;
      button.innerHTML = `<span class="rect-line-menu-icon">${option.icon}</span><span>${option.label}</span>`;
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const current = rectangles.find((item) => item.id === rect.id);
        if (!current) return;
        if (target === "width") current.borderWidth = Number(option.value);
        else current.borderStyle = option.value as Rectangle["borderStyle"];
        callbacks.onUpdate(current);
        syncAll();
        refreshToolbar(current);
        closePalette();
      });
      div.appendChild(button);
    });

    const menuWidth = target === "width" ? 104 : 168;
    paletteEl = div;
    cleanupPopup = mountAnchoredPopup({
      container, anchor, popup: div, width: menuWidth, gap: 2,
      onDismiss: () => { cleanupPopup = null; paletteEl = null; paletteTarget = null; },
    });
  }

  function removeToolbar() {
    closePalette();
    closeTextEditor();
    cleanupToolbarDrag?.();
    cleanupToolbarDrag = null;
    toolbar?.remove();
    toolbar = null;
    toolbarRectId = null;
  }

  function refreshToolbar(rect: Rectangle) {
    if (!toolbar || toolbarRectId !== rect.id) return;
    const borderBar = toolbar.querySelector<HTMLElement>(".rect-tb-border-btn .rect-tb-color-bar");
    const fillBar = toolbar.querySelector<HTMLElement>(".rect-tb-fill-btn .rect-tb-color-bar");
    const textBar = toolbar.querySelector<HTMLElement>(".rect-tb-text-btn .rect-tb-color-bar");
    if (borderBar) borderBar.style.background = rect.borderColor;
    if (fillBar) {
      fillBar.style.setProperty("--fill-color", hexToRgba(rect.fillColor, rect.fillOpacity));
      fillBar.classList.toggle("is-checkered", rect.fillOpacity < 100);
    }
    if (textBar) textBar.style.background = rectTextColor(rect);
    const widthLabel = toolbar.querySelector<HTMLElement>(".rect-tb-width-label");
    if (widthLabel) widthLabel.textContent = `${rect.borderWidth}px`;
    const styleBtn = toolbar.querySelector<HTMLElement>(".rect-tb-style-btn");
    if (styleBtn) styleBtn.innerHTML = styleIcon(rect.borderStyle);
    const lockBtn = toolbar.querySelector<HTMLElement>(".rect-tb-lock");
    if (lockBtn) {
      lockBtn.dataset.active = rect.locked ? "1" : "";
      lockBtn.title = rect.locked ? "Разблокировать" : "Заблокировать";
      lockBtn.innerHTML = lockIcon(rect.locked);
    }
  }

  function lockIcon(locked: boolean): string {
    return locked
      ? `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><rect x="1" y="7" width="12" height="8" rx="1.5"/><path d="M3.5 7V5a3.5 3.5 0 1 1 7 0v2" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="7" cy="11" r="1.3" fill="white"/></svg>`
      : `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><rect x="1" y="7" width="12" height="8" rx="1.5"/><path d="M10.5 7V5a3.5 3.5 0 0 0-7 0v2" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="7" cy="11" r="1.3" fill="white"/></svg>`;
  }

  function createToolbar(rect: Rectangle) {
    removeToolbar();
    toolbarRectId = rect.id;

    let div = document.createElement("div");
    div.className = "rect-toolbar";
    div.innerHTML = `<div class="rect-toolbar-row">
      <div class="rect-tb-grip">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
          <circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/>
          <circle cx="2" cy="7" r="1.5"/><circle cx="6" cy="7" r="1.5"/>
          <circle cx="2" cy="12" r="1.5"/><circle cx="6" cy="12" r="1.5"/>
        </svg>
      </div>
      <div class="rect-toolbar-sep"></div>
      <button type="button" class="rect-tb-color-btn rect-tb-border-btn" title="Цвет рамки">
        <span class="rect-tb-color-icon">${TB_PENCIL}</span>
        <span class="rect-tb-color-bar" style="background:${rect.borderColor}"></span>
      </button>
      <button type="button" class="rect-tb-color-btn rect-tb-fill-btn" title="Цвет заливки">
        <span class="rect-tb-color-icon">${TB_BUCKET}</span>
        <span class="rect-tb-color-bar rect-tb-fill-bar${rect.fillOpacity < 100 ? " is-checkered" : ""}" style="--fill-color:${hexToRgba(rect.fillColor, rect.fillOpacity)}"></span>
      </button>
      <button type="button" class="rect-tb-color-btn rect-tb-text-btn" title="Цвет текста">
        <span class="rect-tb-color-icon rect-tb-text-letter">T</span>
        <span class="rect-tb-color-bar" style="background:${rectTextColor(rect)}"></span>
      </button>
      <div class="rect-toolbar-sep"></div>
      <button type="button" class="rect-tb-width-btn" title="Толщина линии">
        ${TB_LINE}
        <span class="rect-tb-width-label">${rect.borderWidth}px</span>
      </button>
      <button type="button" class="rect-tb-style-btn" title="Стиль линии">${styleIcon(rect.borderStyle)}</button>
      <div class="rect-toolbar-sep"></div>
      <button type="button" class="rect-tb-lock rect-tb-icon-btn" title="${rect.locked ? "Разблокировать" : "Заблокировать"}"${rect.locked ? ' data-active="1"' : ''}>${lockIcon(rect.locked)}</button>
      <div class="rect-toolbar-sep"></div>
      <button type="button" class="rect-tb-del rect-tb-icon-btn" title="Удалить">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3V2.5a1.5 1.5 0 013 0V3h4a.5.5 0 010 1h-.554l-.602 8.43A1.5 1.5 0 018.85 13.5H3.15a1.5 1.5 0 01-1.494-1.07L1.054 4H.5a.5.5 0 010-1h4zm1 0h1V2.5a.5.5 0 00-1 0V3zM2.06 4l.579 8.14a.5.5 0 00.498.36h5.726a.5.5 0 00.498-.36L9.94 4H2.06z" fill="currentColor"/></svg>
      </button>
    </div>`;

    div = createDrawingToolbar({
      lineColor: rect.borderColor,
      fillColor: rect.fillColor,
      fillOpacity: rect.fillOpacity,
      textColor: rectTextColor(rect),
      width: rect.borderWidth,
      style: rect.borderStyle,
      locked: rect.locked,
      showFill: true,
      showText: true,
      showLock: true,
    });
    container.appendChild(div);
    toolbar = div;
    const grip = div.querySelector<HTMLElement>(".rect-tb-grip");
    if (grip) cleanupToolbarDrag = mountFloatingPanel({
      container,
      panel: div,
      grip,
      persistenceKey: `rectangle:${rect.id}`,
      onDragStart: closePalette,
    });

    div.querySelector(".rect-tb-border-btn")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      if (paletteTarget === "border") { closePalette(); return; }
      openPalette("border", r, e.currentTarget as Element);
    });

    div.querySelector(".rect-tb-fill-btn")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      if (paletteTarget === "fill") { closePalette(); return; }
      openPalette("fill", r, e.currentTarget as Element);
    });

    div.querySelector(".rect-tb-text-btn")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      if (paletteTarget === "text") { closePalette(); return; }
      openPalette("text", r, e.currentTarget as Element);
    });

    div.querySelector(".rect-tb-width-btn")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      if (paletteTarget === "width") { closePalette(); return; }
      openLineMenu("width", r, e.currentTarget as Element);
    });

    div.querySelector(".rect-tb-style-btn")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      if (paletteTarget === "style") { closePalette(); return; }
      openLineMenu("style", r, e.currentTarget as Element);
    });

    div.querySelector(".rect-tb-lock")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rectangles.find((item) => item.id === rect.id);
      if (!r) return;
      r.locked = !r.locked;
      callbacks.onUpdate(r);
      syncAll();
      refreshToolbar(r);
    });

    div.querySelector(".rect-tb-del")!.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteRect(rect.id);
    });

    div.addEventListener("pointerdown", (e) => e.stopPropagation());
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
    manager.activateSelection("rectangle", elMap.get(id)?.group ?? null);
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
    const target = startEv.target as Element;
    try { (target as any).setPointerCapture(startEv.pointerId); } catch { }
    let latestEv: PointerEvent | null = null;
    let moved = false;

    const render = () => {
      dragRaf = 0;
      const e = latestEv; if (!e) return;
      const dx = snapXToNearestCandle(chart, origB.x + (e.clientX - cb.left) - sx) - origB.x;
      const dy = (e.clientY - cb.top) - sy;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;
      const els = elMap.get(id); if (!els) return;
      applyPixelBounds(els, { x: origB.x + dx, y: origB.y + dy, w: origB.w, h: origB.h }, rect, true);
    };

    const onMove = (e: PointerEvent) => { latestEv = e; if (!dragRaf) dragRaf = requestAnimationFrame(render); };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; render(); }
      dragActive = false;
      try { (target as any).releasePointerCapture(e.pointerId); } catch { }
      if (moved && latestEv) {
        const dx = snapXToNearestCandle(chart, origB.x + (latestEv.clientX - cb.left) - sx) - origB.x;
        const dy = (latestEv.clientY - cb.top) - sy;
        const nb = { x: origB.x + dx, y: origB.y + dy, w: origB.w, h: origB.h };
        const tL = xToSnappedTime(chart, nb.x, candleStore.candles);
        const tR = xToSnappedTime(chart, nb.x + nb.w, candleStore.candles);
        const pT = series.coordinateToPrice(nb.y);
        const pB = series.coordinateToPrice(nb.y + nb.h);
        const r = rectangles.find((item) => item.id === id);
        if (r && tL != null && tR != null && pT != null && pB != null) {
          r.timeLeft = Math.min(tL, tR); r.timeRight = Math.max(tL, tR);
          r.priceTop = Math.max(pT, pB); r.priceBottom = Math.min(pT, pB);
          syncAll(); callbacks.onUpdate(r);
        } else { syncAll(); }
      }
    };

    dragActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function startHandleDrag(id: string, pos: HandlePos, startEv: PointerEvent) {
    const rect = rectangles.find((r) => r.id === id);
    if (!rect) return;
    const cb = container.getBoundingClientRect();
    const origB = getBounds(rect, chart, series, candleStore.candles);
    if (!origB) return;
    const target = startEv.target as Element;
    try { (target as any).setPointerCapture(startEv.pointerId); } catch { }
    let latestEv: PointerEvent | null = null;

    const render = () => {
      dragRaf = 0;
      const e = latestEv; if (!e) return;
      const mx = snapXToNearestCandle(chart, e.clientX - cb.left), my = e.clientY - cb.top;
      const nb = calcResizedBounds(origB, pos, mx, my);
      const els = elMap.get(id); if (!els) return;
      applyPixelBounds(els, nb, rect, true);
    };

    const onMove = (e: PointerEvent) => { latestEv = e; if (!dragRaf) dragRaf = requestAnimationFrame(render); };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; render(); }
      dragActive = false;
      try { (target as any).releasePointerCapture(e.pointerId); } catch { }
      if (latestEv) {
        const mx = snapXToNearestCandle(chart, latestEv.clientX - cb.left), my = latestEv.clientY - cb.top;
        const nb = calcResizedBounds(origB, pos, mx, my);
        const r = rectangles.find((item) => item.id === id);
        if (r) {
          const tL = xToSnappedTime(chart, nb.x, candleStore.candles);
          const tR = xToSnappedTime(chart, nb.x + nb.w, candleStore.candles);
          const pT = series.coordinateToPrice(nb.y);
          const pB = series.coordinateToPrice(nb.y + nb.h);
          if (tL != null && tR != null && pT != null && pB != null) {
            r.timeLeft = Math.min(tL, tR); r.timeRight = Math.max(tL, tR);
            r.priceTop = Math.max(pT, pB); r.priceBottom = Math.min(pT, pB);
          }
          syncAll(); callbacks.onUpdate(r);
        }
      }
    };

    dragActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  let drawOverlay: HTMLDivElement | null = null;

  if (drawingMode === "rectangle") {
    drawOverlay = document.createElement("div");
    drawOverlay.className = "rect-draw-overlay";
    container.appendChild(drawOverlay);

    drawOverlay.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const cb = container.getBoundingClientRect();
      drawStart = { x: snapXToNearestCandle(chart, Math.max(0, Math.min(e.clientX - cb.left, getPlotWidth()))), y: e.clientY - cb.top };
      isDrawing = true;
      ghostRect = document.createElementNS(SVG_NS, "rect");
      ghostRect.setAttribute("class", "rect-ghost-el");
      svg.appendChild(ghostRect);
      try { (drawOverlay as any).setPointerCapture?.(e.pointerId); } catch { }
    });

    drawOverlay.addEventListener("pointermove", (e) => {
      if (!isDrawing || !drawStart || !ghostRect) return;
      const cb = container.getBoundingClientRect();
      const mx = snapXToNearestCandle(chart, Math.max(0, Math.min(e.clientX - cb.left, getPlotWidth()))), my = e.clientY - cb.top;
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
      const ex = snapXToNearestCandle(chart, Math.max(0, Math.min(e.clientX - cb.left, getPlotWidth()))), ey = e.clientY - cb.top;

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

  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as Element)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      deleteRect(selectedId);
    }
    if (e.key === "Escape") {
      if (isDrawing) {
        isDrawing = false;
        drawStart = null;
        ghostRect?.remove(); ghostRect = null;
        callbacks.onDrawingComplete();
      }
      if (selectedId) selectRect(null);
    }
  };
  document.addEventListener("keydown", onKey);

  const unregisterDeselect = manager.registerDeselect("rectangle", () => {
    if (selectedId === null) return;
    selectedId = null;
    removeToolbar();
    syncAll();
  });

  let rafId = 0;
  const loop = () => {
    if (!dragActive) syncAll();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(dragRaf);
    unregisterDeselect();
    container.removeEventListener("pointerdown", onBgPointerDown);
    document.removeEventListener("keydown", onKey);
    drawOverlay?.remove();
    overlay.remove();
    removeToolbar();
    ghostRect?.remove();
  };
}
