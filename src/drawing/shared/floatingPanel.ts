export interface PanelPosition { left: number; top: number }

const positions = new Map<string, PanelPosition>();

export function mountFloatingPanel(options: {
  container: HTMLElement;
  panel: HTMLElement;
  grip: HTMLElement;
  persistenceKey: string;
  inset?: number;
  onDragStart?: () => void;
}): () => void {
  const { container, panel, grip, persistenceKey, onDragStart } = options;
  const inset = options.inset ?? 12;
  const place = (position?: PanelPosition) => {
    const bounds = container.getBoundingClientRect();
    const maxLeft = Math.max(inset, bounds.width - panel.offsetWidth - inset);
    const maxTop = Math.max(inset, bounds.height - panel.offsetHeight - inset);
    const left = position ? Math.max(inset, Math.min(position.left, maxLeft)) : maxLeft;
    const top = position ? Math.max(inset, Math.min(position.top, maxTop)) : inset;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  place(positions.get(persistenceKey));

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
    removeActiveListeners?.();
    grip.removeEventListener("pointerdown", onPointerDown);
  };
}

export function forgetFloatingPanelPosition(key: string): void {
  positions.delete(key);
}
