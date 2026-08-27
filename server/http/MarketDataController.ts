import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { SUPPORTED_TIMEFRAMES, type Timeframe } from "../domain/Candle.js";
import { normalizeMarketCategory, normalizeMarketSymbol, normalizeRequest } from "../domain/MarketRequest.js";
import { forexInstruments } from "../domain/instruments.js";
import { MarketDataService } from "../application/MarketDataService.js";
import { DownloadJobManager } from "../application/DownloadJobManager.js";

const timestamp = (value: unknown): number => {
  const numeric = Number(value);
  const result = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  if (!Number.isFinite(result)) throw new Error(`Invalid timestamp: ${String(value)}`);
  return result;
};

export class MarketDataController {
  readonly router: Router = createRouter();
  constructor(private readonly service: MarketDataService,private readonly jobs:DownloadJobManager) {
    this.router.post("/download", this.download);
    this.router.get("/catalog",async(_req,res)=>res.json(await this.service.catalog()));
    this.router.get("/jobs",(_req,res)=>res.json(this.jobs.list()));
    this.router.get("/jobs/:id",(req,res)=>{const job=this.jobs.get(req.params.id);job?res.json(job):res.status(404).json({error:"Job not found"})});
    this.router.get("/jobs/:id/events",this.jobEvents);
    this.router.get("/candles", this.candles);
    this.router.delete("/history/:category/:symbol", this.removeHistory);
    this.router.get("/timeframes", (_req, res) => res.json(SUPPORTED_TIMEFRAMES));
    // Крипты у Bybit тысячи, её символ остаётся вводом; форекс же ограничен
    // проверенным списком, и интерфейсу нужно откуда-то его брать.
    this.router.get("/instruments", (_req, res) => res.json({ forex: forexInstruments() }));
  }

  private download = async (req: Request, res: Response) => {
    try {
      const request = normalizeRequest({ ...req.body, from: timestamp(req.body.from), to: timestamp(req.body.to) });
      res.status(202).json(this.jobs.create(request));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  };

  private jobEvents=(req:Request,res:Response)=>{
    const id=String(req.params.id);if(!this.jobs.get(id)){res.status(404).end();return}
    res.setHeader("Content-Type","text/event-stream");res.setHeader("Cache-Control","no-cache");res.setHeader("Connection","keep-alive");res.flushHeaders();
    const unsubscribe=this.jobs.subscribe(id,(job)=>res.write(`data: ${JSON.stringify(job)}\n\n`));
    req.on("close",unsubscribe);
  };

  private removeHistory = async (req: Request, res: Response) => {
    try {
      const category = normalizeMarketCategory(req.params.category);
      const symbol = normalizeMarketSymbol(req.params.symbol);
      const removed = await this.service.remove(category, symbol);
      if (!removed) { res.status(404).json({ error: "История не найдена" }); return; }
      res.status(204).end();
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  };

  private candles = async (req: Request, res: Response) => {
    try {
      const category = normalizeMarketCategory(req.query.category);
      const symbol = normalizeMarketSymbol(req.query.symbol);
      const timeframe = String(req.query.timeframe ?? "5m") as Timeframe;
      if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) throw new Error("Unsupported timeframe");
      const from = timestamp(req.query.from), to = timestamp(req.query.to);
      res.json(await this.service.read(category, symbol, timeframe, from, to));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  };
}
