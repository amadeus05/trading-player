import type { DrawingMode } from "./types";
import type { DrawingManager } from "../DrawingManager";

export interface DrawingPointerClickEvent {
  sourceEvent: PointerEvent;
}

interface BindDrawingPointerClickOptions {
  container: HTMLElement;
  chart: {
    timeScale(): {
      width(): number;
      height(): number;
    };
  };
  manager: DrawingManager;
  mode: DrawingMode;
  onClick: (event: DrawingPointerClickEvent) => void;
}

const IGNORED_TARGET_SELECTOR = [
  ".rect-toolbar",
  ".rect-line-menu",
  ".rect-templates-menu",
  ".drawing-inline-text-editor",
  ".measure-tooltip",
].join(", ");

const CLICK_TOLERANCE_PX = 7;

function isIgnoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(IGNORED_TARGET_SELECTOR) != null;
}

function isInsidePlotArea(container: HTMLElement, chart: BindDrawingPointerClickOptions["chart"], event: PointerEvent): boolean {
  const bounds = container.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const plotRight = Math.max(0, chart.timeScale().width());
  const plotBottom = Math.max(0, bounds.height - chart.timeScale().height());
  return x >= 0 && x <= plotRight && y >= 0 && y <= plotBottom;
}

export function bindDrawingPointerClick(options: BindDrawingPointerClickOptions): () => void {
  let pointerDown: { id: number; x: number; y: number } | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || managerMode() !== options.mode || isIgnoredTarget(event.target)) {
      pointerDown = null;
      return;
    }
    if (!isInsidePlotArea(options.container, options.chart, event)) {
      pointerDown = null;
      return;
    }
    pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: PointerEvent) => {
    const down = pointerDown;
    pointerDown = null;
    if (!down || down.id !== event.pointerId || managerMode() !== options.mode || isIgnoredTarget(event.target)) return;
    if (!isInsidePlotArea(options.container, options.chart, event)) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    options.onClick({ sourceEvent: event });
  };

  const managerMode = () => options.manager.getMode();

  options.container.addEventListener("pointerdown", onPointerDown, { capture: true });
  options.container.addEventListener("pointerup", onPointerUp, { capture: true });

  return () => {
    options.container.removeEventListener("pointerdown", onPointerDown, { capture: true });
    options.container.removeEventListener("pointerup", onPointerUp, { capture: true });
  };
}
