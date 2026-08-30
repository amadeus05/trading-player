import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../../src/types";
import { detectFairValueGaps } from "../../src/features/chart/fvgOverlay";

const candle = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume: 1,
});

test("detects bullish FVG and extends until full fill", () => {
  const candles = [
    candle(0, 98, 100, 97, 99),
    candle(60, 99, 110, 98, 108),
    candle(120, 108, 112, 105, 110),
    candle(180, 110, 111, 106, 107),
    candle(240, 107, 108, 99, 100),
  ];
  const zones = detectFairValueGaps(candles);
  const bull = zones.find((zone) => zone.direction === "bullish");
  assert.ok(bull);
  assert.equal(bull.bottom, 100);
  assert.equal(bull.top, 105);
  assert.equal(bull.startTime, 120);
  assert.equal(bull.filled, true);
  assert.equal(bull.endTime, 240);
  assert.equal(bull.remainTop, bull.remainBottom);
});

test("partial bullish fill keeps remain only below intrusion", () => {
  const candles = [
    candle(0, 98, 100, 97, 99),
    candle(60, 99, 110, 98, 108),
    candle(120, 108, 112, 105, 110),
    candle(180, 110, 111, 103, 104),
  ];
  const zones = detectFairValueGaps(candles);
  const bull = zones.find((zone) => zone.direction === "bullish");
  assert.ok(bull);
  assert.equal(bull.filled, false);
  assert.equal(bull.remainBottom, 100);
  assert.equal(bull.remainTop, 103);
});

test("detects bearish FVG that stays open to replay head", () => {
  const candles = [
    candle(0, 110, 112, 108, 109),
    candle(60, 109, 110, 95, 96),
    candle(120, 96, 97, 94, 95),
    candle(180, 95, 96, 93, 94),
  ];
  const zones = detectFairValueGaps(candles);
  const bear = zones.find((zone) => zone.direction === "bearish");
  assert.ok(bear);
  assert.equal(bear.top, 108);
  assert.equal(bear.bottom, 97);
  assert.equal(bear.filled, false);
  assert.equal(bear.remainTop, 108);
  assert.equal(bear.remainBottom, 97);
  assert.equal(bear.endTime, 180 + 30);
});
