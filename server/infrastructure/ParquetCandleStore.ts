import { mkdir, rm, rename, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Candle, Timeframe } from "../domain/Candle.js";
import { BASE_INTERVAL_MS, timeframeMs } from "../domain/Candle.js";
import type { DownloadRequest, MarketCategory } from "../domain/MarketRequest.js";
import type { CandleRepository } from "../application/ports/CandleRepository.js";
import { createDuckDbRunner, type DuckDbRunner } from "./createDuckDbRunner.js";

const sqlPath = (path: string) => path.replaceAll("\\", "/").replaceAll("'", "''");

export class ParquetCandleStore implements CandleRepository {
  private runner!: DuckDbRunner;
  constructor(private readonly root: string) {}

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.runner = await createDuckDbRunner();
    console.log(`[ParquetCandleStore] DuckDB backend: ${this.runner.backend}`);
  }

  async close(): Promise<void> {
    await this.runner?.close();
  }

  private marketDir(category: MarketCategory, symbol: string): string {
    return resolve(this.root, "bybit", category, symbol, "5m");
  }

  private glob(category: MarketCategory, symbol: string): string {
    return sqlPath(join(this.marketDir(category, symbol), "*", "*.parquet"));
  }

  async covered(request: DownloadRequest): Promise<boolean> {
    const glob = this.glob(request.category, request.symbol);
    if (!existsSync(this.marketDir(request.category, request.symbol))) return false;
    const expected = Math.max(0, Math.floor((request.to - request.from) / BASE_INTERVAL_MS));
    if (!expected) return true;
    try {
      const rows = await this.runner.run(`SELECT count(DISTINCT open_time)::INTEGER AS n FROM read_parquet('${glob}', union_by_name=true) WHERE open_time >= $from AND open_time < $to`, { from: request.from, to: request.to });
      return Number(rows[0]?.n ?? 0) === expected;
    } catch { return false; }
  }

  async missingPages(pages: DownloadRequest[]): Promise<DownloadRequest[]> {
    if (!pages.length) return [];
    const first = pages[0];
    if (!existsSync(this.marketDir(first.category, first.symbol))) return pages;
    const span = BASE_INTERVAL_MS * 1000;
    const from = first.from;
    const to = pages.at(-1)!.to;
    try {
      const rows = await this.runner.run(`
        SELECT floor((open_time-$from)/$span)::INTEGER AS page, count(DISTINCT open_time)::INTEGER AS n
        FROM read_parquet('${this.glob(first.category, first.symbol)}', union_by_name=true)
        WHERE open_time >= $from AND open_time < $to GROUP BY page`, { from, to, span });
      const counts = new Map(rows.map((row) => [Number(row.page), Number(row.n)]));
      return pages.filter((page, index) => counts.get(index) !== Math.floor((page.to-page.from)/BASE_INTERVAL_MS));
    } catch { return pages; }
  }

  async write(category: MarketCategory, symbol: string, candles: Candle[]): Promise<void> {
    const groups = new Map<string, Candle[]>();
    for (const candle of candles) {
      const date = new Date(candle.openTime);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      groups.set(key, [...(groups.get(key) ?? []), candle]);
    }
    for (const [month, rows] of groups) await this.writeMonth(category, symbol, month, rows);
  }

  private async writeMonth(category: MarketCategory, symbol: string, month: string, rows: Candle[]): Promise<void> {
    const [year] = month.split("-");
    const dir = join(this.marketDir(category, symbol), year);
    await mkdir(dir, { recursive: true });
    const target = join(dir, `${month}.parquet`);
    const staging = `${target}.${crypto.randomUUID()}.tmp.parquet`;
    const json = join(tmpdir(), `candle-parquet-${crypto.randomUUID()}.ndjson`);
    await writeFile(json, rows.map((c) => JSON.stringify({ open_time:c.openTime, open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume, turnover:c.turnover })).join("\n"));
    const incoming = `SELECT * FROM read_json_auto('${sqlPath(json)}', format='newline_delimited')`;
    const source = existsSync(target) ? `SELECT * FROM read_parquet('${sqlPath(target)}') UNION ALL ${incoming}` : incoming;
    try {
      await this.runner.run(`COPY (SELECT * EXCLUDE(rn) FROM (SELECT *, row_number() OVER (PARTITION BY open_time ORDER BY open_time) rn FROM (${source})) WHERE rn=1 ORDER BY open_time) TO '${sqlPath(staging)}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)`);
    } finally {
      await rm(json, { force: true }).catch(() => {});
    }
    await rm(target, { force: true });
    await rename(staging, target);
  }

  async read(category: MarketCategory, symbol: string, timeframe: Timeframe, from: number, to: number): Promise<Candle[]> {
    const bucket = timeframeMs(timeframe);
    const factor = bucket / BASE_INTERVAL_MS;
    const glob = this.glob(category, symbol);
    if (!existsSync(this.marketDir(category, symbol))) return [];
    const alignedFrom = Math.floor(from / bucket) * bucket;
    const rows = await this.runner.run(`
      WITH source AS (
        SELECT *, floor(open_time / $bucket)::BIGINT * $bucket AS bucket
        FROM read_parquet('${glob}', union_by_name=true)
        WHERE open_time >= $alignedFrom AND open_time < $to
      )
      SELECT bucket AS open_time,
        arg_min(open, open_time) AS open, max(high) AS high, min(low) AS low,
        arg_max(close, open_time) AS close, sum(volume) AS volume, sum(turnover) AS turnover
      FROM source GROUP BY bucket
      HAVING count(*) = $factor AND max(open_time)-min(open_time)=($factor-1)*${BASE_INTERVAL_MS}
      ORDER BY bucket`, { bucket, alignedFrom, to, factor });
    return rows.map((r) => ({ openTime:Number(r.open_time), open:Number(r.open), high:Number(r.high), low:Number(r.low), close:Number(r.close), volume:Number(r.volume), turnover:Number(r.turnover) }));
  }

  async catalog():Promise<Array<{category:MarketCategory;symbol:string;from:number;to:number;candles:number;bytes:number}>>{
    const bybit=join(this.root,"bybit");if(!existsSync(bybit))return [];
    const result:Array<{category:MarketCategory;symbol:string;from:number;to:number;candles:number;bytes:number}>=[];
    for(const categoryName of await readdir(bybit)){
      if(!["linear","inverse","spot"].includes(categoryName))continue;
      const category=categoryName as MarketCategory,categoryDir=join(bybit,category);
      for(const symbol of await readdir(categoryDir)){
        const dir=this.marketDir(category,symbol);if(!existsSync(dir))continue;
        try{
          const [row]=await this.runner.run(`SELECT min(open_time) AS min_time,max(open_time) AS max_time,count(*)::INTEGER AS n FROM read_parquet('${this.glob(category,symbol)}', union_by_name=true)`);
          let bytes=0;for(const year of await readdir(dir)){const yearDir=join(dir,year);if(!(await stat(yearDir)).isDirectory())continue;for(const file of await readdir(yearDir)){if(file.endsWith(".parquet"))bytes+=(await stat(join(yearDir,file))).size}}
          if(row)result.push({category,symbol,from:Number(row.min_time),to:Number(row.max_time)+BASE_INTERVAL_MS,candles:Number(row.n),bytes});
        }catch{}
      }
    }
    return result.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  }
}
