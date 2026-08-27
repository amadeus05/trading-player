import assert from "node:assert/strict";
import test from "node:test";
import { collectEarlierCandles } from "../../src/features/datasets/earlierCandles";
import {
  buildReplayStartMarketCandleRange,
  MARKET_TIMEFRAME_PREFETCH_BARS,
  prefetchMarketCandleThresholdForTimeframe,
  REPLAY_BACK_TIMEFRAME_BARS,
  shouldPrefetchMarketCandles,
} from "../../src/features/datasets/marketCandleRanges";
import type { Candle } from "../../src/types";

const HOUR_SECONDS = 3_600;
const HOUR_MS = 3_600_000;
const DAY_SECONDS = 24 * HOUR_SECONDS;

const bar = (timeSeconds: number): Candle => ({
  time: timeSeconds,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
});

/**
 * Часовой рынок с выходными: неделя торгуется, суббота и воскресенье закрыты.
 * 1 января 1970 — четверг, поэтому смещаем начало на понедельник.
 */
const MONDAY = 4 * DAY_SECONDS;

const isOpen = (timeSeconds: number): boolean => {
  const dayOfWeek = Math.floor((timeSeconds - MONDAY) / DAY_SECONDS) % 7;
  return dayOfWeek >= 0 && dayOfWeek < 5;
};

interface Feed {
  boundary: { from: number; to: number };
  bars: Candle[];
  fetchRange: (fromMs: number, toMs: number) => Promise<Candle[]>;
  requests: number;
}

/** weeks недель часовых баров: closed=false даёт круглосуточный рынок, как крипта. */
const feed = (weeks: number, closed: boolean): Feed => {
  const bars: Candle[] = [];
  for (let hour = 0; hour < weeks * 7 * 24; hour += 1) {
    const time = MONDAY + hour * HOUR_SECONDS;
    if (!closed || isOpen(time)) bars.push(bar(time));
  }
  // Отдаём именно state.bars: тесту нужно уметь вырезать из рынка паузу.
  const state: Feed = {
    boundary: { from: bars[0].time * 1_000, to: bars.at(-1)!.time * 1_000 },
    bars,
    requests: 0,
    fetchRange: async (fromMs: number, toMs: number) => {
      state.requests += 1;
      return state.bars.filter((item) => item.time * 1_000 >= fromMs && item.time * 1_000 < toMs);
    },
  };
  return state;
};

/** Тянет график влево шаг за шагом и проверяет каждый добор. */
const panLeft = async (source: Feed, startIndex: number, steps: number[]) => {
  let loaded = source.bars.slice(startIndex, startIndex + 80);
  const shortfalls: string[] = [];

  for (const missingBars of steps) {
    const appended = await collectEarlierCandles({
      boundary: source.boundary,
      loaded,
      missingBars,
      fallbackTimeframeMinutes: 60,
      fetchRange: source.fetchRange,
    });

    if (appended.length !== missingBars) {
      shortfalls.push(`просили ${missingBars}, добрали ${appended.length}`);
    }
    if (appended.length) {
      assert.ok(
        appended.at(-1)!.time < loaded[0].time,
        "добранные бары должны лежать строго левее окна",
      );
      const expected = source.bars
        .filter((item) => item.time < loaded[0].time)
        .slice(-missingBars);
      assert.deepEqual(appended, expected, "добираются именно ближайшие бары, без дыр");
    }
    loaded = [...appended, ...loaded];
  }

  return shortfalls;
};

test("догрузка влево на форексе добирает ровно до края рамки из любой точки недели", async () => {
  const forex = feed(12, true);
  const steps = [4, 1, 7, 2, 30, 3, 12, 1];

  // Левый край окна проходит по всем часам недели: где-то рядом выходные, где-то нет.
  for (let startIndex = 200; startIndex < forex.bars.length - 80; startIndex += 7) {
    const shortfalls = await panLeft(forex, startIndex, steps);
    assert.deepEqual(shortfalls, [], `край ${new Date(forex.bars[startIndex].time * 1_000).toISOString()}`);
  }
});

test("догрузка влево на круглосуточном рынке не изменилась: один запрос на шаг", async () => {
  const crypto = feed(12, false);
  const before = crypto.requests;

  const shortfalls = await panLeft(crypto, 400, [4, 1, 7, 2, 30, 3, 12, 1]);

  assert.deepEqual(shortfalls, []);
  assert.equal(crypto.requests - before, 8, "восемь шагов — восемь запросов, без расширений");
});

test("догрузка влево у начала истории отдаёт остаток и не зовёт биржу без конца", async () => {
  const forex = feed(12, true);
  const loaded = forex.bars.slice(3, 83);
  const before = forex.requests;

  const appended = await collectEarlierCandles({
    boundary: forex.boundary,
    loaded,
    missingBars: 50,
    fallbackTimeframeMinutes: 60,
    fetchRange: forex.fetchRange,
  });

  assert.deepEqual(appended, forex.bars.slice(0, 3), "слева осталось всего три бара");
  assert.equal(forex.requests - before, 1, "упёрлись в начало истории с первого запроса");
});

