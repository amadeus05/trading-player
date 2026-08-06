import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "../../types";
import { fetchMarketCandles, parseMarketDatasetId, type MarketCatalogItem } from "../../shared/api/marketDataApi";
import { BASE_TIMEFRAME_MINUTES, MARKET_CANDLE_INTERVAL_MS } from "./marketCandleRanges";
import {
  isTimeRangeCovered,
  lowerBoundByTime,
  mergeTimeRanges,
  type TimeRange,
} from "./timeRanges";

/**
 * Сколько базовых свечей максимум держим под один запрос профиля. Профиль можно
 * растянуть хоть на год — на 5м это сто тысяч баров, которые незачем ни качать,
 * ни хранить. За порогом профиль остаётся на свечах экрана: он всё так же верен,
 * просто грубее, а это ровно то поведение, что было до появления этого хука.
 */
const MAX_BASE_CANDLES_PER_REQUEST = 20_000;

const rangeKey = (range: TimeRange) => `${range.from}:${range.to}`;

const mergeCandles = (current: Candle[], incoming: Candle[]): Candle[] => {
  if (!current.length) return incoming;
  if (!incoming.length) return current;
  const byTime = new Map<number, Candle>();
  current.forEach((candle) => byTime.set(candle.time, candle));
  incoming.forEach((candle) => byTime.set(candle.time, candle));
  return [...byTime.values()].sort((left, right) => left.time - right.time);
};

/**
 * Свечи базового таймфрейма — того, в котором физически лежит история.
 *
 * Нужны профилю объёма. Основное окно (`useActiveMarketCandles`) грузится сразу
 * в таймфрейме экрана, поэтому на часовом графике профиль считался по часовым
 * барам: одна свеча — одна точка гистограммы, и весь час размазывался ровно.
 * TradingView в этом месте берёт младший доступный таймфрейм, отсюда и хук.
 *
 * Окна докачиваются по требованию, под конкретный профиль, и копятся в общем
 * массиве на датасет: профилей на графике обычно единицы, и стоят они рядом.
 */
export function useBaseCandles(datasetId: string, catalog: MarketCatalogItem[]) {
  const candlesRef = useRef<Candle[]>([]);
  const coveredRef = useRef<TimeRange[]>([]);
  const pendingRef = useRef<Set<string>>(new Set());
  const loadedDatasetRef = useRef("");
  // Срез окна пересчитывается на каждом кадре синхронизации оверлеев, а свечей
  // в окне до двадцати тысяч — держим последний результат.
  const sliceCacheRef = useRef<{ revision: number; from: number; to: number; candles: Candle[] } | null>(null);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  // Данные приезжают асинхронно, а профиль читает их синхронно при отрисовке —
  // ревизия существует только чтобы попросить график пересинхронизировать
  // оверлеи, когда окно доехало.
  const [revision, setRevision] = useState(0);
  // Колбэк живёт дольше ревизии (его зависимость — только датасет), поэтому
  // сравнивать состояние из замыкания нельзя: оно навсегда осталось бы прежним,
  // и срез окна не обновился бы после прихода данных.
  const revisionRef = useRef(0);

  useEffect(() => {
    candlesRef.current = [];
    coveredRef.current = [];
    sliceCacheRef.current = null;
    pendingRef.current.clear();
    loadedDatasetRef.current = datasetId;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }, [datasetId]);

  /**
   * Базовые свечи на окне, если оно уже загружено. Иначе — пустой массив и
   * фоновая докачка: вызывающий на этот кадр берёт свой запасной источник.
   *
   * Отдаём именно срез окна, а не весь накопленный массив: пустота должна
   * означать «на это окно базовых данных нет», иначе вызывающий увидел бы
   * непустой массив от соседнего профиля и решил, что данные приехали.
   */
  const getBaseCandles = useCallback((fromSeconds: number, toSeconds: number): Candle[] => {
    if (!datasetId || loadedDatasetRef.current !== datasetId) return [];
    const wanted: TimeRange = { from: fromSeconds * 1_000, to: (toSeconds + 1) * 1_000 };
    if (wanted.to <= wanted.from) return [];
    if (wanted.to - wanted.from > MAX_BASE_CANDLES_PER_REQUEST * MARKET_CANDLE_INTERVAL_MS) return [];
    if (isTimeRangeCovered(wanted, coveredRef.current)) {
      const cached = sliceCacheRef.current;
      if (cached && cached.revision === revisionRef.current && cached.from === wanted.from && cached.to === wanted.to) {
        return cached.candles;
      }
      const source = candlesRef.current;
      const candles = source.slice(lowerBoundByTime(source, fromSeconds), lowerBoundByTime(source, toSeconds + 1));
      sliceCacheRef.current = { revision: revisionRef.current, from: wanted.from, to: wanted.to, candles };
      return candles;
    }

    const parsed = parseMarketDatasetId(datasetId);
    const catalogItem = catalogRef.current.find(
      (entry) => entry.category === parsed?.category && entry.symbol === parsed?.symbol,
    );
    if (!parsed || !catalogItem) return [];
    // Запрашиваем окно целиком, а не только дырки: профиль тянут краем, дырки
    // получались бы по одной свече, и на каждое движение уходил бы отдельный
    // запрос. Одно склеенное окно на профиль — это один запрос на его создание.
    const from = Math.max(catalogItem.from, wanted.from);
    const to = Math.min(catalogItem.to, wanted.to);
    if (to <= from) return [];
    const key = rangeKey({ from, to });
    if (pendingRef.current.has(key)) return [];
    pendingRef.current.add(key);

    const requestedDataset = datasetId;
    void fetchMarketCandles(parsed.category, parsed.symbol, from, to, BASE_TIMEFRAME_MINUTES)
      .then((rows) => {
        if (loadedDatasetRef.current !== requestedDataset) return;
        candlesRef.current = mergeCandles(candlesRef.current, rows);
        // Покрытым помечаем запрошенное окно целиком, а не обрезанное по
        // каталогу: за границами истории свечей нет и не будет, а разница между
        // «спросили» и «отдали» оставляла бы вечную дырку — профиль на самом
        // краю датасета перезапрашивал бы её каждый кадр.
        coveredRef.current = mergeTimeRanges([...coveredRef.current, wanted]);
        revisionRef.current += 1;
        setRevision(revisionRef.current);
      })
      .catch(() => {
        // Профиль остаётся на свечах экрана; следующее движение повторит попытку.
      })
      .finally(() => {
        pendingRef.current.delete(key);
      });
    return [];
  }, [datasetId]);

  return { getBaseCandles, baseCandlesRevision: revision };
}
