import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlayheadCandle,
  buildPartialCandle,
  candleEndTime,
  keepIncompleteLastBar,
} from "../../src/features/replay/playheadCandle.ts";
import type { Candle } from "../../src/types.ts";

const H4_MINUTES = 240;
const H4 = H4_MINUTES * 60;
const M5 = 5 * 60;

/** 4ч бакет 08:00 UTC. Биржа отдаёт его целиком — это и есть look-ahead. */
const BUCKET = Date.UTC(2024, 0, 15, 8, 0, 0) / 1000;
const PREV_BUCKET = BUCKET - H4;

const fullFourHour: Candle = {
  time: BUCKET,
  open: 0.44,
  high: 0.455,
  low: 0.42,
  close: 0.43,
  volume: 45_290_000,
};

const closedPrev: Candle = {
  time: PREV_BUCKET,
  open: 0.41,
  high: 0.42,
  low: 0.4,
  close: 0.44,
  volume: 12_000_000,
};

/** Уже проигранные 5м внутри 4ч: объём 2.44M, клоуз 0.4407 — как на экране до зума. */
const playedFiveMin: Candle[] = [
  { time: BUCKET, open: 0.44, high: 0.441, low: 0.439, close: 0.4405, volume: 800_000 },
  { time: BUCKET + M5, open: 0.4405, high: 0.4412, low: 0.4398, close: 0.4402, volume: 820_000 },
  { time: BUCKET + 2 * M5, open: 0.4402, high: 0.4415, low: 0.4395, close: 0.4407, volume: 820_000 },
];

/** 5м после головы: хай и объём всего 4ч. Их нельзя подмешивать. */
const futureFiveMin: Candle[] = [
  { time: BUCKET + 30 * M5, open: 0.44, high: 0.455, low: 0.42, close: 0.43, volume: 42_850_000 },
];

const playheadInside = BUCKET + 2 * M5;

function bar(overrides: Partial<Candle> & Pick<Candle, "time">): Candle {
  return {
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    ...overrides,
  };
}

test("buildPartialCandle ignores bars after the playhead", () => {
  const partial = buildPartialCandle([...playedFiveMin, ...futureFiveMin], BUCKET, playheadInside);
  assert.ok(partial);
  assert.equal(partial.time, BUCKET);
  assert.equal(partial.open, 0.44);
  assert.equal(partial.high, 0.4415);
  assert.equal(partial.low, 0.439);
  assert.equal(partial.close, 0.4407);
  assert.equal(partial.volume, 2_440_000);
  assert.ok(partial.high < fullFourHour.high);
  assert.ok(partial.volume < fullFourHour.volume);
});

test("candleEndTime uses the next bar when present, otherwise the timeframe span", () => {
  const candles = [closedPrev, fullFourHour];
  assert.equal(candleEndTime(candles, 0, H4_MINUTES), BUCKET - 1);
  assert.equal(candleEndTime(candles, 1, H4_MINUTES), BUCKET + H4 - 1);
  assert.equal(candleEndTime([], 0, H4_MINUTES), null);
});

test("inside a 4h bucket the last bar is only the already-played 5m, not the exchange 4h", () => {
  const { candles, partial } = applyPlayheadCandle({
    candles: [closedPrev, fullFourHour],
    intrabarCandles: [...playedFiveMin, ...futureFiveMin],
    playheadTime: playheadInside,
    timeframeMinutes: H4_MINUTES,
  });

  assert.ok(partial);
  assert.deepEqual(candles[0], closedPrev);
  assert.deepEqual(candles[1], {
    time: BUCKET,
    open: 0.44,
    high: 0.4415,
    low: 0.439,
    close: 0.4407,
    volume: 2_440_000,
  });
  assert.notEqual(candles[1].volume, fullFourHour.volume);
  assert.notEqual(candles[1].close, fullFourHour.close);
});

test("prepend / stale index still patches the open playhead bucket", () => {
  const prepended = [
    bar({ time: PREV_BUCKET - 2 * H4, volume: 1 }),
    bar({ time: PREV_BUCKET - H4, volume: 2 }),
    closedPrev,
    fullFourHour,
  ];
  const { candles } = applyPlayheadCandle({
    candles: prepended,
    intrabarCandles: playedFiveMin,
    playheadTime: playheadInside,
    timeframeMinutes: H4_MINUTES,
  });

  const open = candles.find((item) => item.time === BUCKET);
  assert.ok(open);
  assert.equal(open.volume, 2_440_000);
  assert.equal(open.close, 0.4407);
  assert.equal(candles[2], closedPrev);
});

