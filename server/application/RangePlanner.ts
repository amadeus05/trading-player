import { BASE_INTERVAL_MS } from "../domain/Candle.js";
import type { DownloadRequest } from "../domain/MarketRequest.js";

export class RangePlanner {
  private readonly pageSpan = BASE_INTERVAL_MS * 1000;

  split(request: DownloadRequest): DownloadRequest[] {
    const from = Math.floor(request.from / BASE_INTERVAL_MS) * BASE_INTERVAL_MS;
    const to = Math.floor(request.to / BASE_INTERVAL_MS) * BASE_INTERVAL_MS;
    const pages: DownloadRequest[] = [];
    for (let cursor = from; cursor < to; cursor += this.pageSpan) {
      pages.push({ ...request, from: cursor, to: Math.min(cursor + this.pageSpan, to) });
    }
    return pages;
  }
}
