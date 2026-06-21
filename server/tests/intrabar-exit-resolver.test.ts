import assert from "node:assert/strict";
import { test } from "node:test";
import { IntrabarExitResolver } from "../../src/simulation/IntrabarExitResolver.js";
import type { Candle } from "../../src/types.js";

const M = 60;
const START = 1_800_000_000;
const resolver = new IntrabarExitResolver();
const long = { side: "LONG" as const, sl: 95, tp: 105 };

function candle(offsetMinutes: number, high = 101, low = 99): Candle {
  return { time: START + offsetMinutes * M, open: 100, high, low, close: 100, volume: 1 };
}

test("resolves TP before SL from complete 5m candles inside a 15m candle", () => {
  const result = resolver.resolve([candle(0), candle(5, 106), candle(10, 101, 94)], START, 15 * M, long);
  assert.deepEqual(result, { kind: "resolved", outcome: "TP", candleTime: START + 5 * M });
});

test("resolves SL before TP for a short trade", () => {
  const result = resolver.resolve(
    [candle(0, 106), candle(5, 101, 94), candle(10)],
    START,
    15 * M,
    { side: "SHORT", sl: 105, tp: 95 },
  );
  assert.deepEqual(result, { kind: "resolved", outcome: "SL", candleTime: START });
});

test("returns not-hit when neither barrier is touched", () => {
  assert.deepEqual(resolver.resolve([candle(0), candle(5), candle(10)], START, 15 * M, long), { kind: "not-hit" });
});

test("falls back when the selected timeframe cannot be divided by the lower timeframe", () => {
  assert.deepEqual(resolver.resolve([candle(0), candle(5), candle(10)], START, 7 * M, long), {
    kind: "fallback", reason: "incompatible-timeframe",
  });
});

test("falls back when a lower candle is missing", () => {
  assert.deepEqual(resolver.resolve([candle(0), candle(10), candle(15)], START, 15 * M, long), {
    kind: "fallback", reason: "irregular-data",
  });
});

test("falls back when the requested parent window is incomplete", () => {
  assert.deepEqual(resolver.resolve([candle(0), candle(5), candle(10), candle(15)], START + 10 * M, 15 * M, long), {
    kind: "fallback", reason: "incomplete-window",
  });
});

test("falls back when TP and SL are both touched in one lower candle", () => {
  assert.deepEqual(resolver.resolve([candle(0), candle(5, 106, 94), candle(10)], START, 15 * M, long), {
    kind: "fallback", reason: "ambiguous-lower-candle",
  });
});

test("sorts lower candles before resolving their order", () => {
  const result = resolver.resolve([candle(10, 101, 94), candle(0), candle(5, 106)], START, 15 * M, long);
  assert.deepEqual(result, { kind: "resolved", outcome: "TP", candleTime: START + 5 * M });
});
