const SVG_NS = "http://www.w3.org/2000/svg";

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

function buildOverlaySvg(container: HTMLElement, className: string): SharedOverlayEntry {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add(className);
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
  chart: any,
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

export function createDrawingOverlay(container: HTMLElement, chart: any, className: string): DrawingOverlay {
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
