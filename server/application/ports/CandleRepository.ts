import type { Candle, Timeframe } from "../../domain/Candle.js";
import type { DownloadRequest, MarketCategory } from "../../domain/MarketRequest.js";

export interface CandleRepository {
  missingPages(pages: DownloadRequest[]): Promise<DownloadRequest[]>;
  write(category: MarketCategory, symbol: string, candles: Candle[]): Promise<void>;
  read(category: MarketCategory, symbol: string, timeframe: Timeframe, from: number, to: number): Promise<Candle[]>;
}
