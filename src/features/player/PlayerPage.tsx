import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Button, Empty } from "antd";
import { PanelRightOpen } from "lucide-react";
import type { AmbiguousExitPolicy, Candle, Dataset, SimulationSettings } from "../../types";
import type { DrawingMode, MagnetMode } from "../../drawing";
import { isMagnetMode } from "../../drawing";
import { ReplayChart, type ChartViewportRef } from "../chart/ReplayChart";
import { PlayerModals } from "./PlayerModals";
import { JournalDrawer } from "../journal/JournalDrawer";
import { ReplayControls } from "../replay/ReplayControls";
import { AppHeader } from "../../widgets/AppHeader";
import { PlayerToolbar } from "../../widgets/PlayerToolbar";
import { DrawingToolsRail, DRAWING_TOOL_SHORTCUTS } from "../../widgets/DrawingToolsRail";
import { TradingSidebar } from "../trading/TradingSidebar";
import { DEFAULT_ACCOUNT_SETTINGS, DEFAULT_SIMULATION_SETTINGS, REPLAY_START_BAR_INDEX, cycleTradingSessionsVariant } from "../../shared/config/simulation";
import { formatMarketPair, formatTimeframe, getMarketAssets, inferPricePrecision } from "../../shared/lib/market";
import { resolveChartTimeZoneIana, sanitizeChartTimeZone } from "../../shared/lib/chartTimezones";
import { usePersistedPlayerState } from "./usePersistedPlayerState";
import { useChartFullscreen } from "./useChartFullscreen";
import { useReplayController } from "../replay/useReplayController";
import { selectDrawingCollections, useDrawingCollections, countDrawingsForDataset } from "../drawings/useDrawingCollections";
import { useTradeEditing } from "../trading/useTradeEditing";
import { useTradingSimulation } from "../trading/useTradingSimulation";
import { useOrderForm } from "../trading/useOrderForm";
import { useChartDisplayState } from "../chart/useChartDisplayState";
import { calculateAccountStats } from "../trading/lib/calculateAccountStats";
import { useMarketCatalog } from "../datasets/useMarketCatalog";
import { useActiveMarketCandles, candleCacheKey } from "../datasets/useActiveMarketCandles";
import { useBaseCandles } from "../datasets/useBaseCandles";
import {
  prefetchMarketCandleThresholdForTimeframe,
  resolvePendingTimeframeChange,
  shouldPrefetchMarketCandles,
} from "../datasets/marketCandleRanges";

const TRADE_PANEL_TAB_AUTO_HIDE_MS = 1000;

