import type { Candle } from "../domain/Candle.js";
import type { DownloadRequest, MarketCategory } from "../domain/MarketRequest.js";
import type { MarketDataProvider } from "./ports/MarketDataProvider.js";

/**
 * Раздаёт запросы по провайдерам: крипта идёт на биржу, форекс и металлы — в
 * тиковый фид. Сервис закачки об этом не знает, поэтому страницы, прогресс,
 * дедуп и запись остаются общими для всех рынков.
 */
export class MarketDataProviderRouter implements MarketDataProvider {
  constructor(private readonly providers: Record<MarketCategory, MarketDataProvider>) {}

  getPage(request: DownloadRequest): Promise<Candle[]> {
    return this.providers[request.category].getPage(request);
  }
}
