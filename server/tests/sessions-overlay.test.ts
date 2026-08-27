import assert from "node:assert/strict";
import test from "node:test";
import { clampSegmentToBars } from "../../src/features/chart/sessionsOverlay";
import type { Candle } from "../../src/types";

const HOUR = 3_600;
const START = Date.UTC(2024, 11, 12, 0, 0) / 1_000;

const bar = (time: number): Candle => ({
  time,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 0,
});

/** Часовые бары форекса: неделя обрывается в пятницу 21:00 и оживает в воскресенье 22:00. */
const forexBars = (): Candle[] => {
  const bars: Candle[] = [];
  // Чт 00:00 — пт 21:00 UTC.
  for (let hour = 0; hour <= 45; hour += 1) bars.push(bar(START + hour * HOUR));
  // Вс 22:00 — пн 06:00 UTC.
  for (let hour = 94; hour <= 102; hour += 1) bars.push(bar(START + hour * HOUR));
  return bars;
};

const cryptoBars = (): Candle[] =>
  Array.from({ length: 103 }, (_, hour) => bar(START + hour * HOUR));

const at = (hour: number) => START + hour * HOUR;

test("сессия целиком внутри закрытого рынка отбрасывается", () => {
  const bars = forexBars();
  // Субботние сессии: рынок стоит, баров нет ни одного.
  assert.equal(clampSegmentToBars({ start: at(55), end: at(64) }, bars, HOUR), null);
  assert.equal(clampSegmentToBars({ start: at(70), end: at(79) }, bars, HOUR), null);
  // Воскресная сессия Сиднея заканчивается до открытия рынка.
  assert.equal(clampSegmentToBars({ start: at(85), end: at(93) }, bars, HOUR), null);
});

test("край сессии в закрытом рынке притягивается к ближайшему бару", () => {
  const bars = forexBars();

  // Сессия начинается в пятницу и переживает закрытие рынка.
  assert.deepEqual(
    clampSegmentToBars({ start: at(40), end: at(49) }, bars, HOUR),
    { start: at(40), end: at(45) },
  );

  // Сессия начинается в тишине выходных и захватывает открытие недели.
  assert.deepEqual(
    clampSegmentToBars({ start: at(92), end: at(101) }, bars, HOUR),
    { start: at(94), end: at(101) },
  );
});

test("сессия внутри торговых часов не меняется", () => {
  const bars = forexBars();
  assert.deepEqual(
    clampSegmentToBars({ start: at(8), end: at(17) }, bars, HOUR),
    { start: at(8), end: at(17) },
  );
});

test("на круглосуточных данных обрезка не срабатывает", () => {
  const bars = cryptoBars();
  for (const start of [0, 8, 55, 70, 85, 92]) {
    assert.deepEqual(
      clampSegmentToBars({ start: at(start), end: at(start + 9) }, bars, HOUR),
      { start: at(start), end: at(start + 9) },
    );
  }
});

test("границы за пределами загруженного окна остаются как есть", () => {
  const bars = forexBars();
  // Слева и справа график экстраполирует шкалу — там простоя рынка нет.
  assert.deepEqual(
    clampSegmentToBars({ start: at(-6), end: at(3) }, bars, HOUR),
    { start: at(-6), end: at(3) },
  );
  assert.deepEqual(
    clampSegmentToBars({ start: at(99), end: at(108) }, bars, HOUR),
    { start: at(99), end: at(108) },
  );
});

test("на дневных барах ночь между барами не считается простоем", () => {
  const daily = Array.from({ length: 10 }, (_, day) => bar(START + day * 24 * HOUR));
  const step = 24 * HOUR;
  assert.deepEqual(
    clampSegmentToBars({ start: at(8), end: at(17) }, daily, step),
    { start: at(8), end: at(17) },
  );
});
