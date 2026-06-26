import type { IChartApi } from "lightweight-charts";

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAWING_OVERLAY_ATTRIBUTE = "data-drawing-overlay";
const wheelForwardingContainers = new WeakSet<HTMLElement>();

export interface DrawingOverlay {
  svg: SVGSVGElement;
  createClippedGroup(): SVGGElement;
  sync(): void;
  remove(): void;
}

interface SharedOverlayEntry {
  svg: SVGSVGElement;
  clipRect: SVGRectElement;
  clipId: string;
  refs: number;
}

const sharedByContainer = new WeakMap<HTMLElement, Map<string, SharedOverlayEntry>>();

const WHEEL_FORWARD_SELECTOR = [
  `svg[${DRAWING_OVERLAY_ATTRIBUTE}]`,
  ".trend-line-label",
  ".drawing-inline-text-editor",
].join(", ");

function ensureWheelForwarding(container: HTMLElement): void {
  if (wheelForwardingContainers.has(container)) return;
  wheelForwardingContainers.add(container);
  container.addEventListener("wheel", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(WHEEL_FORWARD_SELECTOR)) {
      return;
    }
    const overlays = Array.from(
      container.querySelectorAll<SVGSVGElement>(`svg[${DRAWING_OVERLAY_ATTRIBUTE}]`),
    );
    const htmlLayers = Array.from(
      container.querySelectorAll<HTMLElement>(WHEEL_FORWARD_SELECTOR),
    ).filter((el) => !(el instanceof SVGSVGElement));
    const overlayVisibility = overlays.map((overlay) => overlay.style.visibility);
    const htmlVisibility = htmlLayers.map((layer) => layer.style.visibility);
    overlays.forEach((overlay) => { overlay.style.visibility = "hidden"; });
    htmlLayers.forEach((layer) => { layer.style.visibility = "hidden"; });
    const underlyingElement = document.elementFromPoint(event.clientX, event.clientY);
    overlays.forEach((overlay, index) => { overlay.style.visibility = overlayVisibility[index]; });
    htmlLayers.forEach((layer, index) => { layer.style.visibility = htmlVisibility[index]; });

    if (underlyingElement && container.contains(underlyingElement)) {
      underlyingElement.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: event.detail,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        button: event.button,
        buttons: event.buttons,
        relatedTarget: event.relatedTarget,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
      }));
    }
    if (event.cancelable) event.preventDefault();
  }, { capture: true, passive: false });
}

function buildOverlaySvg(container: HTMLElement, className: string): SharedOverlayEntry {
  ensureWheelForwarding(container);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add(className);
  svg.setAttribute(DRAWING_OVERLAY_ATTRIBUTE, "true");
  const defs = document.createElementNS(SVG_NS, "defs");
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  const clipRect = document.createElementNS(SVG_NS, "rect");
  const clipId = `drawing-clip-${crypto.randomUUID()}`;
  clipPath.id = clipId;
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svg.appendChild(defs);
  container.appendChild(svg);
  return { svg, clipRect, clipId, refs: 1 };
}

function makeOverlayHandle(
  container: HTMLElement,
  chart: IChartApi,
  entry: SharedOverlayEntry,
  onRemove: () => void,
): DrawingOverlay {
  const sync = () => {
    entry.clipRect.setAttribute("x", "0");
    entry.clipRect.setAttribute("y", "0");
    entry.clipRect.setAttribute("width", String(Math.max(0, Number(chart.timeScale().width()) || 0)));
    entry.clipRect.setAttribute("height", String(container.getBoundingClientRect().height));
  };

  return {
    svg: entry.svg,
    sync,
    createClippedGroup() {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("clip-path", `url(#${entry.clipId})`);
      entry.svg.appendChild(group);
      return group;
    },
    remove: onRemove,
  };
}

export function createDrawingOverlay(
  container: HTMLElement,
  chart: IChartApi,
  className: string,
): DrawingOverlay {
  if (className === "fib-overlay") {
    let classMap = sharedByContainer.get(container);
    if (!classMap) {
      classMap = new Map();
      sharedByContainer.set(container, classMap);
    }

    const existing = classMap.get(className);
    if (existing) {
      existing.refs += 1;
      return makeOverlayHandle(container, chart, existing, () => {
        existing.refs -= 1;
        if (existing.refs <= 0) {
          existing.svg.remove();
          classMap!.delete(className);
          if (classMap!.size === 0) sharedByContainer.delete(container);
        }
      });
    }

    const entry = buildOverlaySvg(container, className);
    classMap.set(className, entry);
    const overlay = makeOverlayHandle(container, chart, entry, () => {
      entry.refs -= 1;
      if (entry.refs <= 0) {
        entry.svg.remove();
        classMap!.delete(className);
        if (classMap!.size === 0) sharedByContainer.delete(container);
      }
    });
    overlay.sync();
    return overlay;
  }

  const entry = buildOverlaySvg(container, className);
  return makeOverlayHandle(container, chart, entry, () => entry.svg.remove());
}
