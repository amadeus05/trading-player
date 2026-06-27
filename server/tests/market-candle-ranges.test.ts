import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInitialMarketCandleRange,
  buildNextMarketCandleRange,
  buildReplayStartMarketCandleRange,
  hasLoadedMarketCandleRange,
  MARKET_CANDLE_INTERVAL_MS,
  shouldPrefetchMarketCandles,
} from "../../src/features/datasets/marketCandleRanges";

const START = Date.UTC(2026, 0, 1);

const candle = (index: number) => ({
  time: (START + index * MARKET_CANDLE_INTERVAL_MS) / 1_000,
});

test("initial market candle range is capped and aligned to 5m candles", () => {
  const range = buildInitialMarketCandleRange(
    {
      from: START + 12_345,
      to: START + 100 * MARKET_CANDLE_INTERVAL_MS,
    },
    10,
  );

  assert.deepEqual(range, {
    from: START,
    to: START + 10 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("initial market candle range does not extend past catalog end", () => {
  const range = buildInitialMarketCandleRange(
    {
      from: START,
      to: START + 7 * MARKET_CANDLE_INTERVAL_MS,
    },
    10,
  );

  assert.deepEqual(range, {
    from: START,
    to: START + 7 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("next market candle range starts after the last loaded candle", () => {
  const range = buildNextMarketCandleRange(
    {
      from: START,
      to: START + 30 * MARKET_CANDLE_INTERVAL_MS,
    },
    [candle(0), candle(1), candle(2)],
    5,
  );

  assert.deepEqual(range, {
    from: START + 3 * MARKET_CANDLE_INTERVAL_MS,
    to: START + 8 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("replay start range always includes full prehistory from catalog start", () => {
  const range = buildReplayStartMarketCandleRange(
    {
      from: START,
      to: START + 10_000 * MARKET_CANDLE_INTERVAL_MS,
    },
    START + 5_000 * MARKET_CANDLE_INTERVAL_MS,
    5,
  );

  assert.deepEqual(range, {
    from: START,
    to: START + 7_000 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("replay start range clamps prehistory near the catalog start", () => {
  const range = buildReplayStartMarketCandleRange(
    {
      from: START,
      to: START + 100 * MARKET_CANDLE_INTERVAL_MS,
    },
    START + MARKET_CANDLE_INTERVAL_MS,
    5,
  );

  assert.deepEqual(range, {
    from: START,
    to: START + 100 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("replay start range keeps full prehistory near the catalog end", () => {
  const range = buildReplayStartMarketCandleRange(
    {
      from: START,
      to: START + 100 * MARKET_CANDLE_INTERVAL_MS,
    },
    START + 99 * MARKET_CANDLE_INTERVAL_MS,
    5,
  );

  assert.deepEqual(range, {
    from: START,
    to: START + 100 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("replay start range expands future context for high timeframes", () => {
  const range = buildReplayStartMarketCandleRange(
    {
      from: START,
      to: START + 100_000 * MARKET_CANDLE_INTERVAL_MS,
    },
    START + 80_000 * MARKET_CANDLE_INTERVAL_MS,
    1_440,
  );

  assert.deepEqual(range, {
    from: START,
    to: START + 97_280 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("loaded market candle range requires full coverage of the requested window", () => {
  const range = {
    from: START + 5 * MARKET_CANDLE_INTERVAL_MS,
    to: START + 15 * MARKET_CANDLE_INTERVAL_MS,
  };

  assert.equal(hasLoadedMarketCandleRange(Array.from({ length: 20 }, (_, index) => candle(index)), range), true);
  assert.equal(hasLoadedMarketCandleRange(Array.from({ length: 10 }, (_, index) => candle(index)), range), false);
  assert.equal(hasLoadedMarketCandleRange([], range), false);
});

test("next market candle range returns null when the catalog is fully loaded", () => {
  const range = buildNextMarketCandleRange(
    {
      from: START,
      to: START + 3 * MARKET_CANDLE_INTERVAL_MS,
    },
    [candle(0), candle(1), candle(2)],
    5,
  );

  assert.equal(range, null);
});

test("prefetch trigger only fires near the loaded window end", () => {
  const loaded = Array.from({ length: 100 }, (_, index) => candle(index));

  assert.equal(shouldPrefetchMarketCandles(loaded, 40, 10), false);
  assert.equal(shouldPrefetchMarketCandles(loaded, 90, 10), true);
  assert.equal(shouldPrefetchMarketCandles([], 0, 10), false);
});
