import { openColorPalette } from "./colorPalette";
import { createDrawingToolbar, drawingStyleIcon, toolbarLockIcon, type DrawingLineStyle, type DrawingToolbarOptions } from "./DrawingToolbar";
import {
  deleteDrawingTemplate,
  getDefaultDrawingTemplateState,
  rememberDrawingStyle,
  listDrawingTemplates,
  saveDrawingTemplate,
  type DrawingTemplateKind,
  type DrawingTemplateState,
} from "./drawingTemplates";
import { mountFloatingPanel } from "./floatingPanel";
import { mountAnchoredPopup } from "./popup";
import { hexToRgba } from "./colorUtils";
import removeDrawingIcon from "../icons/ui/remove-drawing.svg?raw";

export interface DrawingToolbarState {
  lineColor: string;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  text?: string;
  showLabel?: boolean;
  width: number;
  style: DrawingLineStyle;
  locked?: boolean;
  levels?: DrawingTemplateState["levels"];
}

export interface DrawingToolbarPatch {
  lineColor?: string;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  text?: string;
  showLabel?: boolean;
  width?: number;
  style?: DrawingLineStyle;
  locked?: boolean;
  levels?: DrawingTemplateState["levels"];
}

export type DrawingToolbarPreset = "full" | "stroke" | "line-only" | "channel" | "actions" | "none";

export type ToolbarSlotAnchor =
  | "after-grip"
  | "before-width"
  | "after-style"
  | "before-lock"
  | "before-delete";

export interface ToolbarSlotContext<T> {
  drawing: T;
  patch: (patch: DrawingToolbarPatch) => void;
  sync: () => void;
  closePopups: () => void;
  container: HTMLElement;
}

export interface ToolbarSlot<T> {
  id: string;
  anchor: ToolbarSlotAnchor;
  mount: (drawing: T) => HTMLElement;
  bind?: (element: HTMLElement, ctx: ToolbarSlotContext<T>) => void;
}

export interface DrawingToolbarControllerOptions<T> {
  container: HTMLElement;
  enabled?: boolean;
  preset?: DrawingToolbarPreset;
  className?: string;
  templateKind: DrawingTemplateKind;
  persistenceKey: (drawing: T) => string;
  getState: (drawing: T) => DrawingToolbarState;
  onPatch: (drawing: T, patch: DrawingToolbarPatch) => void;
  onDelete: (drawing: T) => void;
  onSync?: () => void;
  slots?: ToolbarSlot<T>[];
  onTextButtonClick?: (drawing: T, anchor: HTMLElement) => void;
  /**
   * Актуальный объект фигуры по id. Нужен, когда инструмент заменяет элемент
   * в массиве при каждом update (fib levels) — иначе тулбар держит stale-копию
   * и шаблон сохраняет/применяет старые уровни.
   */
  resolveDrawing?: (drawing: T) => T;
}

const PRESET_OPTIONS: Record<Exclude<DrawingToolbarPreset, "none">, Partial<DrawingToolbarOptions>> = {
  full: {
    showColor: true,
    showFill: true,
    showText: true,
    showLock: true,
  },
  stroke: {
    showColor: true,
    showFill: false,
    showText: false,
    showLock: true,
  },
  "line-only": {
    showColor: false,
    showFill: false,
    showText: false,
    showLock: true,
  },
  channel: {
    showColor: true,
    showFill: true,
    showText: false,
    showLock: true,
  },
  actions: {
    showColor: false,
    showFill: false,
    showText: false,
    showLock: true,
    showTemplates: false,
    showWidth: false,
    showStyle: false,
  },
};

