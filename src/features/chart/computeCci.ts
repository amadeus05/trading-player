import type { Candle } from "../../types";

export interface CciSettings {
  /** Период самого CCI. */
  length: number;
  /** Период сглаживающей средней по CCI (отдельная линия, по умолчанию скрыта). */
  smoothingLength: number;
  upperBand: number;
  lowerBand: number;
}

export const CCI_DEFAULTS: CciSettings = {
  length: 7,
  smoothingLength: 14,
  upperBand: 200,
  lowerBand: -200,
};

export interface IndicatorPoint {
  time: number;
  value: number;
}

/** Множитель Ламберта: нормирует CCI так, чтобы ~70-80% значений попадали в ±100. */
const LAMBERT_CONSTANT = 0.015;

/**
 * CCI по одной точке: (src - SMA) / (0.015 * среднее абсолютное отклонение).
 * Источник — close, как в настройках. Возвращает null, пока не набралось окно.
 */
function cciAt(candles: Candle[], index: number, length: number): number | null {
  if (length <= 0 || index < length - 1) return null;
  const from = index - length + 1;
  let sum = 0;
  for (let i = from; i <= index; i += 1) sum += candles[i].close;
  const sma = sum / length;
  let deviation = 0;
  for (let i = from; i <= index; i += 1) deviation += Math.abs(candles[i].close - sma);
  const meanDeviation = deviation / length;
  // Плоское окно: отклонения нет, делить не на что — считаем нулём, а не бесконечностью.
  if (meanDeviation === 0) return 0;
  return (candles[index].close - sma) / (LAMBERT_CONSTANT * meanDeviation);
}

/** CCI по всей серии. Первые length-1 баров пропускаются — окна ещё нет. */
export function computeCci(candles: Candle[], length: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  for (let i = length - 1; i < candles.length; i += 1) {
    const value = cciAt(candles, i, length);
    if (value != null) out.push({ time: candles[i].time, value });
  }
  return out;
}

/** Значение только для последнего бара — для точечного обновления на тике. */
export function computeLastCci(candles: Candle[], length: number): IndicatorPoint | null {
  const index = candles.length - 1;
  const value = cciAt(candles, index, length);
  return value == null ? null : { time: candles[index].time, value };
}

/** Простая средняя по уже посчитанному CCI. */
export function smoothIndicator(points: IndicatorPoint[], length: number): IndicatorPoint[] {
  if (length <= 1) return points;
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    sum += points[i].value;
    if (i >= length) sum -= points[i - length].value;
    if (i >= length - 1) out.push({ time: points[i].time, value: sum / length });
  }
  return out;
}
