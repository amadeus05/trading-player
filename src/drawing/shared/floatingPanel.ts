export interface PanelPosition { left: number; top: number }

export type FloatingPanelPlacement = "center" | "top-right";

const positions = new Map<string, PanelPosition>();

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

  const defaultPosition = (): PanelPosition => {
    const bounds = container.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (placement === "center") {
      return {
        left: Math.max(inset, (bounds.width - width) / 2),
        top: Math.max(inset, (bounds.height - height) / 2),
      };
    }
    return {
      left: Math.max(inset, bounds.width - width - inset),
      top: inset,
    };
  };

  const place = (position?: PanelPosition) => {
    const bounds = container.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    // До layout width/height = 0 → maxLeft ≈ ширина контейнера, панель уезжает за край.
    if (width < 2 || height < 2) return;
    const maxLeft = Math.max(inset, bounds.width - width - inset);
    const maxTop = Math.max(inset, bounds.height - height - inset);
    const source = position ?? defaultPosition();
    panel.style.left = `${Math.max(inset, Math.min(source.left, maxLeft))}px`;
    panel.style.top = `${Math.max(inset, Math.min(source.top, maxTop))}px`;
  };

  const saved = positions.get(persistenceKey);
  place(saved);
  // После отрисовки body (уровни fib и т.п.) пересчитать — иначе первый кадр кривой.
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
      const maxLeft = Math.max(inset, host.width - panel.offsetWidth - inset);
      const maxTop = Math.max(inset, host.height - panel.offsetHeight - inset);
      const position = {
        left: Math.max(inset, Math.min(start.left + next.clientX - start.x, maxLeft)),
        top: Math.max(inset, Math.min(start.top + next.clientY - start.y, maxTop)),
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
