import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle } from "../domain/Candle.js";
import { ParquetCandleStore } from "../infrastructure/ParquetCandleStore.js";
import { BinaryCandleStore } from "../infrastructure/BinaryCandleStore.js";
import { createDuckDbRunner } from "../infrastructure/createDuckDbRunner.js";

/**
 * Переливает историю из parquet в плоский бинарь. Оба формата лежат в одной и
 * той же папке символа (<SYMBOL>/5m/): parquet — файлами YYYY-MM.parquet, бинарь
 * — YYYY.bin, каждый стор видит только своё расширение. Поэтому миграция ничего
 * не удаляет, и откат — это возврат одной строки в server/index.ts.
 *
 *   npx tsx server/scripts/migrateToBinary.ts
 */

const marketRoot = join(dirname(fileURLToPath(import.meta.url)), "../../data/market");

/**
 * Читает сырые свечи прямо из parquet, а не через ParquetCandleStore.read().
 *
 * Это принципиально. read() фильтрует бакеты через HAVING count(*) = factor, и
 * на базовом таймфрейме это count(*) = 1 — значит любая свеча, у которой в
 * parquet завёлся дубль, выбрасывается целиком. На BTCUSDT так теряется 3 956
 * свечей из 233 153. Миграция обязана перенести настоящие данные, а не то
 * урезанное представление, которое отдаёт старый стор.
 */
async function readRaw(
  runner: { run: (sql: string, params?: Record<string, number>) => Promise<Array<Record<string, unknown>>> },
  category: string,
  symbol: string,
  from: number,
  to: number,
): Promise<Candle[]> {
  const glob = join(marketRoot, "bybit", category, symbol, "5m", "*", "*.parquet").replaceAll("\\", "/");
  const rows = await runner.run(`
    SELECT open_time, open, high, low, close, volume, turnover FROM (
      SELECT *, row_number() OVER (PARTITION BY open_time) AS rn
      FROM read_parquet('${glob}', union_by_name=true)
      WHERE open_time >= $from AND open_time < $to
    ) WHERE rn = 1 ORDER BY open_time`, { from, to });
  return rows.map((row) => ({
    openTime: Number(row.open_time),
    open: Number(row.open), high: Number(row.high), low: Number(row.low),
    close: Number(row.close), volume: Number(row.volume), turnover: Number(row.turnover),
  }));
}

async function migrate(): Promise<void> {
  const source = new ParquetCandleStore(marketRoot);
  const target = new BinaryCandleStore(marketRoot);
  const runner = await createDuckDbRunner();
  await source.init();
  await target.init();

  const catalog = await source.catalog();
  if (!catalog.length) {
    console.log("В parquet ничего не найдено — переливать нечего.");
    await source.close();
    return;
  }

  console.log(`Символов к переливке: ${catalog.length}\n`);

  for (const item of catalog) {
    const startedAt = Date.now();
    let written = 0;
    // По календарным годам: столько же, сколько занимает один файл на выходе,
    // и держать в памяти приходится один год пятиминуток, а не всю историю.
    const firstYear = new Date(item.from).getUTCFullYear();
    const lastYear = new Date(item.to - 1).getUTCFullYear();
    for (let year = firstYear; year <= lastYear; year += 1) {
      const from = Math.max(item.from, Date.UTC(year, 0, 1));
      const to = Math.min(item.to, Date.UTC(year + 1, 0, 1));
      if (to <= from) continue;
      const candles = await readRaw(runner, item.category, item.symbol, from, to);
      if (!candles.length) continue;
      await target.write(item.category, item.symbol, candles);
      written += candles.length;
      console.log(`  ${item.symbol} ${year}: ${candles.length.toLocaleString("ru-RU")}`);
    }

    // Сверяемся с числом уникальных времён, а не с count(*): в parquet сидят
    // дубли, и сравнение с ними всегда давало бы ложное расхождение.
    const glob = join(marketRoot, "bybit", item.category, item.symbol, "5m", "*", "*.parquet").replaceAll("\\", "/");
    const [stats] = await runner.run(
      `SELECT count(DISTINCT open_time)::INTEGER AS unique_times FROM read_parquet('${glob}', union_by_name=true)`,
    );
    const uniqueTimes = Number(stats?.unique_times ?? 0);
    const check = (await target.catalog())
      .find((entry) => entry.symbol === item.symbol && entry.category === item.category);
    const ok = check && check.candles === uniqueTimes && check.from === item.from && check.to === item.to;
    const seconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
    const duplicates = item.candles - uniqueTimes;
    console.log(
      `${ok ? "OK " : "РАСХОЖДЕНИЕ"} ${item.symbol}: ${written.toLocaleString("ru-RU")} из ${uniqueTimes.toLocaleString("ru-RU")} за ${seconds} c`
      + (duplicates > 0 ? ` (в parquet было ${duplicates.toLocaleString("ru-RU")} дублей)` : ""),
    );
    if (!ok && check) {
      console.log(`     parquet: ${uniqueTimes} уникальных, ${new Date(item.from).toISOString()} — ${new Date(item.to).toISOString()}`);
      console.log(`     бинарь:  ${check.candles} свечей, ${new Date(check.from).toISOString()} — ${new Date(check.to).toISOString()}`);
    }
    console.log();
  }

  await source.close();
  await target.close();
  console.log("Готово. Данные parquet не тронуты — удалить их можно отдельно, когда бинарь себя покажет.");
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
