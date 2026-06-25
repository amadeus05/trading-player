import type { TrendLine } from "../../types";
import type { ToolbarSlot } from "../shared/DrawingToolbarController";

const EXTEND_LEFT = `<svg width="18" height="16" viewBox="0 0 18 16"><polyline points="7,4 2,8 7,12" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1.6"/></svg>`;
const EXTEND_RIGHT = `<svg width="18" height="16" viewBox="0 0 18 16"><polyline points="11,4 16,8 11,12" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1.6"/></svg>`;

function createExtendButton(direction: "left" | "right", active: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "trend-toolbar-extend rect-tb-icon-btn";
  button.dataset.dir = direction;
  button.title = direction === "left" ? "Продлить влево" : "Продлить вправо";
  if (active) button.dataset.active = "1";
  button.innerHTML = direction === "left" ? EXTEND_LEFT : EXTEND_RIGHT;
  return button;
}

export function createTrendLineExtendSlots(
  getLine: (drawing: TrendLine) => TrendLine | undefined,
  onExtendChange: (drawing: TrendLine, direction: "left" | "right", enabled: boolean) => void,
): ToolbarSlot<TrendLine>[] {
  return [
    {
      id: "extend-left",
      anchor: "before-lock",
      mount: (drawing) => createExtendButton("left", Boolean(drawing.extendLeft)),
      bind: (element, ctx) => {
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const line = getLine(ctx.drawing);
          if (!line) return;
          const next = !line.extendLeft;
          onExtendChange(line, "left", next);
          if (next) element.setAttribute("data-active", "1");
          else element.removeAttribute("data-active");
        });
      },
    },
    {
      id: "extend-right",
      anchor: "before-lock",
      mount: (drawing) => createExtendButton("right", Boolean(drawing.extendRight)),
      bind: (element, ctx) => {
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const line = getLine(ctx.drawing);
          if (!line) return;
          const next = !line.extendRight;
          onExtendChange(line, "right", next);
          if (next) element.setAttribute("data-active", "1");
          else element.removeAttribute("data-active");
        });
      },
    },
  ];
}
