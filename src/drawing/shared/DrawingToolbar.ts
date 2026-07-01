export type DrawingLineStyle = "solid" | "dashed" | "dotted";

const FILL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true"><path stroke="currentColor" d="M13.5 6.5l-3-3-7 7 7.59 7.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82L13.5 6.5zm0 0v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6"></path><path fill="currentColor" d="M0 16.5C0 15 2.5 12 2.5 12S5 15 5 16.5 4 19 2.5 19 0 18 0 16.5z"></path><circle fill="currentColor" cx="9.5" cy="9.5" r="1.5"></circle></svg>`;
const LINE_COLOR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10.62.72a2.47 2.47 0 0 1 3.5 0l1.16 1.16c.96.97.96 2.54 0 3.5l-.58.58-8.9 8.9-1 1-.14.14H0v-4.65l.14-.15 1-1 8.9-8.9.58-.58Zm2.8.7a1.48 1.48 0 0 0-2.1 0l-.23.23 3.26 3.26.23-.23c.58-.58.58-1.52 0-2.1l-1.16-1.16Zm.23 4.2-3.26-3.27-8.2 8.2 3.25 3.27 8.2-8.2Zm-8.9 8.9-3.27-3.26-.5.5V15h3.27l.5-.5Z"></path></svg>`;
const TEXT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 15" width="13" height="15" fill="none" aria-hidden="true"><path stroke="currentColor" d="M4 14.5h2.5m2.5 0H6.5m0 0V.5m0 0h-5a1 1 0 0 0-1 1V4m6-3.5h5a1 1 0 0 1 1 1V4"></path></svg>`;
const UNLOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M14 6a3 3 0 0 0-3 3v3h8.5a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 6 21.5v-7A2.5 2.5 0 0 1 8.5 12H10V9a4 4 0 0 1 8 0h-1a3 3 0 0 0-3-3zm-1 11a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0v-2zm-6-2.5c0-.83.67-1.5 1.5-1.5h11c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 7 21.5v-7z"></path></svg>`;
const LOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M14 5a4 4 0 0 0-4 4v3H8.5A2.5 2.5 0 0 0 6 14.5v7A2.5 2.5 0 0 0 8.5 24h11a2.5 2.5 0 0 0 2.5-2.5v-7a2.5 2.5 0 0 0-2.5-2.5H18V9a4 4 0 0 0-4-4zm3 7V9a3 3 0 1 0-6 0v3h6zm-4 5a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0v-2zm-6-2.5c0-.83.67-1.5 1.5-1.5h11c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 7 21.5v-7z"></path></svg>`;
const TEMPLATES_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" d="M15.5 18.5h6m-3 3v-6"></path><rect width="6" height="6" rx="1.5" x="6.5" y="6.5"></rect><rect width="6" height="6" rx="1.5" x="15.5" y="6.5"></rect><rect width="6" height="6" rx="1.5" x="6.5" y="15.5"></rect></svg>`;
const LINE = `<svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><line x1="0" y1="5" x2="14" y2="5" stroke="currentColor" stroke-width="1.5"/></svg>`;
const DELETE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" fill="none" aria-hidden="true"><path d="M4.5 5.5h9M7 5.5V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M6.5 5.5l.5 9a1 1 0 0 0 1 .9h2a1 1 0 0 0 1-.9l.5-9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function drawingStyleIcon(style: DrawingLineStyle): string {
  const dash = style === "dashed" ? ` stroke-dasharray="4 3"` : style === "dotted" ? ` stroke-dasharray="2 3"` : "";
  return `<svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2"${dash}/></svg>`;
}

export function toolbarLockIcon(locked: boolean): string {
  return locked ? LOCK_ICON : UNLOCK_ICON;
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
  const color = showColor ? `<button type="button" class="rect-tb-color-btn rect-tb-border-btn trend-toolbar-color" title="Цвет линии"><span class="rect-tb-color-icon">${LINE_COLOR_ICON}</span><span class="rect-tb-color-bar" style="background:${options.lineColor}"></span></button>` : "";
  const fill = options.showFill ? `<button type="button" class="rect-tb-color-btn rect-tb-fill-btn" title="Цвет заливки"><span class="rect-tb-color-icon">${FILL_ICON}</span><span class="rect-tb-color-bar" style="background:${options.fillColor};opacity:${(options.fillOpacity ?? 100) / 100}"></span></button>` : "";
  const text = options.showText ? `<button type="button" class="rect-tb-color-btn rect-tb-text-btn trend-toolbar-text" title="Текст"><span class="rect-tb-color-icon">${TEXT_ICON}</span><span class="rect-tb-color-bar" style="background:${options.textColor ?? options.lineColor}"></span></button>` : "";
  const lock = options.showLock ? `<div class="rect-toolbar-sep"></div><button type="button" class="rect-tb-lock rect-tb-icon-btn" title="${options.locked ? "Разблокировать" : "Заблокировать"}"${options.locked ? ` data-active="1"` : ""} aria-pressed="${options.locked ? "true" : "false"}">${toolbarLockIcon(Boolean(options.locked))}</button>` : "";
  const showTemplates = options.showTemplates !== false;
  const templates = showTemplates
    ? `<div class="rect-toolbar-sep"></div><button type="button" class="rect-tb-templates rect-tb-icon-btn" title="Шаблоны">${TEMPLATES_ICON}</button>`
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
