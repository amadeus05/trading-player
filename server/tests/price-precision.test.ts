import assert from "node:assert/strict";
import test from "node:test";
import { inferPricePrecision } from "../../src/shared/lib/market";
import { buildInitialProtectionPrices } from "../../src/features/trading/lib/buildInitialProtectionPrices";
import type { Candle } from "../../src/types";

const bar = (close: number, range = 0.004): Candle => ({
  time: 1,
  open: close,
  high: close + range / 2,
  low: close - range / 2,
  close,
  volume: 1,
});

test("ADA-like prices around 1.00 keep at least 4 decimals even if OHLC stringify to 2", () => {
  const candles = [0.97, 0.98, 0.99, 1, 1.01].map((close) => bar(close, 0.01));
  assert.ok(inferPricePrecision(candles) >= 4);
});

test("BTC-like prices stay at 2 decimals", () => {
  const candles = [64_120.5, 64_130, 64_125.25].map((close) => bar(close, 20));
  assert.equal(inferPricePrecision(candles), 2);
});

test("sub-cent alts get extra decimals from magnitude", () => {
  const candles = [0.0123, 0.0124, 0.01235].map((close) => bar(close, 0.00005));
  assert.ok(inferPricePrecision(candles) >= 6);
});

test("initial TP/SL sit near the last bar, not at 55% of a wide price scale", () => {
  const candles = Array.from({ length: 20 }, () => bar(0.9734, 0.003));
  const { tp, sl } = buildInitialProtectionPrices(
    "LONG",
    0.9734,
    { from: 0.93, to: 1.01 },
    candles,
    5,
  );
  assert.ok(tp - 0.9734 < 0.02, `tp too far: ${tp}`);
  assert.ok(0.9734 - sl < 0.02, `sl too far: ${sl}`);
  assert.ok(tp > 0.9734);
  assert.ok(sl < 0.9734);
});

test("initial TP/SL stay inside a tight visible range", () => {
  const candles = [bar(0.9734, 0.004)];
  const { tp, sl } = buildInitialProtectionPrices(
    "LONG",
    0.9734,
    { from: 0.971, to: 0.976 },
    candles,
    5,
  );
  assert.ok(sl > 0.971);
  assert.ok(tp < 0.976);
});

test("a large ATR still keeps SL/TP inside the visible scale", () => {
  const candles = [bar(0.3753, 0.04)];
  const { tp, sl } = buildInitialProtectionPrices(
    "LONG",
    0.3753,
    { from: 0.358, to: 0.381 },
    candles,
    5,
  );
  assert.ok(sl > 0.358, `sl off-screen: ${sl}`);
  assert.ok(tp < 0.381, `tp off-screen: ${tp}`);
  assert.ok(sl < 0.3753);
  assert.ok(tp > 0.3753);
});
