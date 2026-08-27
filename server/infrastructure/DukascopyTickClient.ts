import { decompressFile } from "lzma-purejs";
import type { Candle } from "../domain/Candle.js";
import type { DownloadRequest } from "../domain/MarketRequest.js";
import { feedInstrument, FOREX_SYMBOLS, type FeedInstrument } from "../domain/instruments.js";
import type { MarketDataProvider } from "../application/ports/MarketDataProvider.js";
import { ticksToCandles } from "./dukascopy/ticksToCandles.js";

const HOUR_MS = 3_600_000;

/**
 * Без браузерного User-Agent фид отвечает 429 на любой запрос, даже первый.
 * Это не борьба с роботами, а условие входа, поэтому заголовок обязателен.
 */
const USER_AGENT = "Mozilla/5.0";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Форекс и металлы из тикового фида Dukascopy.
 *
 * Готовых минуток фид больше не отдаёт (все пути к candles отвечают 503), зато
 * тики лежат по файлу на час и без регистрации. Минутки собираются из них на
 * месте, поэтому страница закачки стоит примерно восемнадцать запросов.
 *
 * Фид жёстко ограничивает частоту: серия запросов получает 429, а затем 503 на
 * несколько минут. Поэтому параллельность внутри страницы небольшая, а отступ
 * после отказа растёт до полуминуты — переждать дешевле, чем упасть.
 */
export class DukascopyTickClient implements MarketDataProvider {
  constructor(
    private readonly baseUrl = "https://datafeed.dukascopy.com/datafeed",
    private readonly retries = 8,
    private readonly hourConcurrency = 3,
  ) {}

  async getPage(request: DownloadRequest): Promise<Candle[]> {
    const instrument = feedInstrument(request.symbol);
    if (!instrument) {
      throw new Error(`Инструмент ${request.symbol} не поддержан. Доступны: ${FOREX_SYMBOLS.join(", ")}`);
    }

    const hours: number[] = [];
    for (let hour = Math.floor(request.from / HOUR_MS) * HOUR_MS; hour < request.to; hour += HOUR_MS) {
      hours.push(hour);
    }

    const candles: Candle[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.hourConcurrency, hours.length) }, async () => {
      while (cursor < hours.length) {
        const hour = hours[cursor];
        cursor += 1;
        candles.push(...await this.loadHour(instrument, hour));
      }
    });
    await Promise.all(workers);

    // Часы на границах страниц перекрываются, и лишние минуты отдаём как есть:
    // они уже скачаны, а валидатор схлопнет их с минутами соседней страницы.
    return candles.sort((left, right) => left.openTime - right.openTime);
  }

  /** Месяц в путях фида нумеруется с нуля: январь — это 00. */
  private hourUrl(feedSymbol: string, hourStart: number): string {
    const time = new Date(hourStart);
    const month = String(time.getUTCMonth()).padStart(2, "0");
    const day = String(time.getUTCDate()).padStart(2, "0");
    const hour = String(time.getUTCHours()).padStart(2, "0");
    return `${this.baseUrl}/${feedSymbol}/${time.getUTCFullYear()}/${month}/${day}/${hour}h_ticks.bi5`;
  }

  private async loadHour(instrument: FeedInstrument, hourStart: number): Promise<Candle[]> {
    const url = this.hourUrl(instrument.feedSymbol, hourStart);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(60_000),
        });
        // Часа нет в истории — обычное дело для выходных и праздников. Пустой
        // ответ означает то же самое: торгов не было.
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`Dukascopy HTTP ${response.status}`);
        const packed = Buffer.from(await response.arrayBuffer());
        if (!packed.length) return [];
        const raw = Buffer.from(decompressFile(packed));
        return ticksToCandles(raw, hourStart, instrument.priceDivisor);
      } catch (error) {
        if (attempt >= this.retries) throw error;
        await sleep(Math.min(30_000, 500 * 2 ** attempt + Math.random() * 500));
      }
    }
  }
}
