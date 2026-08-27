import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { BASE_INTERVAL_MS } from "../domain/Candle.js";
import { HistDataClient } from "../infrastructure/HistDataClient.js";
import { archivePeriods } from "../infrastructure/histdata/archivePeriods.js";
import { parseHistDataCsv, sliceCandles } from "../infrastructure/histdata/histDataCsv.js";
import { parseHistDataInstruments } from "../infrastructure/histdata/instrumentIndex.js";
import { readZipEntries } from "../infrastructure/histdata/zipArchive.js";

const DEFLATED = 8;
const STREAMED = 0x0008;

/**
 * Собирает zip так же, как HistData: размеры в локальных заголовках нулевые и
 * лежат в дескрипторе после данных. Именно на таком архиве ломается наивный
 * разбор по локальным заголовкам, поэтому тесты идут против него.
 */
function buildStreamedZip(files: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "latin1");
    const raw = Buffer.from(file.content, "latin1");
    const packed = deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(STREAMED, 6);
    local.writeUInt16LE(DEFLATED, 8);
    local.writeUInt16LE(name.length, 26);

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(packed.length, 8);
    descriptor.writeUInt32LE(raw.length, 12);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(STREAMED, 8);
    entry.writeUInt16LE(DEFLATED, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);

    locals.push(local, name, packed, descriptor);
    directory.push(entry, name);
    offset += local.length + name.length + packed.length + descriptor.length;
  }

  const body = Buffer.concat([...locals, ...directory]);
  const directorySize = directory.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([body, end]);
}

describe("readZipEntries", () => {
  test("читает потоковый архив с нулевыми размерами в локальных заголовках", () => {
    const archive = buildStreamedZip([
      { name: "DAT_ASCII_EURUSD_M1_2021.csv", content: "20210103 170000;1.1;1.2;1.0;1.15;0\n" },
      { name: "DAT_ASCII_EURUSD_M1_2021.txt", content: "отчёт" },
    ]);

    const entries = readZipEntries(archive);

    assert.deepEqual(entries.map((entry) => entry.name), [
      "DAT_ASCII_EURUSD_M1_2021.csv",
      "DAT_ASCII_EURUSD_M1_2021.txt",
    ]);
    assert.equal(entries[0].data.toString("latin1"), "20210103 170000;1.1;1.2;1.0;1.15;0\n");
  });

  test("не zip распознаётся ошибкой, а не мусором", () => {
    assert.throws(() => readZipEntries(Buffer.from("<html>ошибка</html>")), /не zip/i);
  });
});

const row = (stamp: string) => `${stamp};1.1;1.2;1.0;1.15;0`;