function templateStateFromToolbar(state: DrawingToolbarState): DrawingTemplateState {
  return {
    lineColor: state.lineColor,
    ...(state.fillColor != null ? { fillColor: state.fillColor } : {}),
    ...(state.fillOpacity != null ? { fillOpacity: state.fillOpacity } : {}),
    ...(state.textColor != null ? { textColor: state.textColor } : {}),
    ...(state.text != null ? { text: state.text } : {}),
    ...(state.showLabel != null ? { showLabel: state.showLabel } : {}),
    width: state.width,
    style: state.style,
    ...(state.levels?.length ? { levels: state.levels.map((level) => ({ ...level })) } : {}),
  };
}

function templatePatchFromState(state: DrawingTemplateState): DrawingToolbarPatch {
  return {
    lineColor: state.lineColor,
    ...(state.fillColor != null ? { fillColor: state.fillColor } : {}),
    ...(state.fillOpacity != null ? { fillOpacity: state.fillOpacity } : {}),
    ...(state.textColor != null ? { textColor: state.textColor } : {}),
    ...(state.text != null ? { text: state.text } : {}),
    ...(state.showLabel != null ? { showLabel: state.showLabel } : {}),
    width: state.width,
    style: state.style,
    ...(state.levels?.length ? { levels: state.levels.map((level) => ({ ...level })) } : {}),
  };
}

function createSeparator(): HTMLDivElement {
  const sep = document.createElement("div");
  sep.className = "rect-toolbar-sep";
  return sep;
}

function findAnchorElement(row: HTMLElement, anchor: ToolbarSlotAnchor): HTMLElement | null {
  switch (anchor) {
    case "after-grip":
      return row.querySelector<HTMLElement>(".rect-tb-grip");
    case "before-width":
      return row.querySelector<HTMLElement>(".rect-tb-width-btn");
    case "after-style":
      return row.querySelector<HTMLElement>(".rect-tb-style-btn");
    case "before-lock":
      return row.querySelector<HTMLElement>(".rect-tb-lock");
    case "before-delete":
      return row.querySelector<HTMLElement>(".rect-tb-del");
    default:
      return null;
  }
}

function insertSlot(row: HTMLElement, anchor: ToolbarSlotAnchor, element: HTMLElement) {
  const target = findAnchorElement(row, anchor);
  if (!target) return;
  const insertBeforeAnchor = anchor === "before-width" || anchor === "before-lock" || anchor === "before-delete";
  if (insertBeforeAnchor) {
    const prev = target.previousElementSibling;
    if (!prev?.classList.contains("rect-toolbar-sep")) {
      row.insertBefore(createSeparator(), target);
    }
    row.insertBefore(element, target);
    return;
  }
  target.insertAdjacentElement("afterend", element);
  element.insertAdjacentElement("afterend", createSeparator());
}

export class DrawingToolbarController<T> {
  private panel: HTMLDivElement | null = null;
  private currentDrawing: T | null = null;
  private currentState: DrawingToolbarState | null = null;
  private cleanupPopup: (() => void) | null = null;
  private cleanupDrag: (() => void) | null = null;
  private slotCleanups: Array<() => void> = [];

  constructor(private readonly options: DrawingToolbarControllerOptions<T>) {}

  get enabled(): boolean {
    return this.options.enabled !== false && this.options.preset !== "none";
  }

  private live(drawing: T): T {
    return this.options.resolveDrawing?.(drawing) ?? drawing;
  }

  show(drawing: T): void {
    if (!this.enabled) return;
    this.hide();
    this.currentDrawing = this.live(drawing);
    this.mount(this.currentDrawing);
  }

  hide(): void {
    this.closePopups();
    this.slotCleanups.forEach((cleanup) => cleanup());
    this.slotCleanups = [];
    this.cleanupDrag?.();
    this.cleanupDrag = null;
    this.panel?.remove();
    this.panel = null;
    this.currentDrawing = null;
    this.currentState = null;
  }

  refresh(): void {
    if (!this.enabled || !this.currentDrawing || !this.panel) return;
    this.currentDrawing = this.live(this.currentDrawing);
    // Всегда читаем актуальное состояние фигуры — уровни fib меняются в settings.
    this.currentState = this.options.getState(this.currentDrawing);
    this.applyState(this.currentState);
  }

