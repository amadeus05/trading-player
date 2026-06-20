import type { Candle, Timeframe } from "../domain/Candle.js";
import type { DownloadRequest, MarketCategory } from "../domain/MarketRequest.js";
import type { MarketDataProvider } from "./ports/MarketDataProvider.js";
import type { CandleRepository } from "./ports/CandleRepository.js";
import { CandleValidator } from "./CandleValidator.js";
import { RangePlanner } from "./RangePlanner.js";

export class MarketDataService {
  constructor(
    private readonly client: MarketDataProvider,
    private readonly store: CandleRepository,
    private readonly planner: RangePlanner,
    private readonly validator: CandleValidator,
    private readonly concurrency = 8,
  ) {}

  async download(request: DownloadRequest, progress: (event:{stage:string;completedPages:number;totalPages:number;candles:number})=>void = ()=>{}) {
    const pages = this.planner.split(request);
    progress({stage:"checking_local_data",completedPages:0,totalPages:pages.length,candles:0});
    const missing = await this.store.missingPages(pages);
    const downloaded: Candle[] = [];
    let cursor = 0,completed = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, missing.length) }, async () => {
      while (cursor < missing.length) {
        const page = missing[cursor++];
        const rows=await this.client.getPage(page);
        downloaded.push(...rows);
        completed++;
        progress({stage:"downloading",completedPages:completed,totalPages:missing.length,candles:downloaded.length});
      }
    });
    await Promise.all(workers);
    const validation = this.validator.validate(downloaded);
    progress({stage:"validating",completedPages:missing.length,totalPages:missing.length,candles:validation.candles.length});
    if (validation.candles.length) {
      progress({stage:"writing_parquet",completedPages:missing.length,totalPages:missing.length,candles:validation.candles.length});
      await this.store.write(request.category, request.symbol, validation.candles);
    }
    return { requestedPages: pages.length, downloadedPages: missing.length, candles: validation.candles.length, gaps: validation.gaps };
  }

  catalog(){return this.store.catalog()}

  read(category: MarketCategory, symbol: string, timeframe: Timeframe, from: number, to: number) {
    return this.store.read(category, symbol.toUpperCase(), timeframe, from, to);
  }
}
