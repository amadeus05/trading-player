import { BASE_INTERVAL_MS, CLOSED_MARKET_TURNOVER, type Candle } from "../domain/Candle.js";

export interface TimeSpan {
  from: number;
  to: number;
}

/**
 * Самая длинная пауза, которую готовы считать закрытым рынком: выходные форекса
 * плюс праздник рядом укладываются в трое суток с запасом. Всё, что длиннее, —
 * скорее молчание провайдера, чем закрытый рынок, и застраивать это нельзя:
 * застроенную минуту никто уже не перекачает, а незастроенная просто попросится
 * в следующий раз.
 */
export const MAX_CLOSURE_MS = 5 * 86_400_000;

/** Смежные страницы закачки склеиваются: выходные растягиваются на несколько. */
export function mergeAdjacentSpans(spans: TimeSpan[]): TimeSpan[] {
  const sorted = [...spans].sort((left, right) => left.from - right.from);
  const merged: TimeSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Достраивает минуты, которых провайдер не отдал, — но только те, у которых с
 * обеих сторон есть настоящая свеча из того же скачанного диапазона.
 *
 * Свеча с двух сторон — это доказательство, что провайдер до этого места дошёл и
 * ответил, значит внутри торгов действительно не было. У краёв диапазона такого
 * доказательства нет: там точно так же выглядит и молчание из-за лимита
 * запросов, и период до появления инструмента, поэтому края остаются дырками и
 * будут запрошены снова.
 *
 * Диапазоны — это те страницы, которые качались сейчас. Через уже лежащие на
 * диске страницы застраивать нельзя: слот перезаписался бы ровной ценой поверх
 * настоящих данных.
 */
export function buildClosedMarketCandles(candles: Candle[], spans: TimeSpan[]): Candle[] {
  if (candles.length < 2 || !spans.length) return [];
  const sorted = [...candles].sort((left, right) => left.openTime - right.openTime);
  const closed: Candle[] = [];
  let cursor = 0;

  for (const span of mergeAdjacentSpans(spans)) {
    while (cursor < sorted.length && sorted[cursor].openTime < span.from) cursor += 1;
    let previous: Candle | null = null;
    while (cursor < sorted.length && sorted[cursor].openTime < span.to) {
      const candle = sorted[cursor];
      cursor += 1;
      if (previous) {
        const holeStart = previous.openTime + BASE_INTERVAL_MS;
        const price = previous.close;
        if (candle.openTime - holeStart <= MAX_CLOSURE_MS) {
          for (let time = holeStart; time < candle.openTime; time += BASE_INTERVAL_MS) {
            closed.push({
              openTime: time,
              open: price,
              high: price,
              low: price,
              close: price,
              volume: 0,
              turnover: CLOSED_MARKET_TURNOVER,
            });
          }
        }
      }
      previous = candle;
    }
  }

  return closed;
}
