import assert from "node:assert/strict";
import test from "node:test";
import {
  averageBarSpacingMs,
  buildEarlierMarketCandleRange,
  buildInitialMarketCandleRange,
  buildNextMarketCandleRange,
  inferTimeframeMinutes,
  buildReplayStartMarketCandleRange,
  clampPlayheadToLoadedWindow,
  hasLoadedMarketCandleRange,
  initialMarketCandleLimitForTimeframe,
  MARKET_CANDLE_INTERVAL_MS,
  MARKET_TIMEFRAME_PREFETCH_BARS,
  prefetchMarketCandleThresholdForTimeframe,
  REPLAY_BACK_TIMEFRAME_BARS,
  REPLAY_FORWARD_TIMEFRAME_BARS,
  resolvePendingTimeframeChange,
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

test("clampPlayheadToLoadedWindow snaps past last incomplete day onto last closed bar", () => {
  const yesterday = 0;
  const day = 86_400;
  const candles = [{ time: yesterday - day }, { time: yesterday }];
  const playheadInsideUnclosedToday = yesterday + day + 12 * 3_600;

  assert.equal(
    clampPlayheadToLoadedWindow(playheadInsideUnclosedToday, candles, 1_440),
    yesterday + day - 1,
  );
});

test("clampPlayheadToLoadedWindow does not move a playhead that already fits", () => {
  const lastOpen = 200;
  const lastEnd = lastOpen + 60;
  const candles = [{ time: 100 }, { time: lastOpen }];

  assert.equal(clampPlayheadToLoadedWindow(150, candles, 1), 150);
  assert.equal(clampPlayheadToLoadedWindow(lastOpen, candles, 1), lastOpen);
  assert.equal(clampPlayheadToLoadedWindow(lastEnd, candles, 1), lastEnd);
  assert.equal(clampPlayheadToLoadedWindow(50, candles, 1), 50);
});

test("clampPlayheadToLoadedWindow leaves empty windows and NaN untouched", () => {
  assert.equal(clampPlayheadToLoadedWindow(12, [], 1_440), 12);
  assert.equal(Number.isNaN(clampPlayheadToLoadedWindow(Number.NaN, [{ time: 100 }], 1)), true);
});

const thirtyMinutes = (openTime: number) => ({ time: openTime });
const daily = (openTime: number) => ({ time: openTime });

test("pending TF still waits while the loaded window is the old resolution", () => {
  const pending = { timeframe: 1_440, replayTime: 1_000 };
  const thirtyMinuteWindow = [thirtyMinutes(0), thirtyMinutes(1_800), thirtyMinutes(3_600)];

  assert.equal(resolvePendingTimeframeChange(pending, thirtyMinuteWindow), null);
});

test("pending TF applies the original playhead when it fits the new window", () => {
  const yesterday = Date.UTC(2021, 2, 17) / 1_000;
  const day = 86_400;
  const playheadInsideLastClosedDay = yesterday + 12 * 3_600;
  const dailyWindow = [daily(yesterday - day), daily(yesterday)];

  assert.deepEqual(
    resolvePendingTimeframeChange({ timeframe: 1_440, replayTime: playheadInsideLastClosedDay }, dailyWindow),
    { timeframe: 1_440, replayTime: playheadInsideLastClosedDay },
  );
});

test("pending TF clamps only when 30m playhead sits in an unclosed last 1d bucket", () => {
  const yesterday = Date.UTC(2021, 2, 17) / 1_000;
  const day = 86_400;
  const playheadOnLastHistoryDay = yesterday + day + 10 * 1_800;
  const dailyWindow = [daily(yesterday - 3 * day), daily(yesterday - 2 * day), daily(yesterday)];

  assert.deepEqual(
    resolvePendingTimeframeChange({ timeframe: 1_440, replayTime: playheadOnLastHistoryDay }, dailyWindow),
    { timeframe: 1_440, replayTime: yesterday + day - 1 },
  );
});

test("pending TF does not apply without candles or without a pending change", () => {
  assert.equal(resolvePendingTimeframeChange({ timeframe: 1_440, replayTime: 1 }, []), null);
  assert.equal(resolvePendingTimeframeChange(null, [{ time: 0 }, { time: 86_400 }]), null);
});

const HOUR_SECONDS = 3_600;
const HOUR_MS = 3_600_000;

/**
 * Часовое окно форекса, которое начинается перед выходными: между первой и
 * второй свечой двое суток, дальше обычный час. Именно на таком окне ломались
 * и догрузка влево, и распознавание таймфрейма.
 */
const forexHourlyWindow = (bars: number) => {
  const candles = [{ time: 0 }];
  for (let index = 0; index < bars - 1; index += 1) {
    candles.push({ time: (49 + index) * HOUR_SECONDS });
  }
  return candles;
};

test("таймфрейм окна берётся по минимальному шагу, а не по первой паре свечей", () => {
  const window = forexHourlyWindow(50);

  assert.equal(inferTimeframeMinutes(window, 5), 60);
  // Круглосуточная крипта — тот же ответ, шаг везде одинаковый.
  assert.equal(inferTimeframeMinutes([{ time: 0 }, { time: HOUR_SECONDS }], 5), 60);
  assert.equal(inferTimeframeMinutes([{ time: 0 }], 5), 5, "по одной свече шаг неизвестен");
  assert.equal(inferTimeframeMinutes([], 5), 5);
});

test("смена таймфрейма применяется, даже если окно начинается перед выходными", () => {
  const window = forexHourlyWindow(50);
  const playhead = window[10].time;

  assert.deepEqual(
    resolvePendingTimeframeChange({ timeframe: 60, replayTime: playhead }, window),
    { timeframe: 60, replayTime: playhead },
  );
});

test("средний шаг бара у форекса шире таймфрейма", () => {
  const window = forexHourlyWindow(50);
  const spacing = averageBarSpacingMs(window);

  assert.ok(spacing !== null && spacing > HOUR_MS, "выходные растягивают средний шаг");
  assert.equal(averageBarSpacingMs([{ time: 0 }]), null);
});

test("окно влево меряется плотностью бара, иначе запрос попадёт в закрытый рынок", () => {
  const window = forexHourlyWindow(50);
  const boundary = { from: -1_000 * HOUR_MS, to: 100 * HOUR_MS };
  const missingBars = 80;

  const range = buildEarlierMarketCandleRange(boundary, window, missingBars, 0, 5);
  assert.ok(range);
  assert.equal(range.to, 0, "правый край — первая уже загруженная свеча");
  const span = range.to - range.from;
  assert.ok(
    span > missingBars * HOUR_MS,
    `окно ${span} должно быть шире наивных ${missingBars * HOUR_MS} мс`,
  );

  // Праздники длиннее выходных, поэтому попытки расширяют окно втрое.
  const wider = buildEarlierMarketCandleRange(boundary, window, missingBars, 1, 5);
  assert.ok(wider);
  assert.equal(wider.to - wider.from, span * 3);
});

test("окно влево не уходит за начало скачанной истории", () => {
  const window = forexHourlyWindow(50);
  const boundary = { from: -3 * HOUR_MS, to: 100 * HOUR_MS };

  assert.deepEqual(buildEarlierMarketCandleRange(boundary, window, 80, 0, 5), {
    from: -3 * HOUR_MS,
    to: 0,
  });
});

test("окно влево не строится, когда слева уже ничего нет", () => {
  const window = forexHourlyWindow(50);

  assert.equal(buildEarlierMarketCandleRange({ from: 0, to: 100 * HOUR_MS }, window, 80, 0, 5), null);
  assert.equal(buildEarlierMarketCandleRange({ from: -100 * HOUR_MS, to: 0 }, [], 80, 0, 5), null);
  assert.equal(buildEarlierMarketCandleRange({ from: -100 * HOUR_MS, to: 0 }, window, 0, 0, 5), null);
});
