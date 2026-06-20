import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { SUPPORTED_TIMEFRAMES, type Timeframe } from "../domain/Candle.js";
import { normalizeRequest, type MarketCategory } from "../domain/MarketRequest.js";
import { MarketDataService } from "../application/MarketDataService.js";

const timestamp = (value: unknown): number => {
  const numeric = Number(value);
  const result = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  if (!Number.isFinite(result)) throw new Error(`Invalid timestamp: ${String(value)}`);
  return result;
};

export class MarketDataController {
  readonly router: Router = createRouter();
  constructor(private readonly service: MarketDataService) {
    this.router.post("/download", this.download);
    this.router.get("/candles", this.candles);
    this.router.get("/timeframes", (_req, res) => res.json(SUPPORTED_TIMEFRAMES));
  }

  private download = async (req: Request, res: Response) => {
    try {
      const request = normalizeRequest({ ...req.body, from: timestamp(req.body.from), to: timestamp(req.body.to) });
      res.json(await this.service.download(request));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  };

  private candles = async (req: Request, res: Response) => {
    try {
      const category = String(req.query.category ?? "linear") as MarketCategory;
      const symbol = String(req.query.symbol ?? "").toUpperCase();
      const timeframe = String(req.query.timeframe ?? "5m") as Timeframe;
      if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) throw new Error("Unsupported timeframe");
      const from = timestamp(req.query.from), to = timestamp(req.query.to);
      res.json(await this.service.read(category, symbol, timeframe, from, to));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  };
}