  /** Открыть меню шаблонов с произвольного якоря (кнопка Template в settings). */
  openTemplatesFrom(anchor: Element): void {
    if (!this.enabled || !this.currentDrawing) return;
    this.currentDrawing = this.live(this.currentDrawing);
    this.openTemplatesMenu(anchor, this.currentDrawing);
  }

  destroy(): void {
    this.hide();
  }

  private mount(drawing: T): void {
    const state = this.options.getState(drawing);
    this.currentState = state;
    const preset = this.options.preset ?? "line-only";
    const presetOptions = preset === "none" ? {} : PRESET_OPTIONS[preset];
    const panel = createDrawingToolbar({
      className: this.options.className,
      lineColor: state.lineColor,
      fillColor: state.fillColor,
      fillOpacity: state.fillOpacity,
      textColor: state.textColor ?? state.lineColor,
      width: state.width,
      style: state.style,
      locked: Boolean(state.locked),
      ...presetOptions,
    });
    this.options.container.appendChild(panel);
    this.panel = panel;

    const row = panel.querySelector<HTMLElement>(".rect-toolbar-row");
    if (row && this.options.slots?.length) {
      this.options.slots.forEach((slot) => {
        const element = slot.mount(drawing);
        element.dataset.toolbarSlot = slot.id;
        insertSlot(row, slot.anchor, element);
        if (slot.bind) {
          slot.bind(element, this.createSlotContext());
        }
      });
    }

    const grip = panel.querySelector<HTMLElement>(".rect-tb-grip");
    if (grip) {
      this.cleanupDrag = mountFloatingPanel({
        container: this.options.container,
        panel,
        grip,
        persistenceKey: this.options.persistenceKey(drawing),
        onDragStart: () => this.closePopups(),
      });
    }

    this.bindStandardActions(drawing, presetOptions);
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  private createSlotContext(): ToolbarSlotContext<T> {
    const drawing = this.currentDrawing!;
    return {
      drawing,
      container: this.options.container,
      patch: (patch) => {
        this.patchDrawing(drawing, patch);
      },
      sync: () => this.options.onSync?.(),
      closePopups: () => this.closePopups(),
    };
  }

  private bindStandardActions(
    drawing: T,
    preset: Partial<DrawingToolbarOptions>,
  ) {
    const panel = this.panel!;

    panel.querySelector<HTMLElement>(".rect-tb-border-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleColorPalette("line", event.currentTarget as HTMLElement, drawing, false);
    });
    panel.querySelector<HTMLElement>(".rect-tb-fill-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleColorPalette("fill", event.currentTarget as HTMLElement, drawing, true);
    });
    panel.querySelector<HTMLElement>(".rect-tb-text-btn, .trend-toolbar-text")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.options.onTextButtonClick) {
        this.closePopups();
        this.options.onTextButtonClick(drawing, event.currentTarget as HTMLElement);
        return;
      }
      this.toggleColorPalette("text", event.currentTarget as HTMLElement, drawing, false);
    });

    panel.querySelector<HTMLElement>(".rect-tb-width-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openCompactMenu("width", event.currentTarget as Element, drawing);
    });
    panel.querySelector<HTMLElement>(".rect-tb-style-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openCompactMenu("style", event.currentTarget as Element, drawing);
    });
    panel.querySelector<HTMLElement>(".rect-tb-lock")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const current = this.currentState ?? this.options.getState(drawing);
      this.patchDrawing(drawing, { locked: !current.locked });
    });
    panel.querySelector<HTMLElement>(".rect-tb-del")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.options.onDelete(drawing);
    });
    panel.querySelector<HTMLElement>(".rect-tb-templates")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openTemplatesMenu(event.currentTarget as Element, drawing);
    });

    this.applyState(this.currentState ?? this.options.getState(drawing));
  }

  private patchDrawing(drawing: T, patch: DrawingToolbarPatch): void {
    const target = this.live(drawing);
    this.currentDrawing = target;
    this.options.onPatch(target, patch);
    // Выбор в панели становится оформлением по умолчанию для следующих фигур
    // этого типа — как в TradingView. Содержимое и блокировка отсеиваются внутри.
    rememberDrawingStyle(this.options.templateKind, patch);
    // После onPatch фигура могла снова замениться в сторе — читаем live state.
    this.currentDrawing = this.live(target);
    this.currentState = this.options.getState(this.currentDrawing);
    this.applyState(this.currentState);
    this.options.onSync?.();
  }

  private applyState(state: DrawingToolbarState) {
    if (!this.panel) return;
    const panel = this.panel;
    panel.querySelector<HTMLElement>(".rect-tb-border-btn .rect-tb-color-bar, .trend-toolbar-color .rect-tb-color-bar")
      ?.style.setProperty("background", state.lineColor);
    const fillBar = panel.querySelector<HTMLElement>(".rect-tb-fill-btn .rect-tb-color-bar");
    if (fillBar && state.fillColor != null) {
      fillBar.style.setProperty("--fill-color", hexToRgba(state.fillColor, state.fillOpacity ?? 100));
      fillBar.classList.toggle("is-checkered", (state.fillOpacity ?? 100) < 100);
    }
    panel.querySelector<HTMLElement>(".rect-tb-text-btn .rect-tb-color-bar")
      ?.style.setProperty("background", state.textColor ?? state.lineColor);
    const widthLabel = panel.querySelector<HTMLElement>(".rect-tb-width-label");
    if (widthLabel) widthLabel.textContent = `${state.width}px`;
    const styleBtn = panel.querySelector<HTMLElement>(".rect-tb-style-btn");
    if (styleBtn) styleBtn.innerHTML = drawingStyleIcon(state.style);
    const lockBtn = panel.querySelector<HTMLElement>(".rect-tb-lock");
    if (lockBtn) {
      lockBtn.dataset.active = state.locked ? "1" : "";
      lockBtn.title = state.locked ? "Разблокировать" : "Заблокировать";
      lockBtn.setAttribute("aria-pressed", state.locked ? "true" : "false");
      lockBtn.innerHTML = toolbarLockIcon(Boolean(state.locked));
    }
  }

  private toggleColorPalette(
    target: "line" | "fill" | "text",
    anchor: HTMLElement,
    drawing: T,
    withOpacity: boolean,
  ) {
    if (this.cleanupPopup) {
      this.closePopups();
      return;
    }
    const state = this.options.getState(drawing);
    const color = target === "line"
      ? state.lineColor
      : target === "fill"
        ? state.fillColor ?? state.lineColor
        : state.textColor ?? state.lineColor;
    this.cleanupPopup = openColorPalette({
      container: this.options.container,
      anchor,
      verticalAnchor: this.panel ?? undefined,
      color,
      opacity: withOpacity ? state.fillOpacity ?? 100 : undefined,
      onColor: (nextColor) => {
        const patch: DrawingToolbarPatch = target === "line"
          ? { lineColor: nextColor }
          : target === "fill"
            ? { fillColor: nextColor }
            : { textColor: nextColor };
        this.patchDrawing(drawing, patch);
      },
      onOpacity: withOpacity
        ? (opacity) => {
            this.patchDrawing(drawing, { fillOpacity: opacity });
          }
        : undefined,
      onDismiss: () => { this.cleanupPopup = null; },
    });
  }

  private openCompactMenu(kind: "width" | "style", anchor: Element, drawing: T) {
    this.closePopups();
    const menu = document.createElement("div");
    menu.className = "rect-line-menu";
    const state = this.options.getState(drawing);
    const entries = kind === "width"
      ? [1, 2, 3, 4].map((value) => ({
          value: String(value),
          label: `${value}px`,
          icon: `<span class="rect-line-sample" style="height:${value}px"></span>`,
          active: state.width === value,
        }))
      : (["solid", "dashed", "dotted"] as const).map((value) => ({
          value,
          label: value === "solid" ? "Line" : `${value[0].toUpperCase()}${value.slice(1)} line`,
          icon: drawingStyleIcon(value),
          active: state.style === value,
        }));

    entries.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rect-line-menu-item${entry.active ? " is-active" : ""}`;
      button.innerHTML = `<span class="rect-line-menu-icon">${entry.icon}</span><span>${entry.label}</span>`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (kind === "width") this.patchDrawing(drawing, { width: Number(entry.value) });
        else this.patchDrawing(drawing, { style: entry.value as DrawingLineStyle });
        this.closePopups();
      });
      menu.appendChild(button);
    });

    this.cleanupPopup = mountAnchoredPopup({
      container: this.options.container,
      anchor,
      verticalAnchor: this.panel ?? undefined,
      popup: menu,
      width: kind === "width" ? 104 : 168,
      onDismiss: () => { this.cleanupPopup = null; },
    });
  }

  private applyTemplate(drawing: T, state: DrawingTemplateState) {
    this.patchDrawing(this.live(drawing), templatePatchFromState(state));
  }

  private openTemplatesMenu(anchor: Element, drawing: T) {
    if (this.cleanupPopup) {
      this.closePopups();
      return;
    }

    const target = this.live(drawing);
    this.currentDrawing = target;

    const menu = document.createElement("div");
    menu.className = "rect-templates-menu";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "rect-line-menu-item rect-templates-action";
    saveBtn.textContent = "Сохранить шаблон как…";
    saveBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const name = window.prompt("Имя шаблона");
      if (name == null) return;
      const live = this.live(target);
      // Берём state с фигуры, не кэш тулбара — иначе fib levels не попадут в шаблон.
      const current = templateStateFromToolbar(this.options.getState(live));
      saveDrawingTemplate(this.options.templateKind, name, current);
      this.closePopups();
    });
    menu.appendChild(saveBtn);

    const defaultBtn = document.createElement("button");
    defaultBtn.type = "button";
    defaultBtn.className = "rect-line-menu-item rect-templates-action";
    defaultBtn.textContent = "Применить шаблон по умолчанию";
    defaultBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.applyTemplate(target, getDefaultDrawingTemplateState(this.options.templateKind));
      this.closePopups();
    });
    menu.appendChild(defaultBtn);

    const templates = listDrawingTemplates(this.options.templateKind);
    if (templates.length > 0) {
      const sep = document.createElement("div");
      sep.className = "rect-templates-sep";
      menu.appendChild(sep);
    }

    templates.forEach((template) => {
      const row = document.createElement("div");
      row.className = "rect-templates-row";

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "rect-line-menu-item rect-templates-item";
      applyBtn.textContent = template.name;
      applyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        // Перечитываем из storage — на случай если state в списке устарел.
        const fresh = listDrawingTemplates(this.options.templateKind).find((item) => item.id === template.id);
        this.applyTemplate(target, fresh?.state ?? template.state);
        this.closePopups();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "rect-templates-delete";
      deleteBtn.title = "Удалить шаблон";
      deleteBtn.innerHTML = removeDrawingIcon;
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteDrawingTemplate(template.id);
        this.closePopups();
        this.openTemplatesMenu(anchor, drawing);
      });

      row.appendChild(applyBtn);
      row.appendChild(deleteBtn);
      menu.appendChild(row);
    });

    this.cleanupPopup = mountAnchoredPopup({
      container: this.options.container,
      anchor,
      verticalAnchor: this.panel ?? undefined,
      popup: menu,
      width: 248,
      onDismiss: () => { this.cleanupPopup = null; },
    });
  }

  private closePopups() {
    this.cleanupPopup?.();
    this.cleanupPopup = null;
  }
}
