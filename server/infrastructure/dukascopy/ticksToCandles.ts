import { BASE_INTERVAL_MS, type Candle } from "../../domain/Candle.js";

/**
 * Тик в файле фида: 20 байт big-endian — смещение от начала часа в мс, цены ask
 * и bid целыми в пунктах, объёмы ask и bid.
 */
export const TICK_RECORD_SIZE = 20;

const OFFSET_MS = 0;
const OFFSET_BID = 8;
const OFFSET_BID_VOLUME = 16;

/**
 * Собирает минутные свечи из распакованного часа тиков.
 *
 * Цена берётся по bid: так же строит свечи и сам Dukascopy, и любой график по
 * умолчанию, поэтому история не разъедется, если позже добавить второй источник.
 * Оборота у форекса нет, и ноль здесь не случайность: отрицательный оборот —
 * метка минуты закрытого рынка, и настоящая свеча обязана в неё не попадать.
 */
export function ticksToCandles(raw: Buffer, hourStartMs: number, priceDivisor: number): Candle[] {
  const byMinute = new Map<number, Candle>();
  // Хвост короче записи означает обрезанный файл: разбирать его нельзя, но и
  // терять уже прочитанные минуты не за что.
  const ticks = Math.floor(raw.length / TICK_RECORD_SIZE);

  for (let index = 0; index < ticks; index += 1) {
    const at = index * TICK_RECORD_SIZE;
    const price = raw.readInt32BE(at + OFFSET_BID) / priceDivisor;
    if (!Number.isFinite(price) || price <= 0) continue;

    const rawVolume = raw.readFloatBE(at + OFFSET_BID_VOLUME);
    const volume = Number.isFinite(rawVolume) && rawVolume > 0 ? rawVolume : 0;
    const minute = raw.readUInt32BE(at + OFFSET_MS);
    const openTime = hourStartMs + Math.floor(minute / BASE_INTERVAL_MS) * BASE_INTERVAL_MS;

    const candle = byMinute.get(openTime);
    if (!candle) {
      byMinute.set(openTime, {
        openTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
        turnover: 0,
      });
      continue;
    }
    if (price > candle.high) candle.high = price;
    if (price < candle.low) candle.low = price;
    candle.close = price;
    candle.volume += volume;
  }

  return [...byMinute.values()].sort((left, right) => left.openTime - right.openTime);
}
