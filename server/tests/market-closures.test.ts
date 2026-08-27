import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_INTERVAL_MS,
  isClosedMarketCandle,
  type Candle,
  type Timeframe,
} from "../domain/Candle.js";
import type { DownloadRequest } from "../domain/MarketRequest.js";
import type { MarketDataProvider } from "../application/ports/MarketDataProvider.js";
import { buildClosedMarketCandles, MAX_CLOSURE_MS, mergeAdjacentSpans } from "../application/marketClosures.js";
import { CandleValidator } from "../application/CandleValidator.js";
import { MarketDataService } from "../application/MarketDataService.js";
import { RangePlanner } from "../application/RangePlanner.js";
import { BinaryCandleStore } from "../infrastructure/BinaryCandleStore.js";

const START = Date.UTC(2026, 0, 1);
const PAGE_SPAN = BASE_INTERVAL_MS * 1_000;

/** Таймфрейм ровно из трёх базовых свечей — как в resampler.test.ts. */
const TRIPLE = `${3 * (BASE_INTERVAL_MS / 60_000)}m` as Timeframe;

const minute = (index: number) => START + index * BASE_INTERVAL_MS;

const candleAt = (openTime: number, price: number): Candle => ({
  openTime,
  open: price,
  high: price + 2,
  low: price - 1,
  close: price + 1,
  volume: 10,
  turnover: 1_000,
});

const real = (index: number) => candleAt(minute(index), 100 + index);
const span = (fromIndex: number, toIndex: number) => ({ from: minute(fromIndex), to: minute(toIndex) });

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

describe("buildClosedMarketCandles", () => {
  test("дырка внутри диапазона застраивается последней ценой и помечается", () => {
    const source = [real(0), real(3)];
    const closed = buildClosedMarketCandles(source, [span(0, 4)]);

    assert.deepEqual(closed.map((candle) => candle.openTime), [minute(1), minute(2)]);
    for (const candle of closed) {
      const flat = source[0].close;
      assert.deepEqual([candle.open, candle.high, candle.low, candle.close], [flat, flat, flat, flat]);
      assert.equal(candle.volume, 0);
      assert.equal(isClosedMarketCandle(candle), true);
    }
  });

  /**
   * У края диапазона молчание провайдера выглядит ровно так же, как закрытый
   * рынок, а застроенную минуту уже никто не перекачает. Поэтому края остаются
   * дырками и попросятся снова.
   */
  test("края диапазона не застраиваются", () => {
    assert.deepEqual(buildClosedMarketCandles([real(2), real(3)], [span(0, 6)]), []);
  });

  test("пауза длиннее предела остаётся дыркой", () => {
    const cap = MAX_CLOSURE_MS / BASE_INTERVAL_MS;

    assert.equal(buildClosedMarketCandles([real(0), real(cap + 1)], [span(0, cap + 2)]).length, cap);
    assert.deepEqual(buildClosedMarketCandles([real(0), real(cap + 2)], [span(0, cap + 3)]), []);
  });

  /**
   * Между несмежными страницами может лежать уже скачанная история: застройка
   * через неё перезаписала бы настоящие свечи ровной ценой.
   */
  test("между несмежными диапазонами не застраивается ничего", () => {
    const source = [real(0), real(1), real(10), real(11)];

    assert.deepEqual(buildClosedMarketCandles(source, [span(0, 2), span(10, 12)]), []);
  });

  test("смежные страницы склеиваются, поэтому пауза между ними застраивается", () => {
    const closed = buildClosedMarketCandles([real(0), real(5)], [span(0, 3), span(3, 6)]);

    assert.deepEqual(closed.map((candle) => candle.openTime), [minute(1), minute(2), minute(3), minute(4)]);
    assert.deepEqual(mergeAdjacentSpans([span(3, 6), span(0, 3)]), [span(0, 6)]);
  });

  test("без пары свечей и без диапазонов застраивать нечего", () => {
    assert.deepEqual(buildClosedMarketCandles([real(0)], [span(0, 4)]), []);
    assert.deepEqual(buildClosedMarketCandles([real(0), real(3)], []), []);
  });
});

