/** hex (#rgb / #rrggbb) + непрозрачность в процентах (0–100) → CSS-цвет. */
export function hexToRgba(hex: string, opacity: number): string {
  if (opacity === 0) return "transparent";
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity / 100))})`;
}
