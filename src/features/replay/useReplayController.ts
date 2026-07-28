import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Candle } from "../../types";
import { DEFAULT_TIMEFRAME_MINUTES } from "../../shared/config/simulation";
import { aggregateCandles, inferCandleTimeframeMinutes } from "../../shared/lib/market";

interface UseReplayControllerOptions {
  rawCandles: Candle[];
  /** 5м-свечи вокруг головы: из них собирается незакрытая свеча текущего ТФ. */
  intrabarCandles?: Candle[];
  interactionActiveRef: RefObject<boolean>;
  initialTimeframe?: number;
}

/**
 * Незакрытая свеча текущего ТФ: собирается только из тех 5м-баров, что уже
 * проиграны. Без неё переход на старший ТФ показывал бы бакет целиком — стоя в
 * 00:30 на 5м и уйдя на дневку, ты увидел бы хаи и лои всего дня, которых ещё
 * не было.
 */
function buildPartialCandle(intrabar: Candle[], bucketStart: number, now: number): Candle | null {
  let open: number | null = null;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let volume = 0;
  for (const bar of intrabar) {
    if (bar.time < bucketStart) continue;
    if (bar.time > now) break;
    if (open == null) open = bar.open;
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    close = bar.close;
    volume += bar.volume;
  }
  if (open == null || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { time: bucketStart, open, high, low, close, volume };
}

interface AggregationCache {
  rawCandles: Candle[];
  candlesByTimeframe: Map<number, Candle[]>;
}

export function useReplayController({
  rawCandles,
  intrabarCandles = [],
  interactionActiveRef,
  initialTimeframe = DEFAULT_TIMEFRAME_MINUTES,
}: UseReplayControllerOptions) {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [index, setIndex] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectingStart, setSelectingStart] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [focusRevision, setFocusRevision] = useState(0);
  // Время головы живёт в ref, но достройка текущей свечи двигает его без смены
  // индекса — счётчик нужен, чтобы такой шаг вызвал перерисовку.
  const [playheadTick, setPlayheadTick] = useState(0);
  const aggregationCacheRef = useRef<AggregationCache | null>(null);
  // Реальное время головы воспроизведения. Позиция плеера индексная, но индекс
  // привязан к таймфрейму; чтобы 1ч→1д→1ч не терял прогресс внутри дня, держим
  // отдельно настоящее время и восстанавливаем позицию из него при смене ТФ.
  // Обновляется ТОЛЬКО в реальных перемещениях (шаг/play/выбор/reset) синхронно,
  // не через эффект: иначе промежуточный ре-рендер при догрузке окна писал бы
  // сюда случайную свечу со ещё не поправленным индексом.
  const playheadTimeRef = useRef<number | null>(null);

  useEffect(() => {
    setTimeframe(initialTimeframe);
  }, [initialTimeframe]);

  const getAggregatedCandles = useCallback((targetTimeframe: number): Candle[] => {
    let cache = aggregationCacheRef.current;
    if (!cache || cache.rawCandles !== rawCandles) {
      const sourceTimeframe = inferCandleTimeframeMinutes(rawCandles);
      cache = {
        rawCandles,
        candlesByTimeframe: new Map([[sourceTimeframe, rawCandles]]),
      };
      aggregationCacheRef.current = cache;
    }

    const cached = cache.candlesByTimeframe.get(targetTimeframe);
    if (cached) return cached;

    const aggregated = aggregateCandles(rawCandles, targetTimeframe);
    cache.candlesByTimeframe.set(targetTimeframe, aggregated);
    return aggregated;
  }, [rawCandles]);

  const candles = useMemo(
    () => getAggregatedCandles(timeframe),
    [getAggregatedCandles, timeframe],
  );
  const lastIndex = Math.max(0, candles.length - 1);
  const replayIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, lastIndex));
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  // Конец текущей свечи — нужен шагу, чтобы понять, закрыта она или достраивается.
  // Значение производное, отставание максимум на один рендер само себя исправляет.
  const currentEndRef = useRef<number | null>(null);

  /**
   * Конец свечи — момент, в котором она закрыта и целиком известна. Именно он и
   * есть «сейчас» для плеера: стоя на часовой свече 13:00, ты видел весь час,
   * значит текущее время 13:59:59, а не 13:00. Если брать открытие, переход на
   * младший ТФ откатывал бы голову в начало периода и уже показанные свечи
   * снова становились бы будущим.
   */
  const candleEndTime = (source: Candle[], targetIndex: number): number | null => {
    const time = source[targetIndex]?.time;
    if (time == null) return null;
    const next = source[targetIndex + 1]?.time;
    const span = next != null && next > time ? next - time : timeframeRef.current * 60;
    return time + span - 1;
  };
  currentEndRef.current = candleEndTime(candles, replayIndex);

  // Если голова стоит внутри текущего бакета (пришли с младшего ТФ), показываем
  // не готовую свечу, а собранную из уже проигранных 5м-баров. Если голова на
  // конце свечи — она закрыта, подменять нечего.
  const displayCandles = useMemo(() => {
    const base = candles[replayIndex];
    const now = playheadTimeRef.current;
    const end = base ? candleEndTime(candles, replayIndex) : null;
    if (!base || now == null || !intrabarCandles.length) return candles;
    if (end == null || now >= end) return candles;
    const partial = buildPartialCandle(intrabarCandles, base.time, now);
    if (!partial) return candles;
    const next = candles.slice();
    next[replayIndex] = partial;
    return next;
    // playheadTick — достройка свечи двигает время головы без смены индекса.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, intrabarCandles, replayIndex, playheadTick]);
  const currentCandle = displayCandles[replayIndex];

  // Ставим время головы по индексу в ТЕКУЩЕМ таймфрейме. Вызывается из тех же
  // мест, что и setIndex при настоящем перемещении.
  const commitPlayhead = useCallback((targetIndex: number) => {
    const end = candleEndTime(candlesRef.current, targetIndex);
    if (end != null) playheadTimeRef.current = end;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Один шаг воспроизведения. Если текущая свеча ещё не закрыта (мы внутри
   * бакета после перехода со младшего ТФ), сначала достраиваем её до конца —
   * иначе «следующая свеча» перепрыгивала недостроенную, та молча становилась
   * полной, и сразу появлялась ещё одна.
   */
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = () => {
    const now = playheadTimeRef.current;
    const end = currentEndRef.current;
    if (end != null && now != null && now < end) {
      playheadTimeRef.current = end;
      setPlayheadTick((tick) => tick + 1);
      return;
    }
    // Функциональное обновление, а не индекс из ref: React применяет его к
    // актуальному состоянию, поэтому шаг всегда ровно +1, даже если тик пришёл
    // раньше ре-рендера. С ref индекс мог разъехаться с состоянием и один тик
    // перебрасывал плеер на сотни свечей вперёд.
    setIndex((current) => {
      const source = candlesRef.current;
      const last = source.length - 1;
      const safe = Math.max(0, Math.min(current, last));
      if (safe >= last) return safe;
      const next = safe + 1;
      const nextEnd = candleEndTime(source, next);
      if (nextEnd != null) playheadTimeRef.current = nextEnd;
      return next;
    });
  };

  // Первичная инициализация: до первого перемещения голова стоит на стартовой
  // свече. Смена датасета сбрасывает playhead в null (см. setIndexExternal) —
  // тогда этот эффект переустановит его уже по свече нового датасета.
  useEffect(() => {
    if (playheadTimeRef.current == null) {
      const end = candleEndTime(candlesRef.current, replayIndex);
      if (end != null) playheadTimeRef.current = end;
    }
  }, [currentCandle, replayIndex]);

  useEffect(() => {
    setIndex((current) => Math.max(0, Math.min(current, candles.length - 1)));
  }, [candles.length]);

  // Позиция плеера индексная, а окно свечей заменяется целиком: прыжок на свечу
  // перезагружает его вокруг новой точки (ради форвард-буфера), догрузка влево
  // prepend'ит. После замены прежний индекс молча указывает на ДРУГУЮ свечу:
  // окно сдвинулось вперёд на N проигранных баров — и все «обрезанные» свечи
  // снова оказывались позади головы, первый же тик play дорисовывал их разом.
  // Поэтому после каждой замены массива заново находим свечу по времени головы.
  const prevAggregatedRef = useRef<{ timeframe: number; candles: Candle[] | null }>({
    timeframe,
    candles: null,
  });
  useEffect(() => {
    const prev = prevAggregatedRef.current;
    prevAggregatedRef.current = { timeframe, candles };
    if (prev.candles === candles || prev.candles == null) return;
    // Смену ТФ ведёт changeTimeframe со своим якорем — не вмешиваемся.
    if (prev.timeframe !== timeframe) return;
    const anchor = playheadTimeRef.current;
    if (anchor == null || !candles.length) return;
    // Последняя свеча, начавшаяся не позже головы (голова — конец свечи).
    let low = 0;
    let high = candles.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (candles[mid].time <= anchor) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found < 0) return;
    setIndex((current) => {
      const safe = Math.max(0, Math.min(current, candles.length - 1));
      // Индекс всё ещё указывает на ту же свечу — не трогаем (обычный append).
      return candles[safe]?.time === candles[found].time ? safe : found;
    });
  }, [candles, timeframe]);

  // Дошли до конца загруженных свечей — воспроизведение останавливается.
  // Отдельным эффектом, а не внутри шага: шаг теперь функциональный апдейт, а
  // вызывать setPlaying из него — побочный эффект во время рендера.
  useEffect(() => {
    if (playing && replayIndex >= lastIndex) setPlaying(false);
  }, [playing, replayIndex, lastIndex]);

  useEffect(() => {
    if (!playing) return;
    const intervalMs = Math.max(80, 800 / speed);
    let cancelled = false;
    let rafId = 0;
    let lastTickAt = performance.now();

    const loop = (now: number) => {
      if (cancelled) return;
      rafId = window.requestAnimationFrame(loop);
      if (now - lastTickAt < intervalMs) return;
      // Drop backlog instead of stacking setState — keeps the main thread responsive
      // when a previous candle render/overlays still occupy the frame budget.
      lastTickAt = now;
      if (interactionActiveRef.current) return;
      // Low-priority update so pointer/crosshair input wins over candle ticks.
      startTransition(() => advanceRef.current());
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [interactionActiveRef, lastIndex, playing, speed]);

  const changeTimeframe = (nextTimeframe: number, anchorTime = playheadTimeRef.current ?? currentCandle?.time) => {
    const nextCandles = getAggregatedCandles(nextTimeframe);
    let nextIndex = 0;
    if (anchorTime != null) {
      for (let candidate = 0; candidate < nextCandles.length; candidate += 1) {
        if (nextCandles[candidate].time > anchorTime) break;
        nextIndex = candidate;
      }
    }
    // playhead намеренно не трогаем: индекс уедет на открытие свечи нового ТФ,
    // а настоящее время головы должно остаться, иначе обратное переключение
    // вернёт в начало периода.
    setTimeframe(nextTimeframe);
    setIndex(nextIndex);
    setFocusRevision((current) => current + 1);
  };

  const getPlayheadTime = useCallback(() => playheadTimeRef.current, []);

  const selectIndex = (nextIndex: number) => {
    setPlaying(false);
    const clamped = Math.max(0, Math.min(nextIndex, lastIndex));
    commitPlayhead(clamped);
    setIndex(clamped);
    setSelectingStart(false);
    setFocusRevision((current) => current + 1);
  };

  const selectTime = (time: number) => {
    const foundIndex = candles.findIndex((candle) => candle.time >= time);
    selectIndex(foundIndex === -1 ? lastIndex : foundIndex);
  };

  const handleStartAction = (key: string) => {
    setPlaying(false);
    if (key === "bar") setSelectingStart(true);
    if (key === "date") setDatePickerOpen(true);
    if (key === "first") selectIndex(0);
    if (key === "random") selectIndex(Math.floor(Math.random() * Math.max(1, lastIndex)));
  };

  const step = () => advanceRef.current();
  const reset = () => {
    setPlaying(false);
    const next = Math.min(120, lastIndex);
    commitPlayhead(next);
    setIndex(next);
  };

  // Внешняя репозиция (смена датасета) — сбрасываем playhead, чтобы он взялся
  // заново по свече нового датасета, а не остался от прежнего.
  const setIndexExternal = (value: number) => {
    playheadTimeRef.current = null;
    setIndex(value);
  };

  return {
    candles: displayCandles,
    currentCandle,
    datePickerOpen,
    focusRevision,
    lastIndex,
    playing,
    replayIndex,
    selectingStart,
    speed,
    timeframe,
    changeTimeframe,
    getPlayheadTime,
    handleStartAction,
    reset,
    selectTime,
    setDatePickerOpen,
    setIndex: setIndexExternal,
    setPlaying,
    setSpeed,
    step,
  };
}
