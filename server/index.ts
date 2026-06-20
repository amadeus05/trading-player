import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BybitKlineClient } from "./infrastructure/BybitKlineClient.js";
import { ParquetCandleStore } from "./infrastructure/ParquetCandleStore.js";
import { RangePlanner } from "./application/RangePlanner.js";
import { CandleValidator } from "./application/CandleValidator.js";
import { MarketDataService } from "./application/MarketDataService.js";
import { MarketDataController } from "./http/MarketDataController.js";
import { DownloadJobManager } from "./application/DownloadJobManager.js";

const root = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(root, "../data");
const stateFile = join(dataRoot, "state.json");
const app = express();
app.use(express.json({ limit: "25mb" }));

const emptyState = { datasets: [], trades: [], annotations: [] };
app.get("/api/state", (_req, res) => res.json(existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : emptyState));
app.put("/api/state", (req, res) => {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});
async function bootstrap() {
  const parquetStore = new ParquetCandleStore(join(dataRoot, "market"));
  await parquetStore.init();
  const marketService = new MarketDataService(
    new BybitKlineClient(), parquetStore, new RangePlanner(), new CandleValidator(), 8,
  );
  const jobs=new DownloadJobManager(marketService);
  app.use("/api/market", new MarketDataController(marketService,jobs).router);
  app.get("/api/health", (_req, res) => res.json({ ok: true, marketData: "ready" }));
  app.listen(4174, () => console.log("Replay API: http://localhost:4174"));
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
