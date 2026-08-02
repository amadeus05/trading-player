import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_INTERVAL_MS, type Candle, type Timeframe } from "../domain/Candle.js";
import type { CandleRepository } from "../application/ports/CandleRepository.js";
import { ParquetCandleStore } from "../infrastructure/ParquetCandleStore.js";
import { BinaryCandleStore } from "../infrastructure/BinaryCandleStore.js";

const START = Date.UTC(2026, 0, 1);

interface Store extends CandleRepository {
  init(): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rmWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code === "EPERM" || code === "ENOTEMPTY") return;
        throw error;
      }
      await sleep(50 * (attempt + 1));
    }
  }
}

function candles(count: number, start = START): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    openTime: start + i * BASE_INTERVAL_MS,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: i + 1,
    turnover: (i + 1) * 1000,
  }));
}

/**
 * Один и тот же набор проверок гоняется по обеим реализациям хранилища: пока
 * parquet и бинарь живут рядом, это единственная гарантия, что подмена стора в
 * server/index.ts ничего не меняет для вызывающего кода.
 */
const implementations: Array<[string, (root: string) => Store]> = [
  ["ParquetCandleStore", (root) => new ParquetCandleStore(root)],
  ["BinaryCandleStore", (root) => new BinaryCandleStore(root)],
];

for (const [name, create] of implementations) {
  describe(name, () => {
    let root: string;
    let store: Store;

    before(async () => {
      root = await mkdtemp(join(tmpdir(), "candle-resampler-"));
      store = create(root);
      await store.init();
    });

    after(async () => {
      await store.close();
      await rmWithRetry(root);
    });

    test("15m uses first open, maximum high, minimum low, last close and summed volume", async () => {
      const source = candles(6);
      await store.write("linear", "OHLCVTEST", source);
      const result = await store.read("linear", "OHLCVTEST", "15m", START, START + 6 * BASE_INTERVAL_MS);
      assert.equal(result.length, 2);
      assert.deepEqual(result[0], {
        openTime: START,
        open: source[0].open,
        high: source[2].high,
        low: source[0].low,
        close: source[2].close,
        volume: source[0].volume + source[1].volume + source[2].volume,
        turnover: source[0].turnover + source[1].turnover + source[2].turnover,
      });
      assert.equal(result[1].openTime, START + 15 * 60_000);
      assert.equal(result[1].open, source[3].open);
      assert.equal(result[1].close, source[5].close);
    });

    test("every supported timeframe has the expected number of complete UTC buckets", async () => {
      const source = candles(288);
      await store.write("linear", "COUNTTEST", source);
      const expected: Record<Timeframe, number> = {
        "5m": 288, "10m": 144, "15m": 96, "30m": 48,
        "1h": 24, "2h": 12, "3h": 8, "4h": 6, "6h": 4, "12h": 2, "1d": 1,
      };
      for (const [timeframe, count] of Object.entries(expected) as [Timeframe, number][]) {
        const result = await store.read("linear", "COUNTTEST", timeframe, START, START + 86_400_000);
        assert.equal(result.length, count, `${timeframe} bucket count`);
        assert.equal(result[0].openTime, START, `${timeframe} UTC alignment`);
      }
    });

    test("a bucket containing a missing 5m candle is rejected without damaging adjacent buckets", async () => {
      const source = candles(9).filter((_, index) => index !== 1);
      await store.write("linear", "GAPTEST", source);
      const result = await store.read("linear", "GAPTEST", "15m", START, START + 9 * BASE_INTERVAL_MS);
      assert.deepEqual(result.map((c) => c.openTime), [START + 15 * 60_000, START + 30 * 60_000]);
    });

    test("an incomplete final bucket is never exposed", async () => {
      const source = candles(5);
      await store.write("linear", "PARTIALTEST", source);
      const result = await store.read("linear", "PARTIALTEST", "15m", START, START + 5 * BASE_INTERVAL_MS);
      assert.equal(result.length, 1);
      assert.equal(result[0].close, source[2].close);
    });

    test("duplicate source timestamps are deduplicated before resampling", async () => {
      const source = candles(3);
      await store.write("linear", "DEDUPE", [...source, { ...source[1] }]);
      const result = await store.read("linear", "DEDUPE", "15m", START, START + 3 * BASE_INTERVAL_MS);
      assert.equal(result.length, 1);
      assert.equal(result[0].volume, 6);
    });

    test("catalog reports the stored range and candle count", async () => {
      await store.write("linear", "CATALOGTEST", candles(12));
      const entry = (await store.catalog()).find((item) => item.symbol === "CATALOGTEST");
      assert.ok(entry, "символ должен попасть в каталог");
      assert.equal(entry.candles, 12);
      assert.equal(entry.from, START);
      assert.equal(entry.to, START + 12 * BASE_INTERVAL_MS);
      assert.ok(entry.bytes > 0, "размер на диске должен быть положительным");
    });


    // Страницы всегда ровно по 1000 базовых свечей — так их нарезает
    // RangePlanner, и parquet-реализация считает индекс страницы исходя из
    // этого шага. Тест обязан идти тем же шагом, иначе проверяет несуществующий
    // сценарий.
    test("missingPages returns only the pages that are not fully stored", async () => {
      const pageSpan = BASE_INTERVAL_MS * 1_000;
      await store.write("linear", "PAGETEST", candles(1_000));
      const pages = [
        { category: "linear" as const, symbol: "PAGETEST", from: START, to: START + pageSpan },
        { category: "linear" as const, symbol: "PAGETEST", from: START + pageSpan, to: START + 2 * pageSpan },
      ];
      assert.deepEqual(await store.missingPages(pages), [pages[1]]);
    });

    test("remove deletes the symbol and reports whether there was anything to delete", async () => {
      await store.write("linear", "REMOVETEST", candles(6));
      assert.equal(await store.remove("linear", "REMOVETEST"), true);
      assert.equal((await store.catalog()).some((item) => item.symbol === "REMOVETEST"), false);
      assert.equal(await store.remove("linear", "REMOVETEST"), false);
    });
  });
}
