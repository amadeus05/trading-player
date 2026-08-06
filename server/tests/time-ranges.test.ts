import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTimeRangeCovered,
  lowerBoundByTime,
  mergeTimeRanges,
  subtractTimeRanges,
} from "../../src/features/datasets/timeRanges.ts";

test("слияние склеивает пересекающиеся и смежные диапазоны", () => {
  assert.deepEqual(
    mergeTimeRanges([{ from: 10, to: 20 }, { from: 15, to: 30 }]),
    [{ from: 10, to: 30 }],
  );
  assert.deepEqual(
    mergeTimeRanges([{ from: 10, to: 20 }, { from: 20, to: 30 }]),
    [{ from: 10, to: 30 }],
  );
  assert.deepEqual(
    mergeTimeRanges([{ from: 30, to: 40 }, { from: 10, to: 20 }]),
    [{ from: 10, to: 20 }, { from: 30, to: 40 }],
  );
});

test("слияние не мутирует вход", () => {
  const input = [{ from: 10, to: 20 }, { from: 15, to: 30 }];
  mergeTimeRanges(input);
  assert.deepEqual(input, [{ from: 10, to: 20 }, { from: 15, to: 30 }]);
});

test("вычитание находит дырки по краям и в середине", () => {
  assert.deepEqual(
    subtractTimeRanges({ from: 0, to: 100 }, [{ from: 20, to: 40 }]),
    [{ from: 0, to: 20 }, { from: 40, to: 100 }],
  );
  assert.deepEqual(
    subtractTimeRanges({ from: 0, to: 100 }, [{ from: 0, to: 60 }]),
    [{ from: 60, to: 100 }],
  );
  assert.deepEqual(subtractTimeRanges({ from: 0, to: 100 }, [{ from: 0, to: 100 }]), []);
  assert.deepEqual(
    subtractTimeRanges({ from: 0, to: 100 }, [{ from: 200, to: 300 }]),
    [{ from: 0, to: 100 }],
  );
});

test("покрытие собирается из нескольких соседних окон", () => {
  const covered = mergeTimeRanges([{ from: 0, to: 50 }, { from: 50, to: 100 }]);
  assert.equal(isTimeRangeCovered({ from: 10, to: 90 }, covered), true);
  assert.equal(isTimeRangeCovered({ from: 10, to: 110 }, covered), false);
});

test("окно, помеченное покрытым, больше не запрашивается повторно", () => {
  // Профиль на самом краю истории: спросили больше, чем есть в каталоге.
  // Помечаем покрытым запрошенное, иначе дырка осталась бы навсегда.
  const covered = mergeTimeRanges([{ from: 0, to: 1_000 }]);
  assert.equal(isTimeRangeCovered({ from: 0, to: 1_000 }, covered), true);
});

test("нижняя граница находит место вставки по времени", () => {
  const items = [{ time: 10 }, { time: 20 }, { time: 30 }];
  assert.equal(lowerBoundByTime(items, 5), 0);
  assert.equal(lowerBoundByTime(items, 20), 1);
  assert.equal(lowerBoundByTime(items, 25), 2);
  assert.equal(lowerBoundByTime(items, 40), 3);
  assert.equal(lowerBoundByTime([], 10), 0);
});
