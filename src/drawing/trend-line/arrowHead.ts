export interface PixelPoint {
  x: number;
  y: number;
}

export interface ArrowHeadGeometry {
  tip: PixelPoint;
  left: PixelPoint;
  right: PixelPoint;
  /** Конец стержня чуть раньше острия, чтобы обводка не вылезала из V. */
  shaftEnd: PixelPoint;
}

/**
 * Открытый шеврон как у Arrow на TradingView: размер в пикселях, от длины
 * линии не зависит — иначе на коротком отрезке наконечник раздувался бы,
 * а на длинном терялся.
 */
export function arrowHeadGeometry(
  from: PixelPoint,
  to: PixelPoint,
  width: number,
): ArrowHeadGeometry | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return null;
  const ux = dx / length;
  const uy = dy / length;
  let headLen = 8 + width * 2.4;
  let headWidth = 5 + width * 1.45;
  const maxLen = length * 0.45;
  if (headLen > maxLen) {
    const scale = maxLen / headLen;
    headLen *= scale;
    headWidth *= scale;
  }
  const nx = -uy;
  const ny = ux;
  const baseX = to.x - ux * headLen;
  const baseY = to.y - uy * headLen;
  return {
    tip: to,
    left: { x: baseX + nx * headWidth, y: baseY + ny * headWidth },
    right: { x: baseX - nx * headWidth, y: baseY - ny * headWidth },
    shaftEnd: { x: to.x - ux * headLen * 0.28, y: to.y - uy * headLen * 0.28 },
  };
}

export function arrowHeadPointsAttr(head: ArrowHeadGeometry): string {
  return `${head.left.x},${head.left.y} ${head.tip.x},${head.tip.y} ${head.right.x},${head.right.y}`;
}
