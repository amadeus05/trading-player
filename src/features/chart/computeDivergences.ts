import type { Candle } from "../../types";
import type { IndicatorPoint } from "./computeCci";

export type DivergenceKind = "bull" | "bear";

export interface Divergence {
  kind: DivergenceKind;
  /** Пивот раньше по времени. */
  fromTime: number;
  fromValue: number;
  /** Пивот позже по времени — на нём и появляется метка. */
  toTime: number;
  toValue: number;
}

export interface DivergenceSettings {
  /** Баров слева и справа для подтверждения пивота. */
  pivotLookback: number;
  /** Минимальное расстояние между пивотами в барах — ближе это шум. */
  minPivotDistance: number;
  /** Максимальное расстояние — дальше связь между экстремумами теряет смысл. */
  maxPivotDistance: number;
  /** Сколько последних баров сканировать. */
  scanWindow: number;
}

export const DIVERGENCE_DEFAULTS: DivergenceSettings = {
  pivotLookback: 5,
  minPivotDistance: 5,
  maxPivotDistance: 60,
  scanWindow: 1_500,
};

interface Pivot {
  index: number;
  time: number;
  value: number;
}

/**
 * Локальные экстремумы осциллятора. Бар считается пивотом, только когда справа
 * от него уже есть `lookback` баров — то есть подтверждение приходит с задержкой.
 * Это намеренно: пивот, определённый по ещё не наступившим барам, был бы
 * подглядыванием в будущее.
 */
function findPivots(points: IndicatorPoint[], lookback: number): { lows: Pivot[]; highs: Pivot[] } {
  const lows: Pivot[] = [];
  const highs: Pivot[] = [];
  for (let i = lookback; i < points.length - lookback; i += 1) {
    const value = points[i].value;
    let isLow = true;
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      if (points[j].value <= value) isLow = false;
      if (points[j].value >= value) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) lows.push({ index: i, time: points[i].time, value });
    if (isHigh) highs.push({ index: i, time: points[i].time, value });
  }
  return { lows, highs };
}

/**
 * Обычные дивергенции между ценой и осциллятором:
 *   bull — цена ставит более низкий минимум, осциллятор более высокий;
 *   bear — цена ставит более высокую вершину, осциллятор более низкую.
 * Скрытые дивергенции пока не размечаем.
 */
export function computeDivergences(
  candles: Candle[],
  points: IndicatorPoint[],
  settings: DivergenceSettings = DIVERGENCE_DEFAULTS,
): Divergence[] {
  if (points.length < settings.pivotLookback * 2 + 2) return [];
  const window = points.length > settings.scanWindow
    ? points.slice(points.length - settings.scanWindow)
    : points;
  const priceByTime = new Map<number, Candle>();
  for (const candle of candles) priceByTime.set(candle.time, candle);

  const { lows, highs } = findPivots(window, settings.pivotLookback);
  const out: Divergence[] = [];

  const scan = (pivots: Pivot[], kind: DivergenceKind) => {
    for (let i = 1; i < pivots.length; i += 1) {
      const previous = pivots[i - 1];
      const current = pivots[i];
      const distance = current.index - previous.index;
      if (distance < settings.minPivotDistance || distance > settings.maxPivotDistance) continue;
      const priceFrom = priceByTime.get(previous.time);
      const priceTo = priceByTime.get(current.time);
      if (!priceFrom || !priceTo) continue;
      const diverges = kind === "bull"
        ? priceTo.low < priceFrom.low && current.value > previous.value
        : priceTo.high > priceFrom.high && current.value < previous.value;
      if (!diverges) continue;
      out.push({
        kind,
        fromTime: previous.time,
        fromValue: previous.value,
        toTime: current.time,
        toValue: current.value,
      });
    }
  };

  scan(lows, "bull");
  scan(highs, "bear");
  return out;
}

/** Стабильный ключ отрезка — по нему переиспользуем уже отрисованные линии. */
export function divergenceKey(divergence: Divergence): string {
  return `${divergence.kind}|${divergence.fromTime}|${divergence.toTime}`;
}
