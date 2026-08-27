import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { Candle, Timeframe } from "../domain/Candle.js";
import { BASE_INTERVAL_MS, timeframeMs } from "../domain/Candle.js";
import { MARKET_CATEGORIES, type DownloadRequest, type MarketCategory } from "../domain/MarketRequest.js";
import type { CandleRepository } from "../application/ports/CandleRepository.js";

/**
 * Плоское хранилище свечей вместо parquet+DuckDB.
 *
 * Данные однородные: свечи одного интервала, подряд по времени. Значит номер
 * свечи вычисляется из её времени, а не ищется — доступ по смещению вместо
 * запроса. Это убирает фиксированную плату примерно в 110 мс за разбор SQL,
 * раскрытие глоба и чтение метаданных parquet, которую раньше платили на каждом
 * чтении, даже когда просили три десятка свечей.
 *
 * Раскладка: <root>/bybit/<category>/<SYMBOL>/<interval>/<YEAR>.bin. Год — файл
 * с заголовком и плотным массивом слотов на весь год. Пропуск в данных (биржа
 * лежала) хранится как пустой слот, а не как отсутствие записи, поэтому провалы
 * видно сразу по индексу и не надо ничего сопоставлять.
 */

const MAGIC = 0x4c_44_4e_43;
const VERSION = 1;
const HEADER_SIZE = 48;
/** open, high, low, close, volume, turnover — по float64 каждое. */
const RECORD_FIELDS = 6;
const RECORD_SIZE = RECORD_FIELDS * 8;

const OFFSET_INTERVAL = 8;
const OFFSET_START = 16;
const OFFSET_SLOTS = 24;
const OFFSET_PRESENT = 28;
const OFFSET_FIRST = 32;
const OFFSET_LAST = 36;

interface Header {
  intervalMs: number;
  startTimeMs: number;
  slots: number;
  present: number;
  firstIndex: number;
  lastIndex: number;
}

const yearOf = (timeMs: number): number => new Date(timeMs).getUTCFullYear();
const yearStart = (year: number): number => Date.UTC(year, 0, 1);
const slotsInYear = (year: number, intervalMs: number): number =>
  (Date.UTC(year + 1, 0, 1) - yearStart(year)) / intervalMs;

const intervalLabel = (intervalMs: number): string => `${intervalMs / 60_000}m`;

/** Цена не бывает нулевой, поэтому open=0 — надёжная метка пустого слота. */
const isPresent = (view: Float64Array, slot: number): boolean => view[slot * RECORD_FIELDS] !== 0;

/**
 * Минута закрытого рынка: слот занят последней известной ценой, но торгов в нём
 * не было. Метка — отрицательный оборот, см. CLOSED_MARKET_TURNOVER.
 */
const isClosedMarket = (view: Float64Array, slot: number): boolean =>
  view[slot * RECORD_FIELDS + 5] < 0;

function readHeader(buffer: Buffer): Header {
  if (buffer.readUInt32LE(0) !== MAGIC) throw new Error("Not a candle file");
  const version = buffer.readUInt8(4);
  if (version !== VERSION) throw new Error(`Unsupported candle file version: ${version}`);
  return {
    intervalMs: Number(buffer.readBigInt64LE(OFFSET_INTERVAL)),
    startTimeMs: Number(buffer.readBigInt64LE(OFFSET_START)),
    slots: buffer.readUInt32LE(OFFSET_SLOTS),
    present: buffer.readUInt32LE(OFFSET_PRESENT),
    firstIndex: buffer.readInt32LE(OFFSET_FIRST),
    lastIndex: buffer.readInt32LE(OFFSET_LAST),
  };
}

function writeHeader(header: Header): Buffer {
  const buffer = Buffer.alloc(HEADER_SIZE);
  buffer.writeUInt32LE(MAGIC, 0);
  buffer.writeUInt8(VERSION, 4);
  buffer.writeBigInt64LE(BigInt(header.intervalMs), OFFSET_INTERVAL);
  buffer.writeBigInt64LE(BigInt(header.startTimeMs), OFFSET_START);
  buffer.writeUInt32LE(header.slots, OFFSET_SLOTS);
  buffer.writeUInt32LE(header.present, OFFSET_PRESENT);
  buffer.writeInt32LE(header.firstIndex, OFFSET_FIRST);
  buffer.writeInt32LE(header.lastIndex, OFFSET_LAST);
  return buffer;
}

