import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BybitKlineClient } from "./infrastructure/BybitKlineClient.js";
import { BinaryCandleStore } from "./infrastructure/BinaryCandleStore.js";
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
/**
 * Порт открывается сразу, а инициализация хранилища идёт параллельно.
 *
 * Раньше listen стоял после await init(), и всё время, пока поднимался DuckDB
 * WASM (несколько секунд), порта 4174 просто не существовало. Vite при этом
 * успевал отдать страницу за 267 мс, браузер запрашивал /api/state и
 * /api/market/catalog, прокси получал ECONNREFUSED и отвечал 502. Клиент эти
 * запросы не повторяет, поэтому приложение оставалось с пустым каталогом до
 * ручной перезагрузки.
 *
 * Теперь запрос в это окно не падает, а ждёт готовности. /api/state хранилища
 * вообще не касается и отвечает немедленно.
 */
async function bootstrap() {
  // Хранилище подменяется одной строкой: обе реализации закрыты портом
  // CandleRepository, и ни сервис, ни контроллер, ни клиент о ней не знают.
  // Откат на parquet — вернуть ParquetCandleStore: оба формата лежат рядом в
  // одной папке символа, parquet файлами YYYY-MM.parquet, бинарь — YYYY.bin.
  const candleStore = new BinaryCandleStore(join(dataRoot, "market"));
  const storeReady = candleStore.init();
  const marketService = new MarketDataService(
    new BybitKlineClient(), candleStore, new RangePlanner(), new CandleValidator(), 8,
  );
  const jobs = new DownloadJobManager(marketService);
  let ready = false;
  void storeReady.then(() => { ready = true; });

  app.use("/api/market", (_req, res, next) => {
    storeReady.then(() => next()).catch((error: unknown) => {
      console.error(error);
      res.status(503).json({ error: "Хранилище свечей не поднялось" });
    });
  });
  app.use("/api/market", new MarketDataController(marketService, jobs).router);
  app.get("/api/health", (_req, res) => res.json({ ok: true, marketData: ready ? "ready" : "starting" }));
  app.listen(4174, () => console.log("Replay API: http://localhost:4174"));
  await storeReady;
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
