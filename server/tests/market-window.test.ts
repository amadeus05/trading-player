import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCandles } from "../../src/shared/lib/market";
import { candleCacheKey } from "../../src/features/datasets/useActiveMarketCandles";
import type { Candle } from "../../src/types";

const hourly = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const time = Date.UTC(2024, 0, 1, index) / 1_000;
    return { time, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
  });

const fifteen = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const time = Date.UTC(2024, 0, 1, 0, index * 15) / 1_000;
    return { time, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
  });

test("1h окно на экране 15m даёт пустой график — это Empty после смены ТФ", () => {
  const raw = hourly(8);
  assert.equal(aggregateCandles(raw, 15, 60).length, 0);
});

test("15m окно на экране 15m остаётся видимым", () => {
  const raw = fifteen(8);
  assert.equal(aggregateCandles(raw, 15, 15).length, 8);
});

test("15m окно собирается в 1h", () => {
  const raw = fifteen(8);
  assert.equal(aggregateCandles(raw, 60, 15).length, 2);
});

test("кеш монеты разделён по таймфрейму: 1h ADA не выдаётся как 15m BTC", () => {
  const cache = new Map<string, Candle[]>();
  cache.set(candleCacheKey("market:linear:ADAUSDT", 60), hourly(4));
  assert.equal(cache.get(candleCacheKey("market:linear:BTCUSDT", 15)), undefined);
  assert.equal(cache.get(candleCacheKey("market:linear:ADAUSDT", 15)), undefined);
  assert.ok(cache.get(candleCacheKey("market:linear:ADAUSDT", 60))?.length);
});

test("30m экран на дневном окне по-прежнему пустой, пока ТФ не применили", () => {
  const daily = Array.from({ length: 4 }, (_, index) => {
    const time = Date.UTC(2021, 2, 15 + index) / 1_000;
    return { time, open: 1, high: 2, low: 0.5, close: 1.2, volume: 10 };
  });
  assert.equal(aggregateCandles(daily, 30, 1_440).length, 0);
  assert.equal(aggregateCandles(daily, 1_440, 1_440).length, 4);
});