export function PlayerPage() {
  const { message } = AntApp.useApp();
  const chartInteractionActive = useRef(false);
  const deleteAllDrawingsRef = useRef<(() => void) | null>(null);
  const chartViewportRef = useRef<ChartViewportRef | null>(null);
  const candleCacheRef = useRef<Map<string, Candle[]>>(new Map());
  const { appRef, chartFullscreenActive, toggleChartFullscreen } = useChartFullscreen();
  const { state, setState, initialDatasetId, initialTimeframe, hydrated } = usePersistedPlayerState();
  const displayTimeframeRef = useRef(initialTimeframe);
  const { catalog, datasetOptions, ready: catalogReady, refresh: refreshCatalog } = useMarketCatalog();
  const drawingActions = useDrawingCollections(setState);
  const drawings = useMemo(
    () => selectDrawingCollections(state),
    [
      state.fibonacciRetracements,
      state.fibonacciTrendExtensions,
      state.horizontalLines,
      state.parallelChannels,
      state.rectangles,
      state.trendLines,
      state.volumeProfiles,
    ],
  );
  const [dataset, setDataset] = useState(""),
    [journal, setJournal] = useState(false),
    [tradePanelOpen, setTradePanelOpen] = useState(() => {
      try {
        return localStorage.getItem("player:trade-panel-open") !== "0";
      } catch {
        return true;
      }
    }),
    [settingsOpen, setSettingsOpen] = useState(false),
    [drawingMode, setDrawingMode] = useState<DrawingMode>("none"),
    [magnetMode, setMagnetMode] = useState<MagnetMode>(() => {
      try {
        const stored = localStorage.getItem("player:magnet-mode");
        return isMagnetMode(stored) ? stored : "off";
      } catch {
        return "off";
      }
    }),
    [drawingsVisible, setDrawingsVisible] = useState(true),
    [tradePanelTabPeek, setTradePanelTabPeek] = useState(false);
  const tradePanelTabHideTimerRef = useRef<number | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("player:trade-panel-open", tradePanelOpen ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }, [tradePanelOpen]);
  useEffect(() => {
    try {
      localStorage.setItem("player:magnet-mode", magnetMode);
    } catch {
      /* ignore quota / private mode */
    }
  }, [magnetMode]);
  const drawingCount = useMemo(
    () => (dataset ? countDrawingsForDataset(drawings, dataset) : 0),
    [drawings, dataset],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element) {
        const tag = target.tagName;
        const editable = target instanceof HTMLElement && target.isContentEditable;
        if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const shortcut = DRAWING_TOOL_SHORTCUTS.find((s) => s.code === event.code);
        if (shortcut) {
          event.preventDefault();
          setDrawingMode((prev) => (prev === shortcut.mode ? "none" : shortcut.mode));
          return;
        }
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const shouldUndo = event.code === "KeyZ" && !event.shiftKey;
      const shouldRedo = event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey);
      if (!shouldUndo && !shouldRedo) return;
      event.preventDefault();
      if (shouldUndo) drawingActions.undo();
      if (shouldRedo) drawingActions.redo();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawingActions]);
  useEffect(() => {
    const release = () => { chartInteractionActive.current = false; };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  useEffect(() => {
    if (!hydrated || !catalogReady || dataset) return;
    const preferred = initialDatasetId && datasetOptions.some((option) => option.id === initialDatasetId)
      ? initialDatasetId
      : datasetOptions[0]?.id ?? "";
    if (preferred) setDataset(preferred);
  }, [catalogReady, dataset, datasetOptions, hydrated, initialDatasetId]);

  const activeDataset = datasetOptions.find((option) => option.id === dataset);
  const simulationSettings = useMemo(
    () => ({ ...DEFAULT_SIMULATION_SETTINGS, ...state.settings }),
    [state.settings],
  );
  const chartTimeZoneId = sanitizeChartTimeZone(simulationSettings.chartTimeZone);
  const chartTimeZoneIana = resolveChartTimeZoneIana(chartTimeZoneId, activeDataset?.category);
  const tradePanelTabPinned = simulationSettings.tradePanelTabPinned;
  const clearTradePanelTabHideTimer = useCallback(() => {
    if (tradePanelTabHideTimerRef.current != null) {
      window.clearTimeout(tradePanelTabHideTimerRef.current);
      tradePanelTabHideTimerRef.current = null;
    }
  }, []);
  const scheduleTradePanelTabHide = useCallback(() => {
    if (tradePanelTabPinned) return;
    clearTradePanelTabHideTimer();
    tradePanelTabHideTimerRef.current = window.setTimeout(() => {
      tradePanelTabHideTimerRef.current = null;
      setTradePanelTabPeek(false);
    }, TRADE_PANEL_TAB_AUTO_HIDE_MS);
  }, [clearTradePanelTabHideTimer, tradePanelTabPinned]);
  const showTradePanelTab = useCallback(() => {
    setTradePanelTabPeek(true);
    scheduleTradePanelTabHide();
  }, [scheduleTradePanelTabHide]);
  useEffect(() => {
    if (tradePanelTabPinned || tradePanelOpen) {
      clearTradePanelTabHideTimer();
      setTradePanelTabPeek(false);
    }
  }, [clearTradePanelTabHideTimer, tradePanelOpen, tradePanelTabPinned]);
  useEffect(() => () => clearTradePanelTabHideTimer(), [clearTradePanelTabHideTimer]);
  const accountSettings = useMemo(
    () => ({ ...DEFAULT_ACCOUNT_SETTINGS, ...state.account }),
    [state.account],
  );
  const { baseAsset, quoteAsset } = getMarketAssets(activeDataset?.name);
  const {
    candles: raw,
    intrabarCandles,
    loading: candlesLoading,
    loadingMore: candlesLoadingMore,
    hasMore: hasMoreCandles,
    loadMore: loadMoreCandles,
    loadEarlier: loadEarlierCandles,
    loadAroundTime: loadCandlesAroundTime,
    ensureIntrabarAround,
  } = useActiveMarketCandles(
    dataset,
    catalog,
    candleCacheRef,
    initialTimeframe,
    displayTimeframeRef,
  );
  // Профиль объёма считается по базовому таймфрейму, а не по свечам экрана:
  // основное окно грузится сразу в отображаемом ТФ, и на часовом графике одна
  // свеча давала одну точку гистограммы.
  const { getBaseCandles, baseCandlesRevision } = useBaseCandles(dataset, catalog);
  // Точность цены — константа символа, но первый кусок истории может быть
  // «круглым» (0.97 / 0.98). Берём максимум по мере догрузки, вниз не опускаем:
  // шкала от этого только мельче, график не прыгает назад к двум знакам.
  const pricePrecisionCacheRef = useRef<Map<string, number>>(new Map());
  const pricePrecision = useMemo(() => {
    if (!raw.length) return pricePrecisionCacheRef.current.get(dataset) ?? 2;
    const inferred = inferPricePrecision(raw);
    const cached = pricePrecisionCacheRef.current.get(dataset);
    const precision = cached == null ? inferred : Math.max(cached, inferred);
    pricePrecisionCacheRef.current.set(dataset, precision);
    return precision;
  }, [dataset, raw]);
  const {
    candles,
    currentCandle: cur,
    datePickerOpen,
    focusRevision,
    lastIndex,
    playing,
    replayIndex,
    selectingStart,
    speed,
    timeframe: tf,
    changeTimeframe,
    getPlayheadTime,
    handleStartAction: handleReplayStartAction,
    reset,
    selectTime: selectReplayTime,
    setDatePickerOpen,
    setIndex: setIdx,
    setPlaying,
    setSpeed,
    step,
    stepBack,
  } = useReplayController({
    rawCandles: raw,
    intrabarCandles,
    datasetId: dataset,
    interactionActiveRef: chartInteractionActive,
    initialTimeframe,
  });
  displayTimeframeRef.current = tf;
  // Счётчик в баре плеера показывает положение во ВСЁМ датасете, а не в
  // загруженном окне: окно подгружается кусками и его размер прыгал, создавая
  // впечатление, что истории всего пара тысяч свечей.
  const datasetCandleCount = useMemo(() => {
    if (!activeDataset) return candles.length;
    const factor = Math.max(1, Math.round(tf / 5));
    return Math.max(1, Math.floor(activeDataset.baseCandles / factor));
  }, [activeDataset, candles.length, tf]);
  const replayPosition = useMemo(() => {
    if (!activeDataset || cur?.time == null) return replayIndex + 1;
    const bucketMs = tf * 60_000;
    const passed = Math.floor((cur.time * 1_000 - activeDataset.from) / bucketMs) + 1;
    return Math.max(1, Math.min(passed, datasetCandleCount));
  }, [activeDataset, cur?.time, datasetCandleCount, replayIndex, tf]);
  const [pendingReplayTime, setPendingReplayTime] = useState<number | null>(null);
  // Окно данных под выбранное время уже приехало. Без этого флага выбор
  // применялся к СТАРОМУ окну, если оно тоже покрывало нужное время: индекс
  // считался для него, а потом приезжало новое окно — и тот же номер означал
  // уже другую свечу. Отсюда после второго прыжка раскрывалась куча свечей.
  const [pendingJumpReady, setPendingJumpReady] = useState(false);
  const [pendingTimeframeChange, setPendingTimeframeChange] = useState<{
    timeframe: number;
    replayTime: number;
  } | null>(null);
  const startJumpPending = pendingReplayTime != null || pendingTimeframeChange != null;
  useEffect(() => {
    if (!hasMoreCandles || candlesLoadingMore) return;
    if (!shouldPrefetchMarketCandles(raw, cur?.time, prefetchMarketCandleThresholdForTimeframe(tf))) return;
    void loadMoreCandles();
  }, [candlesLoadingMore, cur?.time, hasMoreCandles, loadMoreCandles, raw, tf]);
  // График оттащили левее первой свечи: догружаем недостающие бары ТФ экрана.
  const handleNeedEarlierCandles = useCallback((missingBars: number) => {
    void loadEarlierCandles(missingBars);
  }, [loadEarlierCandles]);
  // 5м-окно вокруг головы: из него собирается незакрытая свеча и работает
  // intrabar-резолвер SL/TP. Смена ТФ обнуляет окно, но время текущей свечи при
  // этом может не измениться — например, 12:00 это граница и часа, и четырёх
  // часов. По одному лишь cur.time эффект тогда не срабатывал, окно оставалось
  // пустым, и старший ТФ показывал полную свечу вместо незакрытой. Поэтому
  // следим ещё за таймфреймом и за самим фактом пустого окна.
  useEffect(() => {
    if (cur?.time != null) void ensureIntrabarAround(cur.time);
  }, [cur?.time, tf, intrabarCandles.length, ensureIntrabarAround]);
  useEffect(() => {
    if (pendingReplayTime == null || !pendingJumpReady || !raw.length) return;
    const last = raw.at(-1)!.time;
    if (pendingReplayTime > last) return;
    selectReplayTime(pendingReplayTime);
    setPendingReplayTime(null);
    setPendingJumpReady(false);
  }, [pendingJumpReady, pendingReplayTime, raw, selectReplayTime]);
  useEffect(() => {
    const next = resolvePendingTimeframeChange(pendingTimeframeChange, raw);
    if (!next) return;
    changeTimeframe(next.timeframe, next.replayTime);
    setState((current) => ({
      ...current,
      timeframeMinutes: next.timeframe,
    }));
    setPendingTimeframeChange(null);
  }, [changeTimeframe, pendingTimeframeChange, raw, setState]);
  const selectReplayTimeWithData = useCallback((time: number, timeframeMinutes = tf) => {
    setPlaying(false);
    setPendingReplayTime(time);
    setPendingJumpReady(false);
    void loadCandlesAroundTime(time, timeframeMinutes).then((loaded) => {
      if (loaded) setPendingJumpReady(true);
      else setPendingReplayTime(null);
    });
  }, [loadCandlesAroundTime, setPlaying, tf]);
  const handleStartAction = useCallback((key: string) => {
    if (key === "first" && activeDataset) {
      selectReplayTimeWithData(Math.floor(activeDataset.from / 1_000));
      return;
    }
    if (key === "random" && activeDataset) {
      const randomTime = Math.floor((activeDataset.from + Math.random() * Math.max(1, activeDataset.to - activeDataset.from)) / 1_000);
      selectReplayTimeWithData(randomTime);
      return;
    }
    handleReplayStartAction(key);
  }, [activeDataset, handleReplayStartAction, selectReplayTimeWithData]);
  const accountStats = useMemo(
    () => calculateAccountStats(accountSettings, state.trades, cur),
    [accountSettings, cur, state.trades],
  );
  const recentProtectionCandles = useMemo(() => {
    if (!candles.length) return [];
    const end = Math.max(0, Math.min(replayIndex, candles.length - 1));
    return candles.slice(Math.max(0, end - 19), end + 1);
  }, [candles, replayIndex]);
  const orderForm = useOrderForm({
    currentCandle: cur,
    recentCandles: recentProtectionCandles,
    pricePrecision,
    settings: simulationSettings,
    balance: accountStats.balance,
    availableBalance: accountStats.availableBalance,
  });
  const {
    focusedTradeId,
    tradeEditDraft,
    cancelTradeEditing,
    moveBarrier,
    moveEntryMarker,
    saveTradeEditing,
    setFocusedTradeId,
    setTradeEditDraft,
    startTradeEditing,
  } = useTradeEditing({
    state,
    setState,
    settings: simulationSettings,
    pricePrecision,
    onDraftTakeProfitChange: orderForm.setTakeProfit,
    onDraftStopLossChange: orderForm.setStopLoss,
    onDraftLimitPriceChange: orderForm.setLimitPrice,
    onSuccess: message.success,
    onWarning: message.warning,
  });
  const {
    workingTrades,
    cancelOrder,
    closeTrade,
    deleteTrade,
    deleteAllTrades,
    placeOrder,
    updateTradeJournal,
  } = useTradingSimulation({
    enabled: hydrated,
    datasetId: dataset,
    state,
    setState,
    rawCandles: intrabarCandles,
    currentCandle: cur,
    timeframe: tf,
    getPlayheadTime,
    settings: simulationSettings,
    pricePrecision,
    availableBalance: accountStats.availableBalance,
    orderForm,
    setFocusedTradeId,
    setTradeEditDraft,
  });
  const chartDisplay = useChartDisplayState({
    trades: state.trades,
    annotations: state.annotations,
    workingTrades,
    focusedTradeId,
    tradeEditDraft,
    currentCandle: cur,
    orderForm,
    makerFeePct: simulationSettings.makerFeePct,
    takerFeePct: simulationSettings.takerFeePct,
  });
  function updateSimulationSetting(
    key: Exclude<keyof SimulationSettings, "showClosedTradeOverlays" | "followCandle" | "tradePanelTabPinned" | "headerStatsVariant" | "tradingSessionsVariant" | "showFairValueGaps" | "ambiguousExitPolicy" | "chartTimeZone">,
    value: number | null,
  ) {
    setState((current) => ({
      ...current,
      settings: { ...(current.settings ?? DEFAULT_SIMULATION_SETTINGS), [key]: Math.max(0, value ?? 0) },
    }));
  }
  function updateAmbiguousExitPolicy(value: AmbiguousExitPolicy) {
    setState((current) => ({
      ...current,
      settings: {
        ...DEFAULT_SIMULATION_SETTINGS,
        ...current.settings,
        ambiguousExitPolicy: value,
      },
    }));
  }
  function updateInitialBalance(value: number | null) {
    setState((current) => ({
      ...current,
      account: {
        ...DEFAULT_ACCOUNT_SETTINGS,
        ...current.account,
        initialBalance: Math.max(0, value ?? 0),
      },
    }));
  }
  const handleTimeframeChange = useCallback((nextTimeframe: number) => {
    // Настоящее время головы, а не открытие текущей свечи ТФ: на старших ТФ оно
    // схлопывалось на начало периода, и переключение теряло прогресс внутри дня.
    const replayTime = getPlayheadTime() ?? cur?.time;
    setPlaying(false);
    if (replayTime == null) {
      changeTimeframe(nextTimeframe);
      setState((current) => ({ ...current, timeframeMinutes: nextTimeframe }));
      return;
    }
    setPendingTimeframeChange({ timeframe: nextTimeframe, replayTime });
    void loadCandlesAroundTime(replayTime, nextTimeframe).then((loaded) => {
      if (!loaded) setPendingTimeframeChange(null);
    });
  }, [changeTimeframe, cur?.time, getPlayheadTime, loadCandlesAroundTime, setPlaying, setState]);
  const handleMarketOpen = useCallback((market: Dataset) => {
    // История открывает рынок без свечей: окно подтянет useActiveMarketCandles.
    // Пустой массив в кеш класть нельзя — хук считает любую запись готовыми
    // данными и на пустой показал бы голый график вместо загрузки.
    setPendingTimeframeChange(null);
    setPendingReplayTime(null);
    setPendingJumpReady(false);
    if (market.candles.length) {
      candleCacheRef.current.set(candleCacheKey(market.id, displayTimeframeRef.current), market.candles);
    }
    void refreshCatalog();
    setDataset(market.id);
    setState((current) => ({ ...current, lastDatasetId: market.id }));
    setIdx(REPLAY_START_BAR_INDEX);
  }, [refreshCatalog, setIdx, setState]);
  return (
    <div className="app" ref={appRef}>
      <AppHeader
        tradeCount={state.trades.length}
        quoteAsset={quoteAsset}
        accountStats={accountStats}
        headerStatsVariant={simulationSettings.headerStatsVariant}
        onSettingsOpen={() => setSettingsOpen(true)}
        onJournalOpen={() => setJournal(true)}
      />
      <main className={tradePanelOpen ? undefined : "trade-panel-collapsed"}>
        <section className="workspace">
          <PlayerToolbar
            datasetOptions={datasetOptions}
            datasetId={dataset}
            datasetsLoading={!catalogReady || candlesLoading}
            timeframe={tf}
            onDatasetChange={(nextDataset) => {
              setPendingTimeframeChange(null);
              setPendingReplayTime(null);
              setPendingJumpReady(false);
              setDataset(nextDataset);
              setState((current) => ({ ...current, lastDatasetId: nextDataset }));
              setIdx(REPLAY_START_BAR_INDEX);
            }}
            onTimeframeChange={handleTimeframeChange}
            chartTimeZone={chartTimeZoneId}
            chartTimeZoneCategory={activeDataset?.category}
            onChartTimeZoneChange={(id) => setState((current) => ({
              ...current,
              settings: {
                ...DEFAULT_SIMULATION_SETTINGS,
                ...current.settings,
                chartTimeZone: sanitizeChartTimeZone(id),
              },
            }))}
            chartFullscreenActive={chartFullscreenActive}
            onToggleChartFullscreen={toggleChartFullscreen}
            tradingSessionsVariant={simulationSettings.tradingSessionsVariant}
            onCycleTradingSessions={() => setState((current) => ({
              ...current,
              settings: {
                ...DEFAULT_SIMULATION_SETTINGS,
                ...current.settings,
                tradingSessionsVariant: cycleTradingSessionsVariant(simulationSettings.tradingSessionsVariant),
              },
            }))}
            fairValueGapsActive={simulationSettings.showFairValueGaps}
            onToggleFairValueGaps={() => setState((current) => ({
              ...current,
              settings: {
                ...DEFAULT_SIMULATION_SETTINGS,
                ...current.settings,
                showFairValueGaps: !simulationSettings.showFairValueGaps,
              },
            }))}
          />
          <div className="chartArea">
            <DrawingToolsRail
              drawingMode={drawingMode}
              magnetMode={magnetMode}
              drawingsVisible={drawingsVisible}
              drawingCount={drawingCount}
              canUndoDrawings={drawingActions.canUndo}
              canRedoDrawings={drawingActions.canRedo}
              onDrawingModeChange={setDrawingMode}
              onMagnetModeChange={setMagnetMode}
              onDrawingsVisibleChange={setDrawingsVisible}
              onUndoDrawings={drawingActions.undo}
              onRedoDrawings={drawingActions.redo}
              onDeleteAllDrawings={() => deleteAllDrawingsRef.current?.()}
            />
            <div className="chartWrap">
              {candles.length ? (
                <ReplayChart
                  candles={candles}
                  getBaseCandles={getBaseCandles}
                  baseCandlesRevision={baseCandlesRevision}
                  index={replayIndex}
                  barriers={chartDisplay.barriers}
                  trades={chartDisplay.trades}
                  onBarrierChange={moveBarrier}
                  selectingStart={selectingStart}
                  onStartSelected={selectReplayTimeWithData}
                  focusRevision={focusRevision}
                  pricePrecision={pricePrecision}
                  quoteAsset={quoteAsset}
                  entryMarker={chartDisplay.entryMarker}
                  onEntryMarkerChange={moveEntryMarker}
                  showClosedTradeOverlays={simulationSettings.showClosedTradeOverlays}
                  tradingSessionsVariant={simulationSettings.tradingSessionsVariant}
                  showFairValueGaps={simulationSettings.showFairValueGaps}
                  timeZone={chartTimeZoneIana}
                  markersEditable={chartDisplay.markersEditable}
                  drawings={drawings}
                  drawingActions={drawingActions}
                  drawingRestoreRevision={drawingActions.restoreRevision}
                  drawingMode={drawingMode}
                  magnetMode={magnetMode}
                  datasetId={dataset}
                  drawingsVisible={drawingsVisible}
                  followCandle={simulationSettings.followCandle}
                  chartViewportRef={chartViewportRef}
                  deleteAllDrawingsRef={deleteAllDrawingsRef}
                  onDrawingComplete={() => setDrawingMode("none")}
                  onNeedEarlierCandles={handleNeedEarlierCandles}
                  onInteractionChange={(active) => { chartInteractionActive.current = active; }}
                />
              ) : (
                <Empty />
              )}
              <div className="symbol">
                <b>{formatMarketPair(activeDataset?.name)}</b>
                <span>{formatTimeframe(tf)} · Historical</span>
              </div>
            </div>
          </div>
          <ReplayControls
            selectingStart={selectingStart}
            playing={playing}
            speed={speed}
            currentCandle={cur}
            timeZone={chartTimeZoneIana}
            replayPosition={replayPosition}
            datasetCandleCount={datasetCandleCount}
            startJumpPending={startJumpPending}
            onMarketOpen={handleMarketOpen}
            activeDatasetId={dataset}
            onHistoryDeleted={() => void refreshCatalog()}
            onStartAction={handleStartAction}
            onReset={reset}
            onPlayingChange={setPlaying}
            onStepBack={stepBack}
            onStep={step}
            onSpeedChange={setSpeed}
          />
        </section>
        {tradePanelOpen ? (
          <TradingSidebar
            currentCandle={cur}
            pricePrecision={pricePrecision}
            baseAsset={baseAsset}
            quoteAsset={quoteAsset}
            accountStats={accountStats}
            orderForm={orderForm}
            workingTrades={workingTrades}
            focusedTradeId={focusedTradeId}
            editingTradeId={tradeEditDraft?.id ?? null}
            onCollapse={() => setTradePanelOpen(false)}
            onBeginOrderDraft={(side) => {
              setFocusedTradeId(null);
              setTradeEditDraft(null);
              const placed = orderForm.beginOrderDraft(side, chartViewportRef.current?.getVisiblePriceRange());
              if (placed) {
                chartViewportRef.current?.ensurePricesVisible([placed.entry, placed.tp, placed.sl]);
              }
            }}
            onCancelOrderDraft={() => {
              setTradeEditDraft(null);
              orderForm.cancelOrderDraft();
            }}
            onPlaceOrder={placeOrder}
            onTradeFocus={setFocusedTradeId}
            onTradeEditStart={startTradeEditing}
            onTradeEditCancel={cancelTradeEditing}
            onTradeEditSave={saveTradeEditing}
            onCancelOrder={cancelOrder}
            onCloseTrade={closeTrade}
          />
        ) : (
          <>
            {!tradePanelTabPinned ? (
              <div
                className="tradePanelTabHotzone"
                aria-hidden="true"
                onMouseEnter={showTradePanelTab}
              />
            ) : null}
            <div className={`tradePanelReopenHost${tradePanelTabPinned || tradePanelTabPeek ? " is-open" : ""}`}>
              <Button
                type="text"
                className={[
                  "tradePanelReopen",
                  tradePanelTabPinned ? "tradePanelReopen--pinned" : "",
                  tradePanelTabPinned || tradePanelTabPeek ? "tradePanelReopen--visible" : "",
                ].filter(Boolean).join(" ")}
                aria-label="Показать панель Trade"
                title="Trade"
                tabIndex={tradePanelTabPinned || tradePanelTabPeek ? 0 : -1}
                aria-hidden={!(tradePanelTabPinned || tradePanelTabPeek)}
                icon={<PanelRightOpen size={18} />}
                onClick={() => setTradePanelOpen(true)}
                onMouseEnter={clearTradePanelTabHideTimer}
                onMouseLeave={scheduleTradePanelTabHide}
              >
                Trade
              </Button>
            </div>
          </>
        )}
      </main>
      <PlayerModals
        settingsOpen={settingsOpen}
        datePickerOpen={datePickerOpen}
        settings={simulationSettings}
        chartTimeZone={chartTimeZoneIana}
        timeframeMinutes={tf}
        account={accountSettings}
        candles={candles}
        replayDateRange={activeDataset ? { from: activeDataset.from, to: activeDataset.to } : undefined}
        onSettingsClose={() => setSettingsOpen(false)}
        onSettingsReset={() => setState((current) => ({
          ...current,
          settings: DEFAULT_SIMULATION_SETTINGS,
          account: DEFAULT_ACCOUNT_SETTINGS,
        }))}
        onSettingChange={updateSimulationSetting}
        onInitialBalanceChange={updateInitialBalance}
        onAmbiguousExitPolicyChange={updateAmbiguousExitPolicy}
        onClosedTradeOverlaysChange={(checked) => setState((current) => ({
          ...current,
          settings: {
            ...DEFAULT_SIMULATION_SETTINGS,
            ...current.settings,
            showClosedTradeOverlays: checked,
          },
        }))}
        onFollowCandleChange={(checked) => setState((current) => ({
          ...current,
          settings: {
            ...DEFAULT_SIMULATION_SETTINGS,
            ...current.settings,
            followCandle: checked,
          },
        }))}
        onTradePanelTabPinnedChange={(checked) => setState((current) => ({
          ...current,
          settings: {
            ...DEFAULT_SIMULATION_SETTINGS,
            ...current.settings,
            tradePanelTabPinned: checked,
          },
        }))}
        onHeaderStatsVariantChange={(value) => setState((current) => ({
          ...current,
          settings: {
            ...DEFAULT_SIMULATION_SETTINGS,
            ...current.settings,
            headerStatsVariant: value,
          },
        }))}
        onDatePickerClose={() => setDatePickerOpen(false)}
        onReplayTimeSelect={selectReplayTimeWithData}
      />
      <JournalDrawer
        open={journal}
        account={accountSettings}
        trades={state.trades}
        datasetOptions={datasetOptions}
        timeZone={chartTimeZoneIana}
        onClose={() => setJournal(false)}
        onCancelOrder={cancelOrder}
        onCloseTrade={closeTrade}
        onDeleteTrade={deleteTrade}
        onDeleteAllTrades={deleteAllTrades}
        onUpdateTradeJournal={updateTradeJournal}
        onJumpToTrade={(trade) => {
          setJournal(false);
          selectReplayTimeWithData(trade.entryTime);
        }}
      />
    </div>
  );
}
