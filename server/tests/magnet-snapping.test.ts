import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateGridSizePx,
  hasOhlc,
  magnetPlotHeight,
  pickMagnetCandidate,
  snapPointerForDrawing,
  weakMagnetRadiusPx,
  WEAK_MAGNET_GRID_CELLS,
  type MagnetCandidate,
} from "../../src/drawing/shared/magnet";
import type { ChartApiLike, SeriesApiLike } from "../../src/drawing/shared/types";

const high: MagnetCandidate = { time: 100, price: 110, x: 50, y: 20 };
const close: MagnetCandidate = { time: 100, price: 100, x: 50, y: 40 };
const open: MagnetCandidate = { time: 100, price: 102, x: 50, y: 36 };
const low: MagnetCandidate = { time: 100, price: 90, x: 50, y: 80 };
const ohlc = [open, high, close, low];

test("off never snaps", () => {
  assert.equal(pickMagnetCandidate({ x: 50, y: 21 }, ohlc, "off", 40), null);
});

test("weak snaps when cursor is within 1.5 grid cells of a wick", () => {
  const radius = 48;
  const hit = pickMagnetCandidate({ x: 50, y: 22 }, ohlc, "weak", radius);
  assert.ok(hit);
  assert.equal(hit.price, 110);
});

test("weak does not snap when cursor is farther than the grid radius", () => {
  const radius = 48;
  assert.equal(pickMagnetCandidate({ x: 50, y: 200 }, ohlc, "weak", radius), null);
});

test("weak does not snap just beyond 1.5 grid cells above the high", () => {
  const radius = 48;
  assert.equal(pickMagnetCandidate({ x: 50, y: 20 - (radius + 1) }, ohlc, "weak", radius), null);
});

test("weak snaps just inside 1.5 grid cells above the high", () => {
  const radius = 48;
  const hit = pickMagnetCandidate({ x: 50, y: 20 - (radius - 1) }, ohlc, "weak", radius);
  assert.ok(hit);
  assert.equal(hit.price, 110);
});

test("strong always snaps to the nearest OHLC even far from the candle", () => {
  const hit = pickMagnetCandidate({ x: 50, y: 0 }, ohlc, "strong", 8);
  assert.ok(hit);
  assert.equal(hit.price, 110);
});

test("strong prefers the closer of high vs low", () => {
  const hit = pickMagnetCandidate({ x: 52, y: 78 }, ohlc, "strong", 8);
  assert.ok(hit);
  assert.equal(hit.price, 90);
});

test("weak jumps to nearest OHLC inside the candle instead of sliding along the body", () => {
  const tall: MagnetCandidate[] = [
    { time: 1, price: 50, x: 50, y: 160 },
    { time: 1, price: 110, x: 50, y: 10 },
    { time: 1, price: 100, x: 50, y: 40 },
    { time: 1, price: 40, x: 50, y: 200 },
  ];
  const hit = pickMagnetCandidate({ x: 50, y: 90 }, tall, "weak", 48);
  assert.ok(hit);
  assert.equal(hit.price, 100);
});

test("weak radius is 1.5 of the estimated grid cell", () => {
  assert.equal(WEAK_MAGNET_GRID_CELLS, 1.5);
  const plotHeight = 540;
  const grid = estimateGridSizePx(plotHeight);
  assert.equal(grid, 60);
  assert.equal(weakMagnetRadiusPx(plotHeight), 90);
});

test("magnet plot height excludes the time scale", () => {
  assert.equal(
    magnetPlotHeight({ clientHeight: 500 }, { timeScale: () => ({ height: () => 28 }) }),
    472,
  );
});

const ohlcCandle = { time: 100, open: 10, high: 12, low: 8, close: 11 };

function mockChart(barX = 50, barWidth = 10): ChartApiLike {
  return {
    timeScale() {
      return {
        width: () => 400,
        height: () => 24,
        logicalToCoordinate: (logical: number) => barX + logical * barWidth,
        coordinateToLogical: (x: number) => Math.ceil((x - barX) / barWidth),
      };
    },
  };
}

function mockSeries(): SeriesApiLike {
  return {
    priceToCoordinate: (price) => 200 - price * 10,
    coordinateToPrice: (y) => (200 - y) / 10,
  };
}

test("hasOhlc rejects candles without OHLC", () => {
  assert.equal(hasOhlc({ time: 100 }), false);
  assert.equal(hasOhlc(ohlcCandle), true);
});

test("off snaps X to the bar and keeps the cursor Y", () => {
  const result = snapPointerForDrawing({
    chart: mockChart(),
    series: mockSeries(),
    candles: [ohlcCandle],
    x: 52,
    y: 50,
    magnetMode: "off",
    plotHeight: 400,
  });
  assert.equal(result.x, 50);
  assert.equal(result.y, 50);
  assert.equal(result.time, 100);
  assert.equal(result.price, 15);
  assert.equal(result.magnetApplied, false);
});

test("strong without OHLC does not magnetize Y", () => {
  const result = snapPointerForDrawing({
    chart: mockChart(),
    series: mockSeries(),
    candles: [{ time: 100 }],
    x: 52,
    y: 80,
    magnetMode: "strong",
    plotHeight: 400,
  });
  assert.equal(result.x, 50);
  assert.equal(result.y, 80);
  assert.equal(result.magnetApplied, false);
});

test("strong snaps Y to the nearest OHLC of the bar under the cursor", () => {
  const result = snapPointerForDrawing({
    chart: mockChart(),
    series: mockSeries(),
    candles: [ohlcCandle],
    x: 52,
    y: 81,
    magnetMode: "strong",
    plotHeight: 400,
  });
  assert.equal(result.x, 50);
  assert.equal(result.y, 80);
  assert.equal(result.price, 12);
  assert.equal(result.magnetApplied, true);
});
