import assert from "node:assert/strict";
import { test } from "node:test";
import { computeVolumeProfile } from "../../src/drawing/volume-profile/computeVolumeProfile.ts";
import type { Candle } from "../../src/types.ts";

function candle(time: number, price: number, volume: number): Candle {
  return {
    time,
    open: price,
    high: price,
    low: price,
    close: price,
    volume,
  };
}

function profileFromRowVolumes(rowVolumes: number[], valueAreaPct: number) {
  const rows = rowVolumes.length;
  const candles = [
    candle(0, 0, 0),
    ...rowVolumes.map((volume, index) => candle(index + 1, index + 0.5, volume)),
    candle(rows + 1, rows, 0),
  ];
  const result = computeVolumeProfile(candles, 0, rows + 1, rows, valueAreaPct, "candle");
  assert.ok(result);
  return result;
}

test("POC tie selects the row closest to the profile midpoint", () => {
  const result = profileFromRowVolumes([100, 0, 100, 0, 0], 0.7);

  assert.equal(result.pocIndex, 2);
  assert.equal(result.pocPrice, 2.5);
});

test("value area expands by comparing two-row pairs around POC", () => {
  const result = profileFromRowVolumes([0, 40, 40, 100, 60, 0, 0], 0.7);

  assert.equal(result.pocIndex, 3);
  assert.equal(result.valueAreaLow, 1);
  assert.equal(result.valueAreaHigh, 4);
});
