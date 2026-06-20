import type { Candle } from "../../domain/Candle.js";
import type { DownloadRequest } from "../../domain/MarketRequest.js";

export interface MarketDataProvider {
  getPage(request: DownloadRequest): Promise<Candle[]>;
}
