import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInitialMarketCandleRange,
  buildNextMarketCandleRange,
  buildReplayStartMarketCandleRange,
  hasLoadedMarketCandleRange,
  initialMarketCandleLimitForTimeframe,
  MARKET_CANDLE_INTERVAL_MS,
  MARKET_TIMEFRAME_PREFETCH_BARS,
  prefetchMarketCandleThresholdForTimeframe,
  REPLAY_BACK_TIMEFRAME_BARS,
  REPLAY_FORWARD_TIMEFRAME_BARS,
  shouldPrefetchMarketCandles,
} from "../../src/features/datasets/marketCandleRanges";

const START = Date.UTC(2026, 0, 1);

/** Сколько базовых свечей в одном баре таймфрейма. */
const baseCandlesPer = (timeframeMinutes: number) =>
  (timeframeMinutes * 60_000) / MARKET_CANDLE_INTERVAL_MS;

const candle = (index: number) => ({
  time: (START + index * MARKET_CANDLE_INTERVAL_MS) / 1_000,
});

test("initial market candle range is capped and aligned to base candles", () => {
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

test("initial market candle range expands for high timeframes", () => {
  // Окно меряется барами экрана, поэтому в базовых свечах оно тем длиннее, чем
  // крупнее таймфрейм — а строк в ответе всегда примерно одинаково.
  const oneDayLimit = initialMarketCandleLimitForTimeframe(1_440);
  const expected = REPLAY_FORWARD_TIMEFRAME_BARS * baseCandlesPer(1_440);
  const range = buildInitialMarketCandleRange(
    { from: START, to: START + 10_000_000 * MARKET_CANDLE_INTERVAL_MS },
    oneDayLimit,
  );

  assert.equal(oneDayLimit, expected);
  assert.deepEqual(range, {
    from: START,
    to: START + expected * MARKET_CANDLE_INTERVAL_MS,
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

test("replay start range loads a window instead of the full dataset prefix", () => {
  const perBar = baseCandlesPer(5);
  const back = REPLAY_BACK_TIMEFRAME_BARS * perBar;
  const forward = REPLAY_FORWARD_TIMEFRAME_BARS * perBar;
  const range = buildReplayStartMarketCandleRange(
    { from: START, to: START + 100_000 * MARKET_CANDLE_INTERVAL_MS },
    START + 50_000 * MARKET_CANDLE_INTERVAL_MS,
    5,
  );

  // 80 баров предыстории назад от цели; хвост левее лениво догружает loadEarlier
  assert.deepEqual(range, {
    from: START + (50_000 - back) * MARKET_CANDLE_INTERVAL_MS,
    to: START + (50_000 + forward) * MARKET_CANDLE_INTERVAL_MS,
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

test("replay start range keeps the window near the catalog end", () => {
  const back = REPLAY_BACK_TIMEFRAME_BARS * baseCandlesPer(5);
  const range = buildReplayStartMarketCandleRange(
    { from: START, to: START + 10_000 * MARKET_CANDLE_INTERVAL_MS },
    START + 9_999 * MARKET_CANDLE_INTERVAL_MS,
    5,
  );

  // 80 баров назад от цели, форвард обрезан по концу каталога
  assert.deepEqual(range, {
    from: START + (9_999 - back) * MARKET_CANDLE_INTERVAL_MS,
    to: START + 10_000 * MARKET_CANDLE_INTERVAL_MS,
  });
});

test("replay start range expands both windows for high timeframes", () => {
  const perBar = baseCandlesPer(1_440);
  const back = REPLAY_BACK_TIMEFRAME_BARS * perBar;
  const forward = REPLAY_FORWARD_TIMEFRAME_BARS * perBar;
  const target = 5_000_000;
  const range = buildReplayStartMarketCandleRange(
    { from: START, to: START + 20_000_000 * MARKET_CANDLE_INTERVAL_MS },
    START + target * MARKET_CANDLE_INTERVAL_MS,
    1_440,
  );

  // И предыстория, и форвард считаются в барах экрана, поэтому на дневках
  // захватывают во столько же раз больше базовых свечей, во сколько бар длиннее.
  assert.deepEqual(range, {
    from: START + (target - back) * MARKET_CANDLE_INTERVAL_MS,
    to: START + (target + forward) * MARKET_CANDLE_INTERVAL_MS,
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

test("prefetch trigger uses candle time, not the visible timeframe index", () => {
  const loaded = Array.from({ length: 100 }, (_, index) => candle(index));

  assert.equal(shouldPrefetchMarketCandles(loaded, candle(40).time, 10), false);
  assert.equal(shouldPrefetchMarketCandles(loaded, candle(90).time, 10), true);
  assert.equal(shouldPrefetchMarketCandles([], candle(90).time, 10), false);
  assert.equal(shouldPrefetchMarketCandles(loaded, undefined, 10), false);
});

test("prefetch threshold expands for high timeframes", () => {
  const oneDayThreshold = prefetchMarketCandleThresholdForTimeframe(1_440);
  const expected = MARKET_TIMEFRAME_PREFETCH_BARS * baseCandlesPer(1_440);
  const loaded = Array.from({ length: 100_000 }, (_, index) => candle(index));

  assert.equal(oneDayThreshold, expected);
  assert.equal(shouldPrefetchMarketCandles(loaded, candle(50_000).time, oneDayThreshold), false);
  assert.equal(shouldPrefetchMarketCandles(loaded, candle(90_000).time, oneDayThreshold), true);
});
