import templatesIcon from "../icons/ui/drawing-templates.svg?raw";

export type DrawingLineStyle = "solid" | "dashed" | "dotted";

const PENCIL = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12.1 2.9a1 1 0 0 1 1.4 0l1.5 1.5a1 1 0 0 1 0 1.4l-8.4 8.4H3.5v-2.5l8.4-8.4z" stroke="currentColor" stroke-width="1.35"/><path d="M10.6 4.4l2.5 2.5" stroke="currentColor" stroke-width="1.35"/></svg>`;
const BUCKET = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.2 14.2h11.6M5.8 14.2l1-5.8h7.4l1 5.8M7.8 8.4V6.4a1.6 1.6 0 0 1 3.2 0v2" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>`;
const LINE = `<svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><line x1="0" y1="5" x2="14" y2="5" stroke="currentColor" stroke-width="1.5"/></svg>`;
const DELETE = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3V2.5a1.5 1.5 0 013 0V3h4a.5.5 0 010 1h-.554l-.602 8.43A1.5 1.5 0 018.85 13.5H3.15a1.5 1.5 0 01-1.494-1.07L1.054 4H.5a.5.5 0 010-1h4zm1 0h1V2.5a.5.5 0 00-1 0V3zM2.06 4l.579 8.14a.5.5 0 00.498.36h5.726a.5.5 0 00.498-.36L9.94 4H2.06z" fill="currentColor"/></svg>`;

export function drawingStyleIcon(style: DrawingLineStyle): string {
  const dash = style === "dashed" ? ` stroke-dasharray="4 3"` : style === "dotted" ? ` stroke-dasharray="2 3"` : "";
  return `<svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2"${dash}/></svg>`;
}

function lockIcon(locked: boolean): string {
  return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><rect x="1" y="7" width="12" height="8" rx="1.5"/><path d="${locked ? "M3.5 7V5a3.5 3.5 0 1 1 7 0v2" : "M10.5 7V5a3.5 3.5 0 0 0-7 0v2"}" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`;
}

export interface DrawingToolbarOptions {
  className?: string;
  lineColor: string;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  width: number;
  style: DrawingLineStyle;
  locked?: boolean;
  showFill?: boolean;
  showText?: boolean;
  showColor?: boolean;
  showLock?: boolean;
  showTemplates?: boolean;
}

export function createDrawingToolbar(options: DrawingToolbarOptions): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `rect-toolbar drawing-toolbar ${options.className ?? ""}`.trim();
  const showColor = options.showColor !== false;
  const color = showColor ? `<button type="button" class="rect-tb-color-btn rect-tb-border-btn trend-toolbar-color" title="Цвет линии"><span class="rect-tb-color-icon">${PENCIL}</span><span class="rect-tb-color-bar" style="background:${options.lineColor}"></span></button>` : "";
  const fill = options.showFill ? `<button type="button" class="rect-tb-color-btn rect-tb-fill-btn" title="Цвет заливки"><span class="rect-tb-color-icon">${BUCKET}</span><span class="rect-tb-color-bar" style="background:${options.fillColor};opacity:${(options.fillOpacity ?? 100) / 100}"></span></button>` : "";
  const text = options.showText ? `<button type="button" class="rect-tb-color-btn rect-tb-text-btn trend-toolbar-text" title="Текст"><span class="rect-tb-color-icon rect-tb-text-letter">T</span><span class="rect-tb-color-bar" style="background:${options.textColor ?? options.lineColor}"></span></button>` : "";
  const lock = options.showLock ? `<div class="rect-toolbar-sep"></div><button type="button" class="rect-tb-lock rect-tb-icon-btn" title="${options.locked ? "Разблокировать" : "Заблокировать"}"${options.locked ? ` data-active="1"` : ""}>${lockIcon(Boolean(options.locked))}</button>` : "";
  const showTemplates = options.showTemplates !== false;
  const templates = showTemplates
    ? `<div class="rect-toolbar-sep"></div><button type="button" class="rect-tb-templates rect-tb-icon-btn" title="Шаблоны">${templatesIcon}</button>`
    : "";
  const afterGrip = showColor || options.showFill || options.showText ? `<div class="rect-toolbar-sep"></div>` : "";
  div.innerHTML = `<div class="rect-toolbar-row">
    <div class="rect-tb-grip" title="Переместить панель"><svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="6" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/><circle cx="6" cy="12" r="1.5"/></svg></div>
    ${templates}${afterGrip}${color}${fill}${text}
    <div class="rect-toolbar-sep"></div>
    <button type="button" class="rect-tb-width-btn">${LINE}<span class="rect-tb-width-label">${options.width}px</span></button>
    <button type="button" class="rect-tb-style-btn">${drawingStyleIcon(options.style)}</button>
    ${lock}
    <div class="rect-toolbar-sep"></div>
    <button type="button" class="rect-tb-del rect-tb-icon-btn trend-toolbar-delete" title="Удалить">${DELETE}</button>
  </div>`;
  return div;
}
