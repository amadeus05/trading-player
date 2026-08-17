import type { Candle } from "../../types";

export function candleEndTime(
  source: Candle[],
  index: number,
  timeframeMinutes: number,
): number | null {
  const time = source[index]?.time;
  if (time == null) return null;
  const next = source[index + 1]?.time;
  const span = next != null && next > time ? next - time : timeframeMinutes * 60;
  return time + span - 1;
}

/** OHLC только из базовых баров с time <= now. Всё правее головы — look-ahead. */
export function buildPartialCandle(intrabar: Candle[], bucketStart: number, now: number): Candle | null {
  let open: number | null = null;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let volume = 0;
  for (const bar of intrabar) {
    if (bar.time < bucketStart) continue;
    if (bar.time > now) break;
    if (open == null) open = bar.open;
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    close = bar.close;
    volume += bar.volume;
  }
  if (open == null || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { time: bucketStart, open, high, low, close, volume };
}

function findLastIndexAtOrBefore(candles: Candle[], now: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time <= now) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function findOpenBucketIndex(candles: Candle[], now: number, timeframeMinutes: number): number {
  const index = findLastIndexAtOrBefore(candles, now);
  if (index < 0) return -1;
  const end = candleEndTime(candles, index, timeframeMinutes);
  return end != null && now < end ? index : -1;
}

/**
 * Подменяет незакрытый бакет головы. Ищем бар по времени, не по индексу:
 * зум prepend'ит историю, и старый индекс указывает на уже закрытую свечу.
 */
export function applyPlayheadCandle(input: {
  candles: Candle[];
  intrabarCandles: Candle[];
  playheadTime: number | null;
  timeframeMinutes: number;
  previousPartial?: Candle | null;
  /** Монета+ТФ. Чужой partial с тем же UTC-time подставлять нельзя. */
  partialKey?: string;
  previousPartialKey?: string;
}): { candles: Candle[]; partial: Candle | null } {
  const { candles, intrabarCandles, playheadTime: now, timeframeMinutes, previousPartial } = input;
  if (now == null || !candles.length) return { candles, partial: null };
  const bucketIndex = findOpenBucketIndex(candles, now, timeframeMinutes);
  const base = bucketIndex >= 0 ? candles[bucketIndex] : undefined;
  if (!base) return { candles, partial: null };
  const sameContext = input.partialKey == null || input.partialKey === input.previousPartialKey;
  const partial = buildPartialCandle(intrabarCandles, base.time, now)
    ?? (sameContext && previousPartial?.time === base.time ? previousPartial : null)
    ?? { time: base.time, open: base.open, high: base.open, low: base.open, close: base.open, volume: 0 };
  const next = candles.slice();
  next[bucketIndex] = partial;
  return { candles: next, partial };
}

/** Полная биржевая свеча обычно в разы больше уже сыгранного 5м-куска. */
const LOOKAHEAD_GROWTH_RATIO = 10;

function isPlaceholderBar(bar: { high: number; low: number; volume: number }): boolean {
  return bar.volume <= 0 && bar.high === bar.low;
}

/**
 * Зум/догрузка не имеют права подменить partial полной биржевой свечой.
 * Обычная достройка 5м (stub → кусок, или кусок чуть вырос) проходит.
 */
export function keepIncompleteLastBar<T extends { time: number; high: number; low: number; volume: number }>(
  previousLast: T | undefined,
  incomingLast: T | undefined,
  isPlayStep: boolean,
): T | undefined {
  if (isPlayStep || !previousLast || !incomingLast) return incomingLast;
  if (previousLast.time !== incomingLast.time) return incomingLast;
  if (isPlaceholderBar(previousLast)) return incomingLast;
  const volumeLeaked = previousLast.volume > 0
    && incomingLast.volume > previousLast.volume * LOOKAHEAD_GROWTH_RATIO;
  const previousRange = previousLast.high - previousLast.low;
  const incomingRange = incomingLast.high - incomingLast.low;
  const rangeLeaked = previousRange > 0 && incomingRange > previousRange * LOOKAHEAD_GROWTH_RATIO;
  return volumeLeaked || rangeLeaked ? previousLast : incomingLast;
}
