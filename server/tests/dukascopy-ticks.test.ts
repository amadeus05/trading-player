import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BASE_INTERVAL_MS, isClosedMarketCandle } from "../domain/Candle.js";
import { DUKASCOPY_SYMBOLS, feedInstrument } from "../domain/instruments.js";
import { ticksToCandles, TICK_RECORD_SIZE } from "../infrastructure/dukascopy/ticksToCandles.js";

const HOUR = Date.UTC(2024, 0, 3, 9);

interface Tick {
  /** Смещение от начала часа в миллисекундах. */
  offsetMs: number;
  /** Цена bid в пунктах фида, то есть целым числом. */
  bid: number;
  volume?: number;
}

/** Собирает буфер в том же виде, в каком его отдаёт распакованный файл фида. */
function tickBlock(ticks: Tick[]): Buffer {
  const raw = Buffer.alloc(ticks.length * TICK_RECORD_SIZE);
  ticks.forEach((tick, index) => {
    const at = index * TICK_RECORD_SIZE;
    raw.writeUInt32BE(tick.offsetMs, at);
    raw.writeInt32BE(tick.bid + 20, at + 4);
    raw.writeInt32BE(tick.bid, at + 8);
    raw.writeFloatBE(1.5, at + 12);
    raw.writeFloatBE(tick.volume ?? 2, at + 16);
  });
  return raw;
}

const minute = (index: number) => HOUR + index * BASE_INTERVAL_MS;

describe("ticksToCandles", () => {
  test("тики одной минуты дают одну свечу с крайними ценами и суммой объёма", () => {
    const raw = tickBlock([
      { offsetMs: 125, bid: 109_500, volume: 1 },
      { offsetMs: 20_000, bid: 109_540, volume: 2 },
      { offsetMs: 40_000, bid: 109_480, volume: 3 },
      { offsetMs: 59_999, bid: 109_510, volume: 4 },
    ]);

    assert.deepEqual(ticksToCandles(raw, HOUR, 1e5), [{
      openTime: minute(0),
      open: 1.095,
      high: 1.0954,
      low: 1.0948,
      close: 1.0951,
      volume: 10,
      turnover: 0,
    }]);
  });

  test("минуты нарезаются по смещению внутри часа", () => {
    const raw = tickBlock([
      { offsetMs: 0, bid: 109_500 },
      { offsetMs: 60_000, bid: 109_600 },
      { offsetMs: 3_599_999, bid: 109_700 },
    ]);

    assert.deepEqual(
      ticksToCandles(raw, HOUR, 1e5).map((candle) => candle.openTime),
      [minute(0), minute(1), minute(59)],
    );
  });

  /**
   * Отрицательный оборот — метка минуты закрытого рынка, поэтому настоящая
   * свеча обязана в неё не попадать ни при каком объёме.
   */
  test("свеча из тиков никогда не выглядит как закрытая минута", () => {
    const raw = tickBlock([{ offsetMs: 0, bid: 109_500, volume: 0 }]);
    const [candle] = ticksToCandles(raw, HOUR, 1e5);

    assert.equal(candle.turnover, 0);
    assert.equal(isClosedMarketCandle(candle), false);
  });

  test("делитель переводит пункты фида в настоящую цену", () => {
    const raw = tickBlock([{ offsetMs: 0, bid: 2_045_320 }]);

    assert.equal(ticksToCandles(raw, HOUR, 1e3)[0].close, 2045.32);
  });

  test("обрезанный хвост файла отбрасывается, а прочитанные минуты остаются", () => {
    const raw = Buffer.concat([
      tickBlock([{ offsetMs: 0, bid: 109_500 }]),
      Buffer.alloc(7),
    ]);

    assert.equal(ticksToCandles(raw, HOUR, 1e5).length, 1);
  });

  test("пустой час и нулевые цены свечей не дают", () => {
    assert.deepEqual(ticksToCandles(Buffer.alloc(0), HOUR, 1e5), []);
    assert.deepEqual(ticksToCandles(tickBlock([{ offsetMs: 0, bid: 0 }]), HOUR, 1e5), []);
  });
});

describe("настройки тикового фида", () => {
  test("символ ищется без учёта регистра, неизвестный не выдумывается", () => {
    assert.equal(feedInstrument("eurusd")?.priceDivisor, 1e5);
    assert.equal(feedInstrument("XAUUSD")?.priceDivisor, 1e3);
    assert.equal(feedInstrument("EURJPY"), undefined);
  });

  /**
   * Делитель цен нельзя вывести из кода инструмента, его проверяют запросом.
   * Поэтому здесь только проверенные инструменты — в отличие от списка
   * доступного для закачки, который целиком приходит от источника.
   */
  test("проверенных инструментов меньше, чем отдаёт источник", () => {
    assert.ok(DUKASCOPY_SYMBOLS.length > 0);
    for (const symbol of DUKASCOPY_SYMBOLS) assert.equal(feedInstrument(symbol)?.feedSymbol, symbol);
  });
});