describe("parseHistDataCsv", () => {
  /**
   * Открытие недели — это 17:00 Нью-Йорка, то есть 22:00 UTC зимой и 21:00
   * летом. Зимой метка приходит с сдвигом в пять часов, летом в четыре, и
   * перепутать их значит увести историю на час.
   */
  test("зимнее открытие недели даёт сдвиг пять часов", () => {
    const packed = parseHistDataCsv("20210103 170000;1.22396;1.22400;1.22373;1.22395;0\n");

    assert.equal(packed.times[0], Date.UTC(2021, 0, 3, 22, 0));
    assert.deepEqual(sliceCandles(packed, packed.times[0], packed.times[0] + BASE_INTERVAL_MS), [{
      openTime: Date.UTC(2021, 0, 3, 22, 0),
      open: 1.22396,
      high: 1.224,
      low: 1.22373,
      close: 1.22395,
      volume: 0,
      turnover: 0,
    }]);
  });

  test("летнее открытие недели даёт сдвиг четыре часа", () => {
    const packed = parseHistDataCsv(row("20210704 170000"));

    assert.equal(packed.times[0], Date.UTC(2021, 6, 4, 21, 0));
  });

  /**
   * Между переходами в США и Европе метка съезжает на час: 14 марта 2021 США уже
   * на летнем времени, Европа ещё нет, и неделя открывается меткой 16:00.
   * Календарное правило здесь и промахивается, а якорь по открытию — нет.
   */
  test("неделя между переходами США и Европы читается верно", () => {
    const packed = parseHistDataCsv(row("20210314 160000"));

    assert.equal(packed.times[0], Date.UTC(2021, 2, 14, 21, 0));
  });

  /** Так выглядит переход на зимнее время у источника: час приходит дважды. */
  test("повторённый источником час отбрасывается", () => {
    const packed = parseHistDataCsv([
      "20211031 160000", "20211031 160100",
      "20211031 190000", "20211031 190100",
      "20211031 190000", "20211031 190100",
      "20211031 200000",
    ].map(row).join("\n"));

    assert.deepEqual([...packed.times], [
      Date.UTC(2021, 9, 31, 21, 0),
      Date.UTC(2021, 9, 31, 21, 1),
      Date.UTC(2021, 10, 1, 0, 0),
      Date.UTC(2021, 10, 1, 0, 1),
      Date.UTC(2021, 10, 1, 1, 0),
    ]);
  });

  /** Месячный архив начинается посреди недели, и тогда якорем служит её конец. */
  test("кусок без открытия недели опирается на пятничное закрытие", () => {
    const packed = parseHistDataCsv([row("20210709 165800"), row("20210709 165900")].join("\n"));

    assert.deepEqual([...packed.times], [Date.UTC(2021, 6, 9, 20, 58), Date.UTC(2021, 6, 9, 20, 59)]);
  });

  test("битые и пустые строки пропускаются", () => {
    const packed = parseHistDataCsv([
      row("20210103 170000"),
      "",
      "мусор",
      "20210103 170100;нечисло;1.2;1.0;1.15;0",
      row("20210103 170200"),
    ].join("\n"));

    assert.deepEqual([...packed.times], [Date.UTC(2021, 0, 3, 22, 0), Date.UTC(2021, 0, 3, 22, 2)]);
  });
});

describe("sliceCandles", () => {
  const packed = parseHistDataCsv(
    Array.from({ length: 5 }, (_, index) => row(`20210103 17${String(index).padStart(2, "0")}00`)).join("\n"),
  );
  const start = Date.UTC(2021, 0, 3, 22, 0);

  test("правая граница не включается", () => {
    const candles = sliceCandles(packed, start + BASE_INTERVAL_MS, start + 3 * BASE_INTERVAL_MS);

    assert.deepEqual(candles.map((candle) => candle.openTime), [start + BASE_INTERVAL_MS, start + 2 * BASE_INTERVAL_MS]);
  });

  test("вне истории отдаётся пусто", () => {
    assert.deepEqual(sliceCandles(packed, start - 10 * BASE_INTERVAL_MS, start), []);
    assert.deepEqual(sliceCandles(packed, start + 100 * BASE_INTERVAL_MS, start + 200 * BASE_INTERVAL_MS), []);
  });
});

describe("archivePeriods", () => {
  test("завершённый год берётся одним архивом", () => {
    const from = Date.UTC(2021, 5, 1);
    const to = Date.UTC(2021, 7, 1);

    assert.deepEqual(archivePeriods(from, to, 2026), [{ year: 2021, month: null }]);
  });

  test("текущий год разбит по месяцам", () => {
    const from = Date.UTC(2026, 0, 20);
    const to = Date.UTC(2026, 2, 5);

    assert.deepEqual(archivePeriods(from, to, 2026), [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ]);
  });

  /**
   * Первые часы января по UTC лежат в архиве предыдущего года: он размечен
   * своими метками и заканчивается 1 января в 05:00 UTC.
   */
  test("ночь нового года ищется в архиве прошлого", () => {
    assert.deepEqual(archivePeriods(Date.UTC(2022, 0, 1, 2, 0), Date.UTC(2022, 0, 1, 3, 0), 2026), [
      { year: 2021, month: null },
    ]);
    assert.deepEqual(archivePeriods(Date.UTC(2022, 0, 1, 5, 0), Date.UTC(2022, 0, 1, 6, 0), 2026), [
      { year: 2022, month: null },
    ]);
  });

  /** На самой границе сдвиг метки неизвестен, поэтому берутся оба архива. */
  test("страница на стыке лет запрашивает оба архива", () => {
    assert.deepEqual(archivePeriods(Date.UTC(2022, 0, 1, 4, 0), Date.UTC(2022, 0, 1, 5, 0), 2026), [
      { year: 2021, month: null },
      { year: 2022, month: null },
    ]);
  });

  test("пять лет истории стоят пять архивов", () => {
    const periods = archivePeriods(Date.UTC(2021, 0, 5), Date.UTC(2025, 11, 20), 2026);

    assert.deepEqual(periods, [2021, 2022, 2023, 2024, 2025].map((year) => ({ year, month: null })));
  });

  test("пустой и обратный диапазон архивов не требуют", () => {
    assert.deepEqual(archivePeriods(Date.UTC(2021, 0, 5), Date.UTC(2021, 0, 5), 2026), []);
    assert.deepEqual(archivePeriods(Date.UTC(2021, 0, 6), Date.UTC(2021, 0, 5), 2026), []);
  });
});