test("empty 5m while playhead is inside the bucket never leaks the full exchange bar", () => {
  const { candles, partial } = applyPlayheadCandle({
    candles: [fullFourHour],
    intrabarCandles: [],
    playheadTime: playheadInside,
    timeframeMinutes: H4_MINUTES,
  });

  assert.ok(partial);
  assert.deepEqual(candles[0], {
    time: BUCKET,
    open: fullFourHour.open,
    high: fullFourHour.open,
    low: fullFourHour.open,
    close: fullFourHour.open,
    volume: 0,
  });
  assert.notEqual(candles[0].high, fullFourHour.high);
  assert.notEqual(candles[0].volume, fullFourHour.volume);
});

test("keeps the previous partial of the same bucket when 5m is briefly empty", () => {
  const previous = {
    time: BUCKET,
    open: 0.44,
    high: 0.4415,
    low: 0.439,
    close: 0.4407,
    volume: 2_440_000,
  };
  const { candles } = applyPlayheadCandle({
    candles: [fullFourHour],
    intrabarCandles: [],
    playheadTime: playheadInside,
    timeframeMinutes: H4_MINUTES,
    previousPartial: previous,
  });
  assert.deepEqual(candles[0], previous);
});

test("when the playhead reaches the bucket end the full candle is allowed", () => {
  const end = BUCKET + H4 - 1;
  const { candles, partial } = applyPlayheadCandle({
    candles: [closedPrev, fullFourHour],
    intrabarCandles: [...playedFiveMin, ...futureFiveMin],
    playheadTime: end,
    timeframeMinutes: H4_MINUTES,
  });
  assert.equal(partial, null);
  assert.equal(candles[1], fullFourHour);
  assert.equal(candles[1].volume, 45_290_000);
});

test("zoom setData must not grow the last bar; a play step may", () => {
  const onScreen = {
    time: BUCKET,
    open: 0.44,
    high: 0.4415,
    low: 0.439,
    close: 0.4407,
    volume: 2_440_000,
  };
  const leaked = fullFourHour;

  assert.deepEqual(keepIncompleteLastBar(onScreen, leaked, false), onScreen);
  assert.equal(keepIncompleteLastBar(onScreen, leaked, true), leaked);

  const nextBar = bar({ time: BUCKET + H4, high: 0.5, volume: 3_000_000 });
  assert.equal(keepIncompleteLastBar(onScreen, nextBar, false), nextBar);
});

test("a 5m refresh may replace a stub or grow the same partial a little", () => {
  const stub = {
    time: BUCKET,
    open: 0.44,
    high: 0.44,
    low: 0.44,
    close: 0.44,
    volume: 0,
  };
  const firstFive = {
    time: BUCKET,
    open: 0.44,
    high: 0.441,
    low: 0.439,
    close: 0.4405,
    volume: 800_000,
  };
  const grown = {
    ...firstFive,
    high: 0.4415,
    low: 0.439,
    close: 0.4407,
    volume: 2_440_000,
  };
  assert.deepEqual(keepIncompleteLastBar(stub, firstFive, false), firstFive);
  assert.deepEqual(keepIncompleteLastBar(firstFive, grown, false), grown);
});

test("future candles after the playhead do not hide the open bucket", () => {
  const future = Array.from({ length: 200 }, (_, offset) => bar({
    time: BUCKET + (offset + 1) * H4,
    volume: offset + 10,
  }));
  const { candles } = applyPlayheadCandle({
    candles: [closedPrev, fullFourHour, ...future],
    intrabarCandles: playedFiveMin,
    playheadTime: playheadInside,
    timeframeMinutes: H4_MINUTES,
  });
  assert.equal(candles[1].volume, 2_440_000);
  assert.equal(candles[1].close, 0.4407);
});

test("previous partial from another market or timeframe is not reused", () => {
  const foreign = {
    time: BUCKET,
    open: 9,
    high: 9,
    low: 9,
    close: 9,
    volume: 99,
  };
  const { candles } = applyPlayheadCandle({
    candles: [fullFourHour],
    intrabarCandles: [],
    playheadTime: playheadInside,
    timeframeMinutes: H4_MINUTES,
    previousPartial: foreign,
    previousPartialKey: "SOL:240",
    partialKey: "BTC:240",
  });
  assert.deepEqual(candles[0], {
    time: BUCKET,
    open: fullFourHour.open,
    high: fullFourHour.open,
    low: fullFourHour.open,
    close: fullFourHour.open,
    volume: 0,
  });
});
