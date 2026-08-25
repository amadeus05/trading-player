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
    kind: "fallback", reason: "incomplete-window",
  });
});

test("a gap elsewhere does not disable a complete parent window", () => {
  const result = resolver.resolve(
    [candle(-15), candle(0), candle(5, 106), candle(10, 101, 94)],
    START,
    15 * M,
    long,
  );
  assert.deepEqual(result, { kind: "resolved", outcome: "TP", candleTime: START + 5 * M });
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

test("playhead clips SL/TP to already-played lower bars inside a higher TF candle", () => {
  const fourHour = 240 * M;
  const bars = Array.from({ length: 48 }, (_, index) => {
    // 10 сыгранных 5м, стоп только на 20-й — как ещё не доигранный хвост 4ч.
    if (index === 19) return candle(index * 5, 101, 90);
    return candle(index * 5);
  });
  const playheadAfterTen = START + 10 * 5 * M - 1;
  assert.deepEqual(
    resolver.resolve(bars, START, fourHour, long, playheadAfterTen),
    { kind: "not-hit" },
  );
  assert.deepEqual(
    resolver.resolve(bars, START, fourHour, long),
    { kind: "resolved", outcome: "SL", candleTime: START + 19 * 5 * M },
  );
});

test("playhead still resolves a hit that already happened before the playhead", () => {
  const fourHour = 240 * M;
  const bars = Array.from({ length: 48 }, (_, index) => (
    index === 4 ? candle(index * 5, 106) : candle(index * 5)
  ));
  const playheadAfterTen = START + 10 * 5 * M - 1;
  assert.deepEqual(
    resolver.resolve(bars, START, fourHour, long, playheadAfterTen),
    { kind: "resolved", outcome: "TP", candleTime: START + 4 * 5 * M },
  );
});

test("playhead at the parent bar end matches resolve without a playhead", () => {
  const bars = [candle(0), candle(5, 106), candle(10, 101, 94)];
  const parentEnd = START + 15 * M - 1;
  assert.deepEqual(
    resolver.resolve(bars, START, 15 * M, long, parentEnd),
    resolver.resolve(bars, START, 15 * M, long),
  );
});

test("playhead before the parent bar is not a hit", () => {
  const bars = [candle(0, 106), candle(5, 101, 94), candle(10)];
  assert.deepEqual(
    resolver.resolve(bars, START, 15 * M, long, START - 1),
    { kind: "not-hit" },
  );
});

test("a gap after the playhead does not invalidate the already-played prefix", () => {
  const fourHour = 240 * M;
  const bars = Array.from({ length: 48 }, (_, index) => candle(index * 5))
    .filter((_, index) => index !== 30);
  const playheadAfterTen = START + 10 * 5 * M - 1;
  assert.deepEqual(
    resolver.resolve(bars, START, fourHour, long, playheadAfterTen),
    { kind: "not-hit" },
  );
  assert.deepEqual(
    resolver.resolve(bars, START, fourHour, long),
    { kind: "fallback", reason: "incomplete-window" },
  );
});

test("a gap before the playhead still falls back", () => {
  const bars = [candle(0), candle(10), candle(15)];
  assert.deepEqual(
    resolver.resolve(bars, START, 15 * M, long, START + 15 * M - 1),
    { kind: "fallback", reason: "incomplete-window" },
  );
});

test("playhead ignores SL on a later 5m for a short trade", () => {
  const short = { side: "SHORT" as const, sl: 105, tp: 95 };
  const bars = [candle(0), candle(5), candle(10, 106)];
  assert.deepEqual(
    resolver.resolve(bars, START, 15 * M, short, START + 10 * M - 1),
    { kind: "not-hit" },
  );
  assert.deepEqual(
    resolver.resolve(bars, START, 15 * M, short, START + 15 * M - 1),
    { kind: "resolved", outcome: "SL", candleTime: START + 10 * M },
  );
});

test("playhead ignores an ambiguous later 5m and still flags an ambiguous played 5m", () => {
  const laterAmbiguous = [candle(0), candle(5), candle(10, 106, 94)];
  assert.deepEqual(
    resolver.resolve(laterAmbiguous, START, 15 * M, long, START + 10 * M - 1),
    { kind: "not-hit" },
  );
  const playedAmbiguous = [candle(0, 106, 94), candle(5), candle(10)];
  assert.deepEqual(
    resolver.resolve(playedAmbiguous, START, 15 * M, long, START + 10 * M - 1),
    { kind: "fallback", reason: "ambiguous-lower-candle" },
  );
});
