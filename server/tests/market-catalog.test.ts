import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_INTERVAL_MS, type Candle } from "../domain/Candle.js";
import { MARKET_CATEGORIES } from "../domain/MarketRequest.js";
import { BinaryCandleStore } from "../infrastructure/BinaryCandleStore.js";

const START = Date.UTC(2026, 0, 1);

let root: string;
let store: BinaryCandleStore;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "candle-catalog-"));
  store = new BinaryCandleStore(root);
  await store.init();
});

after(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

const candles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => ({
    openTime: START + index * BASE_INTERVAL_MS,
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index,
    volume: 1, turnover: 0,
  }));

/**
 * Список категорий в обходе каталога однажды уже разъехался с доменным: forex
 * писался на диск, читался по прямому запросу и при этом не показывался в UI.
 * Проверяем именно доменный список, чтобы следующая категория не потерялась так
 * же тихо.
 */
test("каталог показывает символы во всех категориях домена", async () => {
  for (const category of MARKET_CATEGORIES) {
    await store.write(category, "TESTSYM", candles(5));
  }

  const listed = await store.catalog();
  assert.deepEqual(
    listed.map((item) => item.category).sort(),
    [...MARKET_CATEGORIES].sort(),
  );
  for (const item of listed) assert.equal(item.candles, 5);
});
