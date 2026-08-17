export interface PanelPosition { left: number; top: number }

export type FloatingPanelPlacement = "center" | "top-right";

const positions = new Map<string, PanelPosition>();

/** Ширина правой шкалы цен из CSS-переменной workspace (см. ReplayChart). */
function resolvePriceScaleWidth(container: HTMLElement): number {
  let el: HTMLElement | null = container;
  while (el) {
    const raw = getComputedStyle(el).getPropertyValue("--chart-price-scale-width").trim();
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value > 0) return value;
    el = el.parentElement;
  }
  return 0;
}

/**
 * Правый край плота (до шкалы цен) в координатах container.
 * Берём canvas основной панели — CSS-переменная иногда шире реальной шкалы.
 */
function resolvePlotRight(container: HTMLElement, containerWidth: number): number {
  const containerRect = container.getBoundingClientRect();
  let plotRight = 0;
  container.querySelectorAll("table td canvas").forEach((node) => {
    if (!(node instanceof HTMLCanvasElement)) return;
    const rect = node.getBoundingClientRect();
    const left = rect.left - containerRect.left;
    // Плот слева; canvas шкалы цен сидит правее.
    if (left < 24 && rect.width > plotRight) plotRight = rect.width;
  });
  if (plotRight > 50) return plotRight;
  const scaleWidth = resolvePriceScaleWidth(container);
  return Math.max(0, containerWidth - scaleWidth);
}

export function mountFloatingPanel(options: {
  container: HTMLElement;
  panel: HTMLElement;
  grip: HTMLElement;
  persistenceKey: string;
  inset?: number;
  /** Куда ставить панель при первом открытии (без сохранённой позиции). */
  placement?: FloatingPanelPlacement;
  onDragStart?: () => void;
}): () => void {
  const { container, panel, grip, persistenceKey, onDragStart } = options;
  const inset = options.inset ?? 12;
  const placement = options.placement ?? "top-right";

  const contentBounds = () => {
    const bounds = container.getBoundingClientRect();
    const plotRight = resolvePlotRight(container, bounds.width);
    // Один и тот же inset: сверху от края и справа от границы плота/шкалы.
    const rightPad = Math.max(inset, bounds.width - plotRight + inset);
    return {
      width: bounds.width,
      height: bounds.height,
      plotRight,
      rightPad,
      maxLeft: (panelWidth: number) => Math.max(inset, bounds.width - panelWidth - rightPad),
      maxTop: (panelHeight: number) => Math.max(inset, bounds.height - panelHeight - inset),
    };
  };

  const defaultPosition = (): PanelPosition => {
    const { height, plotRight, maxLeft, maxTop } = contentBounds();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    if (placement === "center") {
      const plotWidth = Math.max(0, plotRight - inset);
      return {
        left: Math.max(inset, inset + (plotWidth - panelWidth) / 2),
        top: Math.max(inset, (height - panelHeight) / 2),
      };
    }
    return {
      left: maxLeft(panelWidth),
      top: Math.min(inset, maxTop(panelHeight)),
    };
  };

  const place = (position?: PanelPosition) => {
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    // До layout width/height = 0 → maxLeft ≈ ширина контейнера, панель уезжает за край.
    if (panelWidth < 2 || panelHeight < 2) return;
    const { maxLeft, maxTop } = contentBounds();
    const source = position ?? defaultPosition();
    panel.style.left = `${Math.max(inset, Math.min(source.left, maxLeft(panelWidth)))}px`;
    panel.style.top = `${Math.max(inset, Math.min(source.top, maxTop(panelHeight)))}px`;
  };

  const saved = positions.get(persistenceKey);
  place(saved);
  // После отрисовки body / слотов тулбара пересчитать — иначе первый кадр кривой.
  const rafId = requestAnimationFrame(() => {
    place(positions.get(persistenceKey) ?? saved);
  });

  let removeActiveListeners: (() => void) | null = null;
  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDragStart?.();
    const host = container.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: bounds.left - host.left, top: bounds.top - host.top };
    const move = (next: PointerEvent) => {
      const { maxLeft, maxTop } = contentBounds();
      const position = {
        left: Math.max(inset, Math.min(start.left + next.clientX - start.x, maxLeft(panel.offsetWidth))),
        top: Math.max(inset, Math.min(start.top + next.clientY - start.y, maxTop(panel.offsetHeight))),
      };
      positions.set(persistenceKey, position);
      place(position);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      removeActiveListeners = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    removeActiveListeners = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  };
  grip.addEventListener("pointerdown", onPointerDown);
  return () => {
    cancelAnimationFrame(rafId);
    removeActiveListeners?.();
    grip.removeEventListener("pointerdown", onPointerDown);
  };
}

export function forgetFloatingPanelPosition(key: string): void {
  positions.delete(key);
}