test("догрузка влево ничего не просит, когда просить нечего", async () => {
  const forex = feed(12, true);
  const before = forex.requests;

  assert.deepEqual(
    await collectEarlierCandles({
      boundary: forex.boundary,
      loaded: forex.bars.slice(100, 180),
      missingBars: 0,
      fallbackTimeframeMinutes: 60,
      fetchRange: forex.fetchRange,
    }),
    [],
  );
  assert.deepEqual(
    await collectEarlierCandles({
      boundary: forex.boundary,
      loaded: [],
      missingBars: 10,
      fallbackTimeframeMinutes: 60,
      fetchRange: forex.fetchRange,
    }),
    [],
  );
  assert.deepEqual(
    await collectEarlierCandles({
      boundary: { from: forex.bars[0].time * 1_000, to: forex.boundary.to },
      loaded: forex.bars.slice(0, 80),
      missingBars: 10,
      fallbackTimeframeMinutes: 60,
      fetchRange: forex.fetchRange,
    }),
    [],
    "окно уже начинается с первого бара истории",
  );
  assert.equal(forex.requests, before, "ни одного лишнего запроса");
});

/**
 * Повторяет loadAroundTime: окно прыжка меряется календарём, а рамке нужно
 * REPLAY_BACK_TIMEFRAME_BARS баров слева от точки старта. Недостача добирается.
 */
const jumpPrehistory = async (source: Feed, targetSeconds: number) => {
  const range = buildReplayStartMarketCandleRange(source.boundary, targetSeconds * 1_000, 60);
  assert.ok(range, "окно прыжка должно строиться");
  const rows = await source.fetchRange(range.from, range.to);

  let prehistory = 0;
  while (prehistory < rows.length && rows[prehistory].time < targetSeconds) prehistory += 1;

  const missingBars = REPLAY_BACK_TIMEFRAME_BARS - prehistory;
  const earlier = missingBars > 0
    ? await collectEarlierCandles({
      boundary: source.boundary,
      loaded: rows,
      missingBars,
      fallbackTimeframeMinutes: 60,
      fetchRange: source.fetchRange,
    })
    : [];

  return { requested: prehistory, total: prehistory + earlier.length };
};

test("прыжок на форексе набирает полную предысторию рамки в любой точке недели", async () => {
  const forex = feed(12, true);
  let shortWindows = 0;

  for (let index = 200; index < forex.bars.length - 200; index += 3) {
    const { requested, total } = await jumpPrehistory(forex, forex.bars[index].time);
    if (requested < REPLAY_BACK_TIMEFRAME_BARS) shortWindows += 1;
    assert.equal(
      total,
      REPLAY_BACK_TIMEFRAME_BARS,
      `предыстория для ${new Date(forex.bars[index].time * 1_000).toISOString()}`,
    );
  }

  assert.ok(shortWindows > 0, "тест бессмысленен, если календарное окно нигде не недобирало");
});

test("прыжок на круглосуточном рынке набирает рамку одним запросом", async () => {
  const crypto = feed(12, false);
  const before = crypto.requests;

  const { requested, total } = await jumpPrehistory(crypto, crypto.bars[400].time);

  assert.equal(requested, REPLAY_BACK_TIMEFRAME_BARS, "календарное окно сразу даёт полную рамку");
  assert.equal(total, REPLAY_BACK_TIMEFRAME_BARS);
  assert.equal(crypto.requests - before, 1, "добор не понадобился");
});

/** Ведёт голову по окну и возвращает запас в барах на момент срабатывания подкачки. */
const prefetchHeadroom = (window: Candle[], timeframeMinutes: number): number => {
  const threshold = prefetchMarketCandleThresholdForTimeframe(timeframeMinutes);
  for (let index = 0; index < window.length; index += 1) {
    if (shouldPrefetchMarketCandles(window, window[index].time, threshold)) {
      return window.length - 1 - index;
    }
  }
  return -1;
};

test("подкачка вперёд просыпается заранее, даже если окно кончается после выходных", () => {
  const forex = feed(12, true);
  // Худший случай: последний бар окна — первый после выходных, поэтому
  // календарный остаток раздут почти на трое суток.
  const weekendEdge = forex.bars.findIndex((item, index) =>
    index > 300 && item.time - forex.bars[index - 1].time > 24 * HOUR_SECONDS);
  const window = forex.bars.slice(weekendEdge - 200, weekendEdge + 1);

  assert.ok(
    prefetchHeadroom(window, 60) >= MARKET_TIMEFRAME_PREFETCH_BARS,
    "подкачка должна успевать до края окна",
  );
});

test("подкачка на круглосуточном рынке срабатывает там же, где и раньше", () => {
  const crypto = feed(12, false);
  const window = crypto.bars.slice(0, 300);
  const threshold = prefetchMarketCandleThresholdForTimeframe(60);

  // Календарный порог для часовки — двадцать баров, ровно как и было.
  assert.equal(shouldPrefetchMarketCandles(window, window[279].time, threshold), true);
  assert.equal(shouldPrefetchMarketCandles(window, window[278].time, threshold), false);
});

test("догрузка влево перешагивает длинную паузу рынка", async () => {
  const source = feed(12, true);
  // Рождественская пауза: выбрасываем шесть суток подряд из середины истории.
  const holidayStart = source.bars[600].time;
  const holidayEnd = holidayStart + 6 * DAY_SECONDS;
  source.bars = source.bars.filter((item) => item.time < holidayStart || item.time >= holidayEnd);

  const firstAfterHoliday = source.bars.findIndex((item) => item.time >= holidayEnd);
  const loaded = source.bars.slice(firstAfterHoliday, firstAfterHoliday + 80);

  const appended = await collectEarlierCandles({
    boundary: source.boundary,
    loaded,
    missingBars: 2,
    fallbackTimeframeMinutes: 60,
    fetchRange: source.fetchRange,
  });

  assert.deepEqual(appended, source.bars.slice(firstAfterHoliday - 2, firstAfterHoliday));
  assert.ok(appended[0].time < holidayStart, "бары взяты до паузы");
});
