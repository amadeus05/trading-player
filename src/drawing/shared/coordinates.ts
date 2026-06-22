export interface TimeCandle { time: number }
export interface DrawingPoint { time: number; price: number }
export interface PixelPoint { x: number; y: number }

export function timeToLogical(time: number, candles: TimeCandle[]): number | null {
  if (!candles.length) return null;
  let low = 0, high = candles.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time === time) return mid;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid - 1;
  }
  if (high < 0) {
    const step = candles.length > 1 ? candles[1].time - candles[0].time : 60;
    return (time - candles[0].time) / (step || 60);
  }
  if (low >= candles.length) {
    const last = candles.length - 1;
    const step = candles.length > 1 ? candles[last].time - candles[last - 1].time : 60;
    return last + (time - candles[last].time) / (step || 60);
  }
  const step = candles[low].time - candles[high].time;
  return high + (time - candles[high].time) / (step || 60);
}

export function logicalToTime(logical: number, candles: TimeCandle[]): number | null {
  if (!candles.length || !Number.isFinite(logical)) return null;
  if (logical < 0) {
    const step = candles.length > 1 ? candles[1].time - candles[0].time : 60;
    return candles[0].time + logical * (step || 60);
  }
  const last = candles.length - 1;
  if (logical >= last) {
    const step = candles.length > 1 ? candles[last].time - candles[last - 1].time : 60;
    return candles[last].time + (logical - last) * (step || 60);
  }
  const index = Math.floor(logical);
  const fraction = logical - index;
  return candles[index].time + fraction * (candles[index + 1].time - candles[index].time);
}

/** lightweight-charts logicalToCoordinate accepts only integer indices; interpolate for sub-bar times. */
export function logicalToCoordinateFloat(chart: any, logical: number): number | null {
  if (!Number.isFinite(logical)) return null;
  const timeScale = chart.timeScale();
  const base = Math.floor(logical);
  const fraction = logical - base;
  if (fraction === 0) return timeScale.logicalToCoordinate(base);
  const x1 = timeScale.logicalToCoordinate(base);
  const x2 = timeScale.logicalToCoordinate(base + 1);
  if (x1 == null && x2 == null) return null;
  if (x1 == null) return x2;
  if (x2 == null) return x1;
  return x1 + (x2 - x1) * fraction;
}

/** Inverse of logicalToCoordinateFloat; coordinateToLogical returns ceil and loses sub-bar precision. */
export function coordinateToLogicalFloat(chart: any, x: number): number | null {
  const timeScale = chart.timeScale();
  const logicalCeil = timeScale.coordinateToLogical(x);
  if (logicalCeil == null) return null;
  const xCeil = timeScale.logicalToCoordinate(logicalCeil);
  if (xCeil == null) return logicalCeil;
  if (logicalCeil <= 0) return logicalCeil;
  const xFloor = timeScale.logicalToCoordinate(logicalCeil - 1);
  if (xFloor == null || xCeil === xFloor) return logicalCeil;
  return (logicalCeil - 1) + (x - xFloor) / (xCeil - xFloor);
}

export function timeToX(chart: any, time: number, candles: TimeCandle[]): number | null {
  const logical = timeToLogical(time, candles);
  return logical == null ? null : logicalToCoordinateFloat(chart, logical);
}

export function xToTime(chart: any, x: number, candles: TimeCandle[]): number | null {
  const logical = coordinateToLogicalFloat(chart, x);
  return logical == null ? null : logicalToTime(logical, candles);
}

export function pointToPixel(chart: any, series: any, point: DrawingPoint, candles: TimeCandle[]): PixelPoint | null {
  const x = timeToX(chart, point.time, candles);
  const y = series.priceToCoordinate(point.price);
  return x == null || y == null ? null : { x, y };
}

export function eventToPoint(event: PointerEvent, container: HTMLElement, chart: any, series: any, candles: TimeCandle[]): DrawingPoint | null {
  const bounds = container.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const time = xToTime(chart, x, candles);
  const price = series.coordinateToPrice(y);
  return time == null || price == null ? null : { time, price };
}