const formPage = (fields: Record<string, string>) => `<html><body>
<form id="file_down" name="file_down" method="POST" action="/get.php">
${Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${name}" id="${name}" value="${value}" />`).join("\n")}
</form></body></html>`;

const YEAR_2021_CSV = Array.from(
  { length: 60 },
  (_, index) => `20210103 17${String(index).padStart(2, "0")}00;1.1;1.2;1.0;1.15;0`,
).join("\n");

/** Страница списка инструментов: коды заглавные, как в разметке источника. */
const indexPage = (codes: string[]) => `<html><body><ul>
${codes.map((code) => `<li><a href="/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/${code}"`
  + ` title="Download Generic .CSV File Historical M1 Bar Data quotes for ${code} forex pair">${code}</a></li>`).join("\n")}
</ul></body></html>`;

interface FakeSite {
  fetchImpl: typeof fetch;
  calls: string[];
}

function fakeSite(
  options: { token?: string; archive?: Buffer; codes?: string[]; indexBroken?: () => boolean } = {},
): FakeSite {
  const calls: string[] = [];
  const archive = options.archive ?? buildStreamedZip([
    { name: "DAT_ASCII_EURUSD_M1_2021.csv", content: YEAR_2021_CSV },
    { name: "DAT_ASCII_EURUSD_M1_2021.txt", content: "отчёт" },
  ]);

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("get.php")) return new Response(new Uint8Array(archive));
    // Список инструментов лежит на своей странице, а не на странице закачки.
    if (url.includes("/download-free-forex-data/")) {
      if (options.indexBroken?.()) return new Response("недоступно", { status: 503 });
      return new Response(indexPage(options.codes ?? ["EURUSD"]));
    }
    return new Response(formPage({
      tk: options.token ?? "токен",
      date: "2021",
      datemonth: "2021",
      platform: "ASCII",
      timeframe: "M1",
      fxpair: "EURUSD",
    }));
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const NOW_2026 = () => Date.UTC(2026, 7, 26);

describe("HistDataClient", () => {
  test("страница нарезается из скачанного года", async () => {
    const site = fakeSite();
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026);
    const from = Date.UTC(2021, 0, 3, 22, 0);

    const candles = await client.getPage({ category: "forex", symbol: "EURUSD", from, to: from + 3 * BASE_INTERVAL_MS });

    assert.deepEqual(candles.map((candle) => candle.openTime), [from, from + BASE_INTERVAL_MS, from + 2 * BASE_INTERVAL_MS]);
    assert.deepEqual(site.calls, [
      "GET https://histdata.test/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/eurusd/2021",
      "POST https://histdata.test/get.php",
    ]);
  });

  /** Ради этого архив и кэшируется: иначе год уезжал бы по сети на каждую страницу. */
  test("страницы одного года не качают архив заново", async () => {
    const site = fakeSite();
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026);
    const from = Date.UTC(2021, 0, 3, 22, 0);
    const page = (index: number) => ({
      category: "forex" as const,
      symbol: "EURUSD",
      from: from + index * 10 * BASE_INTERVAL_MS,
      to: from + (index + 1) * 10 * BASE_INTERVAL_MS,
    });

    const pages = await Promise.all([client.getPage(page(0)), client.getPage(page(1)), client.getPage(page(2))]);

    assert.deepEqual(pages.map((candles) => candles.length), [10, 10, 10]);
    assert.equal(site.calls.length, 2, "один архив на все страницы года");
  });

  test("пустой ответ означает ещё не выложенный период, а не поломку", async () => {
    const site = fakeSite({ archive: Buffer.alloc(0) });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026);

    const candles = await client.getPage({
      category: "forex",
      symbol: "EURUSD",
      from: Date.UTC(2021, 0, 3, 22, 0),
      to: Date.UTC(2021, 0, 3, 23, 0),
    });

    assert.deepEqual(candles, []);
  });

  test("пустой токен объясняется ошибкой, а не тишиной", async () => {
    const site = fakeSite({ token: "" });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026, 3, 0);

    await assert.rejects(() => client.getPage({
      category: "forex",
      symbol: "EURUSD",
      from: Date.UTC(2021, 0, 3, 22, 0),
      to: Date.UTC(2021, 0, 3, 23, 0),
    }), /токен/i);
  });

  /**
   * Ради этого список и спрашивается у источника: инструмент, которого нет в
   * коде приложения, должен качаться так же, как любой другой.
   */
  test("качается любой инструмент источника, а не заранее прописанный", async () => {
    const site = fakeSite({ codes: ["EURUSD", "GRXEUR"] });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026);
    const from = Date.UTC(2021, 0, 3, 22, 0);

    const candles = await client.getPage({
      category: "forex",
      symbol: "GRXEUR",
      from,
      to: from + 3 * BASE_INTERVAL_MS,
    });

    assert.equal(candles.length, 3);
    assert.deepEqual(site.calls, [
      "GET https://histdata.test/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/grxeur/2021",
      "POST https://histdata.test/get.php",
    ]);
  });

  test("инструмента нет у источника — говорим прямо, не идём в сеть", async () => {
    const site = fakeSite({ codes: ["EURUSD", "GRXEUR"] });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026);
    await client.symbols();
    const callsBefore = site.calls.length;

    await assert.rejects(() => client.getPage({
      category: "forex",
      symbol: "ABCXYZ",
      from: Date.UTC(2021, 0, 3, 22, 0),
      to: Date.UTC(2021, 0, 3, 23, 0),
    }), /ABCXYZ у HistData нет/);
    assert.equal(site.calls.length, callsBefore);
  });
});

describe("список инструментов HistData", () => {
  test("коды берутся со страницы списка", () => {
    const html = indexPage(["EURUSD", "GRXEUR", "USDJPY"])
      + '<a href="/download-free-forex-data/?/ascii/tick-data-quotes">тики</a>';

    assert.deepEqual(parseHistDataInstruments(html), ["EURUSD", "GRXEUR", "USDJPY"]);
  });

  /** Строчные коды встречаются в наших собственных адресах закачки. */
  test("повторы схлопываются, адреса закачки инструментами не считаются", () => {
    const html = indexPage(["EURUSD", "EURUSD"])
      + '<a href="/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/eurusd/2021">2021</a>';

    assert.deepEqual(parseHistDataInstruments(html), ["EURUSD"]);
  });

  test("список спрашивается один раз на срок кэша", async () => {
    const site = fakeSite({ codes: ["EURUSD", "USDJPY"] });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026);

    assert.deepEqual(await client.symbols(), ["EURUSD", "USDJPY"]);
    assert.deepEqual(await client.symbols(), ["EURUSD", "USDJPY"]);
    assert.equal(site.calls.length, 1);
  });

  /** Сайт мог лечь на минуту, а набор инструментов от этого не пропал. */
  test("недоступный список отдаётся просроченным, а не пустым", async () => {
    let broken = false;
    const site = fakeSite({ codes: ["EURUSD", "XAUUSD"], indexBroken: () => broken });
    let clock = Date.UTC(2026, 7, 26);
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, () => clock, 3, 0);

    await client.symbols();
    broken = true;
    clock += 7 * 3_600_000;

    assert.deepEqual(await client.symbols(), ["EURUSD", "XAUUSD"]);
  });

  test("список не приходил и не пришёл — ошибка, а не тишина", async () => {
    const site = fakeSite({ indexBroken: () => true });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026, 3, 0);

    await assert.rejects(() => client.symbols(), /HistData/);
  });

  test("страница без ссылок на инструменты считается поломкой", async () => {
    const site = fakeSite({ codes: [] });
    const client = new HistDataClient("https://histdata.test", site.fetchImpl, NOW_2026, 3, 0);

    await assert.rejects(() => client.symbols(), /не перечислил инструменты/);
  });
});
