import { BASE_INTERVAL_MS, type Candle } from "../domain/Candle.js";
import type { DownloadRequest } from "../domain/MarketRequest.js";
import type { MarketDataProvider } from "../application/ports/MarketDataProvider.js";

interface BybitResponse {
  retCode: number;
  retMsg: string;
  result: { list: string[][] };
}

export class BybitKlineClient implements MarketDataProvider {
  constructor(private readonly baseUrl = "https://api.bybit.com", private readonly retries = 5) {}

  async getPage(request: DownloadRequest): Promise<Candle[]> {
    const url = new URL("/v5/market/kline", this.baseUrl);
    url.searchParams.set("category", request.category);
    url.searchParams.set("symbol", request.symbol);
    // Интервал в минутах строкой — база хранилища, а не константа биржи.
    url.searchParams.set("interval", String(BASE_INTERVAL_MS / 60_000));
    url.searchParams.set("start", String(request.from));
    url.searchParams.set("end", String(request.to - 1));
    url.searchParams.set("limit", "1000");

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (response.status === 429 || response.status >= 500) throw new Error(`Bybit HTTP ${response.status}`);
        if (!response.ok) throw new Error(`Bybit HTTP ${response.status}`);
        const body = (await response.json()) as BybitResponse;
        if (body.retCode !== 0) throw new Error(`Bybit ${body.retCode}: ${body.retMsg}`);
        return body.result.list
          .map(([time, open, high, low, close, volume, turnover]) => ({
            openTime: Number(time), open: Number(open), high: Number(high), low: Number(low),
            close: Number(close), volume: Number(volume), turnover: Number(turnover),
          }))
          .sort((a, b) => a.openTime - b.openTime);
      } catch (error) {
        if (attempt >= this.retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 300 * 2 ** attempt + Math.random() * 250)));
      }
    }
  }
}
