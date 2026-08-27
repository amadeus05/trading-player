import type { Candle } from "../domain/Candle.js";
import type { DownloadRequest } from "../domain/MarketRequest.js";
import type { MarketDataProvider } from "../application/ports/MarketDataProvider.js";
import type { InstrumentSource } from "../application/ports/InstrumentSource.js";
import { archivePeriods, type ArchivePeriod } from "./histdata/archivePeriods.js";
import { EMPTY_CANDLES, parseHistDataCsv, sliceCandles, type PackedCandles } from "./histdata/histDataCsv.js";
import { INSTRUMENT_INDEX_PATH, parseHistDataInstruments } from "./histdata/instrumentIndex.js";
import { isZip, readZipEntries } from "./histdata/zipArchive.js";

/**
 * Токен формы выдаётся только полноценному браузерному User-Agent: на коротких
 * вроде «Mozilla/5.0» страница приходит с пустым value, и загрузка молча
 * возвращает нуль байт. Это проверено запросами, а не предположение.
 */
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Форекс и металлы из архивов HistData.
 *
 * Один запрос отдаёт целый год минуток, поэтому пять лет истории стоят пять
 * архивов, а не сорок тысяч часовых файлов, как у тикового фида. Скачанный год
 * разбирается один раз и держится в памяти плотными массивами, а страницы
 * нарезаются из него без новых обращений к сети.
 *
 * Загрузка идёт в два шага, как в браузере: страница инструмента отдаёт скрытую
 * форму с токеном, и уже её поля уходят POST-запросом за архивом. Поля не
 * собираются вручную, а берутся из формы целиком — так смена набора параметров
 * на стороне сайта не потребует правок здесь.
 */
export class HistDataClient implements MarketDataProvider, InstrumentSource {
  private readonly archives = new Map<string, Promise<PackedCandles>>();
  private instruments: { at: number; codes: string[] } | null = null;

  constructor(
    private readonly baseUrl = "https://www.histdata.com",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly cachedArchives = 3,
    private readonly retries = 3,
    private readonly instrumentsTtlMs = 6 * 3_600_000,
  ) {}

  /**
   * Набор инструментов источника. Кэшируется на часы: он меняется парой записей
   * в год, а спрашивают его каждым открытием диалога загрузки.
   */
  async symbols(): Promise<string[]> {
    if (this.instruments && this.now() - this.instruments.at < this.instrumentsTtlMs) {
      return this.instruments.codes;
    }

    const url = `${this.baseUrl}${INSTRUMENT_INDEX_PATH}`;
    try {
      const html = await this.request(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } })
        .then((response) => response.text());
      const codes = parseHistDataInstruments(html);
      if (!codes.length) throw new Error(`HistData не перечислил инструменты по ${url}`);
      this.instruments = { at: this.now(), codes };
      return codes;
    } catch (error) {
      // Просроченный список лучше пустого: сайт мог лечь на минуту, а набор
      // инструментов от этого никуда не делся.
      if (this.instruments) return this.instruments.codes;
      throw error;
    }
  }

  async getPage(request: DownloadRequest): Promise<Candle[]> {
    const pair = request.symbol.trim().toLowerCase();
    // Проверяем только по уже известному списку и не идём за ним в сеть: иначе
    // недоступный справочник ронял бы и саму загрузку. Если списка ещё нет,
    // ошибку про несуществующий инструмент выдаст сам источник — страницы такой
    // пары у него не будет.
    if (this.instruments && !this.instruments.codes.includes(pair.toUpperCase())) {
      throw new Error(`Инструмента ${request.symbol} у HistData нет`);
    }

    const currentYear = new Date(this.now()).getUTCFullYear();
    const candles: Candle[] = [];
    for (const period of archivePeriods(request.from, request.to, currentYear)) {
      const packed = await this.archive(pair, period);
      candles.push(...sliceCandles(packed, request.from, request.to));
    }

    return candles.sort((left, right) => left.openTime - right.openTime);
  }

  private archive(pair: string, period: ArchivePeriod): Promise<PackedCandles> {
    const key = `${pair}:${period.year}:${period.month ?? "год"}`;
    const cached = this.archives.get(key);
    if (cached) return cached;

    // Страницы одного года качают восемь воркеров сразу, поэтому в кэш кладётся
    // обещание, а не результат: иначе один и тот же архив уехал бы по сети
    // восемь раз.
    const loading = this.load(pair, period);
    this.archives.set(key, loading);
    void loading.catch(() => this.archives.delete(key));
    for (const stale of this.archives.keys()) {
      if (this.archives.size <= this.cachedArchives) break;
      if (stale !== key) this.archives.delete(stale);
    }
    return loading;
  }

  private async load(pair: string, period: ArchivePeriod): Promise<PackedCandles> {
    const pageUrl = this.pageUrl(pair, period);
    const form = await this.formFields(pageUrl);
    const archive = await this.archiveBody(form, pageUrl);

    // Пустой ответ значит, что архива за период ещё нет: текущий месяц источник
    // выкладывает не сразу. Страницы останутся недокачанными и попросятся снова.
    if (!archive.length) return EMPTY_CANDLES;
    if (!isZip(archive)) {
      throw new Error(`HistData отдал не архив по ${pageUrl}: ${archive.length} байт`);
    }

    const csv = readZipEntries(archive).find((entry) => entry.name.toLowerCase().endsWith(".csv"));
    if (!csv) throw new Error(`В архиве по ${pageUrl} нет csv`);
    return parseHistDataCsv(csv.data.toString("latin1"));
  }

  private pageUrl(pair: string, period: ArchivePeriod): string {
    const path = `${this.baseUrl}/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/${pair.toLowerCase()}/${period.year}`;
    return period.month === null ? path : `${path}/${period.month}`;
  }

  private async formFields(pageUrl: string): Promise<URLSearchParams> {
    const html = await this.request(pageUrl, { headers: { "user-agent": USER_AGENT, accept: "text/html" } })
      .then((response) => response.text());

    const form = html.match(/<form[^>]*id="file_down"[\s\S]*?<\/form>/)?.[0];
    if (!form) throw new Error(`HistData не отдал форму загрузки по ${pageUrl}`);

    const fields = new URLSearchParams();
    for (const field of form.matchAll(/name="([^"]+)"[^>]*value="([^"]*)"/g)) fields.set(field[1], field[2]);
    if (!fields.get("tk")) throw new Error(`HistData не выдал токен по ${pageUrl}`);
    return fields;
  }

  private async archiveBody(form: URLSearchParams, pageUrl: string): Promise<Buffer> {
    const response = await this.request(`${this.baseUrl}/get.php`, {
      method: "POST",
      headers: {
        "user-agent": USER_AGENT,
        "content-type": "application/x-www-form-urlencoded",
        referer: pageUrl,
        origin: this.baseUrl,
      },
      body: form,
    });
    return Buffer.from(await response.arrayBuffer());
  }

  private async request(url: string, options: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, { ...options, signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`HistData HTTP ${response.status} по ${url}`);
        return response;
      } catch (error) {
        if (attempt >= this.retries) throw error;
        await sleep(1_000 * 2 ** attempt);
      }
    }
  }
}