describe("BinaryCandleStore с закрытыми минутами", () => {
  let root: string;
  let store: BinaryCandleStore;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "candle-closures-"));
    store = new BinaryCandleStore(root);
    await store.init();
  });

  after(async () => {
    await store.close();
    await rmWithRetry(root);
  });

  const writeWithClosures = async (symbol: string, source: Candle[], spans: Array<{ from: number; to: number }>) => {
    await store.write("linear", symbol, [...source, ...buildClosedMarketCandles(source, spans)]);
  };

  test("закрытая минута не отдаётся, но держит бакет старшего таймфрейма", async () => {
    const source = [real(0), real(2)];
    await writeWithClosures("CLOSUREBUCKET", source, [span(0, 3)]);

    const minutes = await store.read("linear", "CLOSUREBUCKET", "1m", minute(0), minute(3));
    assert.deepEqual(minutes.map((candle) => candle.openTime), [minute(0), minute(2)]);

    const buckets = await store.read("linear", "CLOSUREBUCKET", TRIPLE, minute(0), minute(3));
    assert.equal(buckets.length, 1, "бакет с закрытой минутой внутри должен собраться");
    assert.deepEqual(buckets[0], {
      openTime: minute(0),
      open: source[0].open,
      high: Math.max(source[0].high, source[1].high),
      low: Math.min(source[0].low, source[1].low),
      close: source[1].close,
      volume: source[0].volume + source[1].volume,
      turnover: source[0].turnover + source[1].turnover,
    });
  });

  test("бакет из одних закрытых минут не отдаётся", async () => {
    await writeWithClosures("WEEKEND", [real(0), real(6)], [span(0, 7)]);

    const buckets = await store.read("linear", "WEEKEND", TRIPLE, minute(0), minute(6));
    assert.deepEqual(buckets.map((candle) => candle.openTime), [minute(0)]);
  });

  test("страница с закрытыми минутами считается скачанной", async () => {
    await writeWithClosures("PAGECLOSED", [real(0), real(999)], [span(0, 1_000)]);

    const page: DownloadRequest = { category: "linear", symbol: "PAGECLOSED", from: START, to: START + PAGE_SPAN };
    assert.deepEqual(await store.missingPages([page]), []);
  });

  test("каталог считает настоящие свечи, а не застроенные минуты", async () => {
    await writeWithClosures("CATALOGCLOSED", [real(0), real(4)], [span(0, 5)]);

    const entry = (await store.catalog()).find((item) => item.symbol === "CATALOGCLOSED");
    assert.ok(entry, "символ должен попасть в каталог");
    assert.equal(entry.candles, 2);
    assert.equal(entry.from, minute(0));
    assert.equal(entry.to, minute(5));
  });
});

/**
 * Провайдер, отдающий только первую и последнюю минуту страницы: так выглядит
 * форекс, где внутри страницы полно минут без тиков.
 */
class EdgeOnlyProvider implements MarketDataProvider {
  async getPage(request: DownloadRequest): Promise<Candle[]> {
    const last = request.to - BASE_INTERVAL_MS;
    return [candleAt(request.from, 500), candleAt(last, 600)];
  }
}

describe("MarketDataService.download", () => {
  let root: string;
  let store: BinaryCandleStore;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "candle-download-"));
    store = new BinaryCandleStore(root);
    await store.init();
  });

  after(async () => {
    await store.close();
    await rmWithRetry(root);
  });

  test("застраивает только скачанные страницы и не трогает уже лежащее на диске", async () => {
    const service = new MarketDataService(new EdgeOnlyProvider(), store, new RangePlanner(), new CandleValidator());
    // Средняя страница уже полностью на диске: её свечи должны остаться как есть.
    const stored = Array.from({ length: 1_000 }, (_, index) => real(1_000 + index));
    await store.write("linear", "EDGES", stored);

    const result = await service.download({
      category: "linear",
      symbol: "EDGES",
      from: START,
      to: START + 3 * PAGE_SPAN,
    });

    assert.equal(result.downloadedPages, 2, "качаются только крайние страницы");
    assert.equal(result.closures, 2 * 998, "внутренности крайних страниц застроены");

    const middle = await store.read("linear", "EDGES", "1m", minute(1_000), minute(2_000));
    assert.equal(middle.length, stored.length, "средняя страница осталась целой");
    assert.deepEqual(middle[0], stored[0]);
    assert.deepEqual(middle.at(-1), stored.at(-1));

    const first = await store.read("linear", "EDGES", "1m", START, START + PAGE_SPAN);
    assert.deepEqual(first.map((candle) => candle.openTime), [minute(0), minute(999)]);

    const pages: DownloadRequest[] = [0, 1, 2].map((index) => ({
      category: "linear",
      symbol: "EDGES",
      from: START + index * PAGE_SPAN,
      to: START + (index + 1) * PAGE_SPAN,
    }));
    assert.deepEqual(await store.missingPages(pages), [], "все три страницы закрыты");
  });
});
