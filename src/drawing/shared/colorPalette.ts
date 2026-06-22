import { mountAnchoredPopup } from "./popup";

const COLORS = [
  "#ffffff", "#d1d4dc", "#b2b5be", "#9598a1", "#787b86", "#4c525e", "#2a2e39", "#131722",
  "#ffd2d2", "#ffdfc5", "#fff3c2", "#d7f5dc", "#c2eef5", "#c5d8f8", "#d2c5f8", "#f5c2f0",
  "#ff8888", "#ffb36a", "#ffe066", "#66d68a", "#4dd8e0", "#6699f5", "#9580f5", "#f075e8",
  "#ff2727", "#ff6d00", "#ffd600", "#00c853", "#00bcd4", "#2962ff", "#7c4dff", "#e040fb",
  "#c62828", "#e65100", "#f9a825", "#1b5e20", "#006064", "#0d47a1", "#4527a0", "#880e4f",
  "#b71c1c", "#bf360c", "#ff8f00", "#2e7d32", "#00695c", "#1565c0", "#283593", "#6a1b9a",
];

export function openColorPalette(options: {
  container: HTMLElement;
  anchor: Element;
  color: string;
  opacity?: number;
  onColor: (color: string) => void;
  onOpacity?: (opacity: number) => void;
  onDismiss?: () => void;
}): () => void {
  const div = document.createElement("div");
  div.className = "rect-palette";
  const grid = document.createElement("div");
  grid.className = "rect-palette-grid";
  const markActive = (color: string) => {
    grid.querySelectorAll<HTMLElement>(".rect-palette-swatch").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.color === color.toLowerCase());
    });
  };
  COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rect-palette-swatch";
    button.dataset.color = color.toLowerCase();
    button.style.background = color;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onColor(color);
      markActive(color);
    });
    grid.appendChild(button);
  });
  div.appendChild(grid);

  const custom = document.createElement("input");
  custom.type = "color";
  custom.value = /^#[0-9a-f]{6}$/i.test(options.color) ? options.color : "#ffffff";
  custom.className = "rect-palette-custom-color";
  custom.addEventListener("input", () => options.onColor(custom.value));
  div.appendChild(custom);

  if (options.onOpacity) {
    const row = document.createElement("div");
    row.className = "rect-palette-opacity-row";
    const label = document.createElement("span");
    label.className = "rect-palette-op-label";
    label.textContent = "Opacity";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.value = String(options.opacity ?? 100);
    range.className = "rect-palette-op-slider";
    const value = document.createElement("span");
    value.className = "rect-palette-op-value";
    value.textContent = `${range.value}%`;
    range.addEventListener("input", () => {
      value.textContent = `${range.value}%`;
      options.onOpacity?.(Number(range.value));
    });
    row.append(label, range, value);
    div.appendChild(row);
  }
  markActive(options.color);
  return mountAnchoredPopup({ container: options.container, anchor: options.anchor, popup: div, width: 210, onDismiss: options.onDismiss });
}
