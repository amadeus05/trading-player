import type { Candle } from "../../types";
import { buildEarlierMarketCandleRange } from "./marketCandleRanges";

/**
 * Сколько раз расширять окно, не набрав нужного числа баров.
 *
 * Первая попытка меряет отрезок по плотности загруженного окна, дальше он растёт
 * втрое. Шести хватает на любую паузу: рождественский перерыв вчетверо длиннее
 * выходных. Цикл рвётся на первой достаточной попытке, поэтому круглосуточной
 * крипте всегда хватает одного запроса.
 */
export const EARLIER_ATTEMPTS = 6;

export interface EarlierCandlesRequest {
  /** Границы скачанной истории: левее boundary.from брать нечего. */
  boundary: { from: number; to: number };
  /** Уже загруженное окно — по нему считаются шаг бара и правый край запроса. */
  loaded: Candle[];
  /** Сколько баров не хватает до левого края рамки. */
  missingBars: number;
  fallbackTimeframeMinutes: number;
  fetchRange: (fromMs: number, toMs: number) => Promise<Candle[]>;
  attempts?: number;
}

/**
 * Бары левее загруженного окна — РОВНО столько, сколько не хватает до края рамки.
 *
 * Календарное время не равно числу баров: у форекса выходные съедают почти треть
 * недели. Просить «missingBars × таймфрейм» назад нельзя — такой отрезок либо
 * пуст (весь в закрытом рынке), либо отдаёт меньше баров, чем в нём часов. И то
 * и другое оставляет пустоту у левого края, а повторную проверку края график в
 * этот момент не запускает: недобор замирает до следующего движения мыши.
 *
 * Поэтому окно расширяется до нужного числа баров, а отдаётся ровно нужное:
 * левый край двигается свеча за свечой, как на круглосуточной крипте. Меньше
 * запрошенного возвращается только на начале скачанной истории.
 */
export async function collectEarlierCandles({
  boundary,
  loaded,
  missingBars,
  fallbackTimeframeMinutes,
  fetchRange,
  attempts = EARLIER_ATTEMPTS,
}: EarlierCandlesRequest): Promise<Candle[]> {
  const first = loaded[0];
  if (!first || missingBars <= 0) return [];

  let older: Candle[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const range = buildEarlierMarketCandleRange(
      boundary,
      loaded,
      missingBars,
      attempt,
      fallbackTimeframeMinutes,
    );
    if (!range) break;
    const rows = await fetchRange(range.from, range.to);
    older = rows.filter((row) => row.time < first.time);
    if (older.length >= missingBars) break;
    if (range.from <= boundary.from) break;
  }

  return older.slice(-missingBars);
}