export class BinaryCandleStore implements CandleRepository {
  constructor(private readonly root: string, private readonly intervalMs = BASE_INTERVAL_MS) {}

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    console.log(`[BinaryCandleStore] интервал базы: ${intervalLabel(this.intervalMs)}`);
  }

  /** Хендлы файлов не переживают вызов, закрывать между запросами нечего. */
  async close(): Promise<void> {}

  private symbolDir(category: MarketCategory, symbol: string): string {
    return resolve(this.root, "bybit", category, symbol);
  }

  private intervalDir(category: MarketCategory, symbol: string): string {
    return join(this.symbolDir(category, symbol), intervalLabel(this.intervalMs));
  }

  private yearFile(category: MarketCategory, symbol: string, year: number): string {
    return join(this.intervalDir(category, symbol), `${year}.bin`);
  }

  /** Читает год целиком: заголовок плюс плотный массив слотов. */
  private async readYear(
    category: MarketCategory,
    symbol: string,
    year: number,
  ): Promise<{ header: Header; view: Float64Array } | null> {
    const path = this.yearFile(category, symbol, year);
    if (!existsSync(path)) return null;
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "r");
      const headerBuffer = Buffer.alloc(HEADER_SIZE);
      await handle.read(headerBuffer, 0, HEADER_SIZE, 0);
      const header = readHeader(headerBuffer);
      const body = Buffer.alloc(header.slots * RECORD_SIZE);
      await handle.read(body, 0, body.length, HEADER_SIZE);
      return { header, view: new Float64Array(body.buffer, body.byteOffset, header.slots * RECORD_FIELDS) };
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }

  async write(category: MarketCategory, symbol: string, candles: Candle[]): Promise<void> {
    const byYear = new Map<number, Candle[]>();
    for (const candle of candles) {
      const year = yearOf(candle.openTime);
      const bucket = byYear.get(year);
      if (bucket) bucket.push(candle); else byYear.set(year, [candle]);
    }
    await mkdir(this.intervalDir(category, symbol), { recursive: true });
    for (const [year, rows] of byYear) await this.writeYear(category, symbol, year, rows);
  }

  /**
   * Год переписывается целиком: читаем в память, правим слоты, пересчитываем
   * статистику, пишем обратно. Год пятиминуток — около 5 МБ, а закачки редки,
   * поэтому простота и целостность здесь дороже экономии на точечной записи.
   *
   * Файл покрывает не весь календарный год, а только занятый диапазон. Иначе
   * четыре дня истории занимали бы те же 5 МБ, что и полный год: остальное
   * уходило бы в нули.
   */
  private async writeYear(
    category: MarketCategory,
    symbol: string,
    year: number,
    rows: Candle[],
  ): Promise<void> {
    const boundStart = yearStart(year);
    const boundSlots = slotsInYear(year, this.intervalMs);
    const boundEnd = boundStart + boundSlots * this.intervalMs;
    const inYear = rows.filter((candle) => candle.openTime >= boundStart && candle.openTime < boundEnd);
    if (!inYear.length) return;

    const existing = await this.readYear(category, symbol, year);
    const existingStart = existing ? existing.header.startTimeMs : Infinity;
    const existingEnd = existing ? existing.header.startTimeMs + existing.header.slots * this.intervalMs : -Infinity;
    // Циклом, а не Math.min(...array): спред раскладывает массив в аргументы, и
    // на минутной базе трёхмесячная закачка (132 тысячи свечей) кладёт стек.
    // На пятиминутках тот же диапазон давал 26 тысяч и до предела не доходил.
    let incomingStart = Infinity;
    let incomingLast = -Infinity;
    for (const candle of inYear) {
      if (candle.openTime < incomingStart) incomingStart = candle.openTime;
      if (candle.openTime > incomingLast) incomingLast = candle.openTime;
    }
    const incomingEnd = incomingLast + this.intervalMs;

    const start = Math.min(existingStart, incomingStart);
    const end = Math.max(existingEnd, incomingEnd);
    const slots = (end - start) / this.intervalMs;
    const view = new Float64Array(slots * RECORD_FIELDS);
    if (existing) {
      // Диапазон мог расшириться влево, поэтому старые записи переезжают со
      // сдвигом, а не копируются с нулевого слота.
      const shift = (existing.header.startTimeMs - start) / this.intervalMs;
      view.set(existing.view, shift * RECORD_FIELDS);
    }

    for (const candle of inYear) {
      const slot = Math.floor((candle.openTime - start) / this.intervalMs);
      if (slot < 0 || slot >= slots) continue;
      // Дубли из перекрывающихся страниц закачки схлопываются сами: один и тот
      // же openTime всегда указывает на один и тот же слот.
      const at = slot * RECORD_FIELDS;
      view[at] = candle.open;
      view[at + 1] = candle.high;
      view[at + 2] = candle.low;
      view[at + 3] = candle.close;
      view[at + 4] = candle.volume;
      view[at + 5] = candle.turnover;
    }

    // Каталог должен показывать настоящую историю, поэтому минуты закрытого
    // рынка не идут ни в счётчик, ни в границы диапазона.
    let present = 0, firstIndex = -1, lastIndex = -1;
    for (let slot = 0; slot < slots; slot += 1) {
      if (!isPresent(view, slot) || isClosedMarket(view, slot)) continue;
      present += 1;
      if (firstIndex < 0) firstIndex = slot;
      lastIndex = slot;
    }

    const header = writeHeader({ intervalMs: this.intervalMs, startTimeMs: start, slots, present, firstIndex, lastIndex });
    const body = Buffer.from(view.buffer, view.byteOffset, slots * RECORD_SIZE);
    const handle = await open(this.yearFile(category, symbol, year), "w");
    try {
      await handle.write(header, 0, HEADER_SIZE, 0);
      await handle.write(body, 0, body.length, HEADER_SIZE);
    } finally {
      await handle.close();
    }
  }

  async read(
    category: MarketCategory,
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    const bucketMs = timeframeMs(timeframe);
    const factor = bucketMs / this.intervalMs;
    // Начало приводим к границе бакета, иначе первый бакет окажется обрезанным
    // и правило полноты выкинет его, хотя данные для него есть.
    const alignedFrom = Math.floor(from / bucketMs) * bucketMs;
    if (to <= alignedFrom) return [];

    const buckets = new Map<number, { candle: Candle | null; count: number }>();
    for (let year = yearOf(alignedFrom); year <= yearOf(to - 1); year += 1) {
      const loaded = await this.readYear(category, symbol, year);
      if (!loaded) continue;
      const { header, view } = loaded;
      const firstSlot = Math.max(0, Math.ceil((alignedFrom - header.startTimeMs) / this.intervalMs));
      const lastSlot = Math.min(header.slots - 1, Math.floor((to - 1 - header.startTimeMs) / this.intervalMs));
      for (let slot = firstSlot; slot <= lastSlot; slot += 1) {
        if (!isPresent(view, slot)) continue;
        const at = slot * RECORD_FIELDS;
        const openTime = header.startTimeMs + slot * this.intervalMs;
        const bucketTime = Math.floor(openTime / bucketMs) * bucketMs;
        let entry = buckets.get(bucketTime);
        if (!entry) {
          entry = { candle: null, count: 0 };
          buckets.set(bucketTime, entry);
        }
        entry.count += 1;
        // Минута закрытого рынка занимает слот, поэтому держит полноту бакета,
        // но в цены и объём не входит: торгов в ней не было.
        if (isClosedMarket(view, slot)) continue;
        if (!entry.candle) {
          entry.candle = {
            openTime: bucketTime,
            open: view[at], high: view[at + 1], low: view[at + 2],
            close: view[at + 3], volume: view[at + 4], turnover: view[at + 5],
          };
          continue;
        }
        const candle = entry.candle;
        if (view[at + 1] > candle.high) candle.high = view[at + 1];
        if (view[at + 2] < candle.low) candle.low = view[at + 2];
        candle.close = view[at + 3];
        candle.volume += view[at + 4];
        candle.turnover += view[at + 5];
      }
    }

    // Неполный бакет не отдаём никогда: на плотном массиве count === factor
    // означает, что все базовые свечи внутри на месте и идут подряд. Бакет из
    // одних закрытых минут (выходные форекса) не отдаём тоже: цены в нём нет.
    const result: Candle[] = [];
    for (const entry of buckets.values()) {
      if (entry.candle && entry.count === factor) result.push(entry.candle);
    }
    return result.sort((left, right) => left.openTime - right.openTime);
  }

  /** Сколько базовых свечей реально лежит в интервале [from, to). */
  private async countPresent(
    category: MarketCategory,
    symbol: string,
    from: number,
    to: number,
  ): Promise<number> {
    let total = 0;
    for (let year = yearOf(from); year <= yearOf(to - 1); year += 1) {
      const loaded = await this.readYear(category, symbol, year);
      if (!loaded) continue;
      const { header, view } = loaded;
      const firstSlot = Math.max(0, Math.ceil((from - header.startTimeMs) / this.intervalMs));
      const lastSlot = Math.min(header.slots - 1, Math.floor((to - 1 - header.startTimeMs) / this.intervalMs));
      for (let slot = firstSlot; slot <= lastSlot; slot += 1) if (isPresent(view, slot)) total += 1;
    }
    return total;
  }

  async covered(request: DownloadRequest): Promise<boolean> {
    const expected = Math.max(0, Math.floor((request.to - request.from) / this.intervalMs));
    if (!expected) return true;
    if (!existsSync(this.intervalDir(request.category, request.symbol))) return false;
    return await this.countPresent(request.category, request.symbol, request.from, request.to) === expected;
  }

  async missingPages(pages: DownloadRequest[]): Promise<DownloadRequest[]> {
    if (!pages.length) return [];
    const first = pages[0];
    if (!existsSync(this.intervalDir(first.category, first.symbol))) return pages;
    const missing: DownloadRequest[] = [];
    for (const page of pages) {
      const expected = Math.floor((page.to - page.from) / this.intervalMs);
      const present = await this.countPresent(page.category, page.symbol, page.from, page.to);
      if (present !== expected) missing.push(page);
    }
    return missing;
  }

  async catalog(): Promise<Array<{category:MarketCategory;symbol:string;from:number;to:number;candles:number;bytes:number}>> {
    const bybit = join(this.root, "bybit");
    if (!existsSync(bybit)) return [];
    const result: Array<{category:MarketCategory;symbol:string;from:number;to:number;candles:number;bytes:number}> = [];
    for (const categoryName of await readdir(bybit)) {
      if (!(MARKET_CATEGORIES as readonly string[]).includes(categoryName)) continue;
      const category = categoryName as MarketCategory;
      for (const symbol of await readdir(join(bybit, category))) {
        const dir = this.intervalDir(category, symbol);
        if (!existsSync(dir)) continue;
        let from = Infinity, to = -Infinity, candles = 0, bytes = 0;
        for (const file of await readdir(dir)) {
          if (!file.endsWith(".bin")) continue;
          const path = join(dir, file);
          bytes += (await stat(path)).size;
          // Границы и счётчик лежат в заголовке, поэтому каталог читает по 48
          // байт на файл вместо запроса на каждый символ.
          const loaded = await this.readYear(category, symbol, Number(file.slice(0, -4)));
          if (!loaded || loaded.header.firstIndex < 0) continue;
          const { header } = loaded;
          candles += header.present;
          from = Math.min(from, header.startTimeMs + header.firstIndex * header.intervalMs);
          to = Math.max(to, header.startTimeMs + header.lastIndex * header.intervalMs + header.intervalMs);
        }
        if (candles) result.push({ category, symbol, from, to, candles, bytes });
      }
    }
    return result.sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  /**
   * Удаление работает без оговорок: файлы открываются на время операции и
   * закрываются сразу, так что ничьих живых хендлов на них нет.
   */
  async remove(category: MarketCategory, symbol: string): Promise<boolean> {
    const dir = this.symbolDir(category, symbol);
    if (!existsSync(dir)) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  }
}
