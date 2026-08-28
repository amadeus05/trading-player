import type { Candle } from "../../types";
import { zonedDateParts, zonedWallTime } from "../../shared/lib/chartTimezones";

const DAY = 24 * 3_600;
/** Как `max_boxes_count = 500` в индикаторе TradingView. */
const MAX_BOXES = 500;

export interface SessionBoxDef {
  id: string;
  title: string;
  timeZone: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  color: string;
}

/**
 * Часы как у «Trading Sessions by klmn1k from Trading Volium»:
 * Tokyo 09:00–16:00 JST, pre-London 08:00–09:00 Берлин (Франкфурт),
 * London 08:00–16:30, NY 09:30–16:00 (индексы). DST через IANA.
 */
export const SESSION_BOX_DEFS: SessionBoxDef[] = [
  { id: "tokyo", title: "Tokyo", timeZone: "Asia/Tokyo", startHour: 9, startMinute: 0, endHour: 16, endMinute: 0, color: "#c9a0ff" },
  { id: "pre", title: "pre-London", timeZone: "Europe/Berlin", startHour: 8, startMinute: 0, endHour: 9, endMinute: 0, color: "#f0a070" },
  { id: "london", title: "London", timeZone: "Europe/London", startHour: 8, startMinute: 0, endHour: 16, endMinute: 30, color: "#7dcc90" },
  { id: "ny", title: "New York", timeZone: "America/New_York", startHour: 9, startMinute: 30, endHour: 16, endMinute: 0, color: "#7eb6e8" },
];

export interface SessionBoxZone {
  id: string;
  title: string;
  color: string;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
}

function barDuration(candles: Candle[]): number {
  if (candles.length < 2) return 60;
  return Math.max(1, candles[1].time - candles[0].time);
}

/** Первый индекс свечи с `time >= t`. */
function lowerBound(candles: Candle[], time: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function sessionWindows(def: SessionBoxDef, fromTs: number, toTs: number): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  const first = zonedDateParts(def.timeZone, fromTs - DAY);
  const last = zonedDateParts(def.timeZone, toTs + DAY);
  const firstNoon = Date.UTC(first.year, first.month - 1, first.day, 12) / 1_000;
  const lastNoon = Date.UTC(last.year, last.month - 1, last.day, 12) / 1_000;
  for (let cursor = firstNoon; cursor <= lastNoon; cursor += DAY) {
    const date = new Date(cursor * 1_000);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const start = zonedWallTime(def.timeZone, year, month, day, def.startHour, def.startMinute);
    const end = zonedWallTime(def.timeZone, year, month, day, def.endHour, def.endMinute);
    if (end < fromTs || start > toTs) continue;
    windows.push({ start, end });
  }
  return windows;
}

/**
 * Коробка на всю длительность сессии по оси времени; высота — high/low свечей
 * внутри окна. Незакрытая сессия растёт до головы replay, не в будущее.
 */
export function detectSessionBoxes(candles: Candle[]): SessionBoxZone[] {
  if (!candles.length) return [];
  const duration = barDuration(candles);
  const fromTs = candles[0].time;
  const headEnd = candles[candles.length - 1].time + duration;
  const boxes: SessionBoxZone[] = [];

  for (const def of SESSION_BOX_DEFS) {
    for (const window of sessionWindows(def, fromTs, headEnd)) {
      const from = lowerBound(candles, window.start);
      const to = lowerBound(candles, window.end);
      if (from >= to) continue;
      let high = -Infinity;
      let low = Infinity;
      for (let i = from; i < to; i += 1) {
        const candle = candles[i];
        if (candle.high > high) high = candle.high;
        if (candle.low < low) low = candle.low;
      }
      if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
      boxes.push({
        id: def.id,
        title: def.title,
        color: def.color,
        startTime: window.start,
        endTime: Math.min(window.end, headEnd),
        high,
        low,
      });
    }
  }

  if (boxes.length <= MAX_BOXES) return boxes;
  boxes.sort((left, right) => left.startTime - right.startTime);
  return boxes.slice(-MAX_BOXES);
}
