import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../../src/types";
import { detectSessionBoxes } from "../../src/features/chart/sessionBoxes";

const candle = (time: number, high: number, low: number): Candle => ({
  time,
  open: (high + low) / 2,
  high,
  low,
  close: (high + low) / 2,
  volume: 1,
});

test("Tokyo 09:00–16:00 JST spans the session window, not 18:00 close", () => {
  // 09:00 JST = 00:00 UTC, 16:00 JST = 07:00 UTC.
  const candles = [
    candle(Date.parse("2024-01-15T23:55:00Z") / 1_000, 100, 99),
    candle(Date.parse("2024-01-16T00:00:00Z") / 1_000, 110, 100),
    candle(Date.parse("2024-01-16T06:55:00Z") / 1_000, 120, 105),
    candle(Date.parse("2024-01-16T07:00:00Z") / 1_000, 90, 80),
  ];
  const tokyo = detectSessionBoxes(candles).filter((box) => box.id === "tokyo");
  assert.equal(tokyo.length, 1);
  assert.equal(tokyo[0].startTime, Date.parse("2024-01-16T00:00:00Z") / 1_000);
  assert.equal(tokyo[0].endTime, Date.parse("2024-01-16T07:00:00Z") / 1_000);
  assert.equal(tokyo[0].high, 120);
  assert.equal(tokyo[0].low, 100);
  assert.equal(tokyo[0].title, "Tokyo");
});

test("pre-London 08:00–09:00 Berlin follows CET/CEST", () => {
  // Зима CET: 08:00 Berlin = 07:00 UTC.
  const winter = [
    candle(Date.parse("2024-01-15T06:55:00Z") / 1_000, 10, 9),
    candle(Date.parse("2024-01-15T07:00:00Z") / 1_000, 12, 11),
    candle(Date.parse("2024-01-15T07:55:00Z") / 1_000, 13, 8),
    candle(Date.parse("2024-01-15T08:00:00Z") / 1_000, 20, 19),
  ];
  const winterPre = detectSessionBoxes(winter).filter((box) => box.id === "pre");
  assert.equal(winterPre.length, 1);
  assert.equal(winterPre[0].startTime, Date.parse("2024-01-15T07:00:00Z") / 1_000);
  assert.equal(winterPre[0].endTime, Date.parse("2024-01-15T08:00:00Z") / 1_000);
  assert.equal(winterPre[0].title, "pre-London");

  // Лето CEST: 08:00 Berlin = 06:00 UTC.
  const summer = [
    candle(Date.parse("2024-07-15T05:55:00Z") / 1_000, 10, 9),
    candle(Date.parse("2024-07-15T06:00:00Z") / 1_000, 12, 11),
    candle(Date.parse("2024-07-15T06:55:00Z") / 1_000, 13, 8),
    candle(Date.parse("2024-07-15T07:00:00Z") / 1_000, 20, 19),
  ];
  const summerPre = detectSessionBoxes(summer).filter((box) => box.id === "pre");
  assert.equal(summerPre.length, 1);
  assert.equal(summerPre[0].startTime, Date.parse("2024-07-15T06:00:00Z") / 1_000);
  assert.equal(summerPre[0].endTime, Date.parse("2024-07-15T07:00:00Z") / 1_000);
});

test("NY 09:30–16:00 Eastern is 13:30–20:00 UTC in summer", () => {
  const candles = [
    candle(Date.parse("2024-07-15T13:25:00Z") / 1_000, 10, 9),
    candle(Date.parse("2024-07-15T13:30:00Z") / 1_000, 14, 11),
    candle(Date.parse("2024-07-15T19:55:00Z") / 1_000, 16, 8),
    candle(Date.parse("2024-07-15T20:00:00Z") / 1_000, 7, 6),
  ];
  const ny = detectSessionBoxes(candles).filter((box) => box.id === "ny");
  assert.equal(ny.length, 1);
  assert.equal(ny[0].startTime, Date.parse("2024-07-15T13:30:00Z") / 1_000);
  assert.equal(ny[0].endTime, Date.parse("2024-07-15T20:00:00Z") / 1_000);
  assert.equal(ny[0].high, 16);
  assert.equal(ny[0].low, 8);
  assert.equal(ny[0].title, "New York");
});

test("London overlaps NY; pre-London ends when London starts", () => {
  const candles = [
    candle(Date.parse("2024-07-15T06:00:00Z") / 1_000, 11, 10),
    candle(Date.parse("2024-07-15T07:00:00Z") / 1_000, 12, 9),
    candle(Date.parse("2024-07-15T13:30:00Z") / 1_000, 15, 8),
    candle(Date.parse("2024-07-15T15:25:00Z") / 1_000, 14, 10),
  ];
  const boxes = detectSessionBoxes(candles);
  const pre = boxes.find((box) => box.id === "pre");
  const london = boxes.find((box) => box.id === "london");
  const ny = boxes.find((box) => box.id === "ny");
  assert.ok(pre);
  assert.ok(london);
  assert.ok(ny);
  assert.equal(pre.endTime, london.startTime);
  assert.ok(ny.startTime < london.endTime);
});

test("no box when the session window has no candles", () => {
  const candles = [
    candle(Date.parse("2024-01-16T12:00:00Z") / 1_000, 1, 0),
    candle(Date.parse("2024-01-16T12:05:00Z") / 1_000, 2, 1),
  ];
  const tokyo = detectSessionBoxes(candles).filter((box) => box.id === "tokyo");
  assert.equal(tokyo.length, 0);
});

test("open session stops at replay head, not scheduled close", () => {
  const candles = [
    candle(Date.parse("2024-07-15T13:30:00Z") / 1_000, 14, 11),
    candle(Date.parse("2024-07-15T14:00:00Z") / 1_000, 16, 10),
  ];
  const ny = detectSessionBoxes(candles).filter((box) => box.id === "ny");
  assert.equal(ny.length, 1);
  assert.equal(ny[0].endTime, Date.parse("2024-07-15T14:00:00Z") / 1_000 + 1_800);
});
