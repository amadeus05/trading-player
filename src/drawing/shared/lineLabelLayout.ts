export interface PixelPoint {
  x: number;
  y: number;
}

export interface LineLabelLayout {
  x: number;
  y: number;
  angle: number;
  /** Длина линии в пикселях — по ней инструмент задаёт лейблу постоянную ширину. */
  length: number;
}

const LABEL_LINE_GAP = 16;

export function lineLabelLayout(p1: PixelPoint, p2: PixelPoint, gap = LABEL_LINE_GAP): LineLabelLayout {
  const xMid = (p1.x + p2.x) / 2;
  const yMid = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy) || 1;

  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;

  let normalX = -dy / length;
  let normalY = dx / length;
  // Наклонные линии подписываем сверху. У вертикальной «сверху» не существует:
  // нормаль горизонтальна, normalY равен нулю, и прежнее условие её не трогало —
  // подпись уходила влево. Такую линию подписываем справа.
  const vertical = Math.abs(normalY) < 1e-6;
  if (vertical ? normalX < 0 : normalY > 0) {
    normalX = -normalX;
    normalY = -normalY;
  }

  return {
    x: xMid + normalX * gap,
    y: yMid + normalY * gap,
    angle,
    length,
  };
}
