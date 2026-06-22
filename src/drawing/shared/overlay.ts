const SVG_NS = "http://www.w3.org/2000/svg";

export interface DrawingOverlay {
  svg: SVGSVGElement;
  createClippedGroup(): SVGGElement;
  sync(): void;
  remove(): void;
}

export function createDrawingOverlay(container: HTMLElement, chart: any, className: string): DrawingOverlay {
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

  const sync = () => {
    clipRect.setAttribute("x", "0");
    clipRect.setAttribute("y", "0");
    clipRect.setAttribute("width", String(Math.max(0, Number(chart.timeScale().width()) || 0)));
    clipRect.setAttribute("height", String(container.getBoundingClientRect().height));
  };
  sync();

  return {
    svg,
    sync,
    createClippedGroup() {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("clip-path", `url(#${clipId})`);
      svg.appendChild(group);
      return group;
    },
    remove: () => svg.remove(),
  };
}
