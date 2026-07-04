import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Empty } from "antd";
import type { AmbiguousExitPolicy, Candle, Dataset, SimulationSettings } from "../../types";
import type { DrawingMode } from "../../drawing";
import { ReplayChart, type ChartViewportRef } from "../chart/ReplayChart";
import { PlayerModals } from "./PlayerModals";
import { ReplayControls } from "../replay/ReplayControls";
import { AppHeader } from "../../widgets/AppHeader";
import { PlayerToolbar } from "../../widgets/PlayerToolbar";
import { DrawingToolsRail } from "../../widgets/DrawingToolsRail";
import { TradingSidebar } from "../trading/TradingSidebar";
import { DEFAULT_ACCOUNT_SETTINGS, DEFAULT_SIMULATION_SETTINGS } from "../../shared/config/simulation";
import { formatMarketPair, formatTimeframe, getMarketAssets, inferPricePrecision } from "../../shared/lib/market";
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
import { useActiveMarketCandles } from "../datasets/useActiveMarketCandles";
import { prefetchMarketCandleThresholdForTimeframe, shouldPrefetchMarketCandles } from "../datasets/marketCandleRanges";

export function PlayerPage() {
  const { message } = AntApp.useApp();
  const chartInteractionActive = useRef(false);
  const deleteAllDrawingsRef = useRef<(() => void) | null>(null);
  const chartViewportRef = useRef<ChartViewportRef | null>(null);
  const candleCacheRef = useRef<Map<string, Candle[]>>(new Map());
  const { appRef, chartFullscreenActive, toggleChartFullscreen } = useChartFullscreen();
  const { state, setState, initialDatasetId, initialTimeframe, hydrated } = usePersistedPlayerState();
  const { catalog, datasetOptions, ready: catalogReady, refresh: refreshCatalog } = useMarketCatalog();
  const drawingActions = useDrawingCollections(setState);
  const drawings = useMemo(
    () => selectDrawingCollections(state),
    [
      state.fibonacciRetracements,
      state.fibonacciTrendExtensions,
      state.parallelChannels,
      state.rectangles,
      state.trendLines,
      state.volumeProfiles,
    ],
  );
  const [dataset, setDataset] = useState(""),
    [journal, setJournal] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [drawingMode, setDrawingMode] = useState<DrawingMode>("none"),
    [drawingsVisible, setDrawingsVisible] = useState(true);
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
  const accountSettings = useMemo(
    () => ({ ...DEFAULT_ACCOUNT_SETTINGS, ...state.account }),
    [state.account],
  );
  const { baseAsset, quoteAsset } = getMarketAssets(activeDataset?.name);
  const {
    candles: raw,
    loading: candlesLoading,
    loadingMore: candlesLoadingMore,
    hasMore: hasMoreCandles,
    loadMore: loadMoreCandles,
    loadAroundTime: loadCandlesAroundTime,
  } = useActiveMarketCandles(
    dataset,
    catalog,
    candleCacheRef,
    initialTimeframe,
  );
  const pricePrecision = useMemo(() => inferPricePrecision(raw), [raw]);
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
    handleStartAction: handleReplayStartAction,
    reset,
    selectTime: selectReplayTime,
    setDatePickerOpen,
    setIndex: setIdx,
    setPlaying,
    setSpeed,
    step,
  } = useReplayController({
    rawCandles: raw,
    interactionActiveRef: chartInteractionActive,
    initialTimeframe,
  });
  const [pendingReplayTime, setPendingReplayTime] = useState<number | null>(null);
  const [pendingTimeframeChange, setPendingTimeframeChange] = useState<{
    timeframe: number;
    replayTime: number;
  } | null>(null);
  useEffect(() => {
    if (!hasMoreCandles || candlesLoadingMore) return;
    if (!shouldPrefetchMarketCandles(raw, cur?.time, prefetchMarketCandleThresholdForTimeframe(tf))) return;
    void loadMoreCandles();
  }, [candlesLoadingMore, cur?.time, hasMoreCandles, loadMoreCandles, raw, tf]);
  useEffect(() => {
    if (pendingReplayTime == null || !raw.length) return;
    const last = raw.at(-1)!.time;
    if (pendingReplayTime > last) return;
    selectReplayTime(pendingReplayTime);
    setPendingReplayTime(null);
  }, [pendingReplayTime, raw, selectReplayTime]);
  useEffect(() => {
    if (!pendingTimeframeChange || !raw.length) return;
    const last = raw.at(-1)!.time;
    if (pendingTimeframeChange.replayTime > last) return;
    changeTimeframe(pendingTimeframeChange.timeframe, pendingTimeframeChange.replayTime);
    setState((current) => ({
      ...current,
      timeframeMinutes: pendingTimeframeChange.timeframe,
    }));
    setPendingTimeframeChange(null);
  }, [changeTimeframe, pendingTimeframeChange, raw, setState]);
  const selectReplayTimeWithData = useCallback((time: number, timeframeMinutes = tf) => {
    setPlaying(false);
    setPendingReplayTime(time);
    void loadCandlesAroundTime(time, timeframeMinutes).then((loaded) => {
      if (!loaded) setPendingReplayTime(null);
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
  const orderForm = useOrderForm({
    currentCandle: cur,
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
    placeOrder,
  } = useTradingSimulation({
    enabled: hydrated,
    datasetId: dataset,
    state,
    setState,
    rawCandles: raw,
    currentCandle: cur,
    timeframe: tf,
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
  });
  function updateSimulationSetting(
    key: Exclude<keyof SimulationSettings, "showClosedTradeOverlays" | "ambiguousExitPolicy">,
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
    const replayTime = cur?.time;
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
  }, [changeTimeframe, cur?.time, loadCandlesAroundTime, setPlaying, setState]);
  const handleMarketOpen = useCallback((market: Dataset) => {
    candleCacheRef.current.set(market.id, market.candles);
    void refreshCatalog();
    setDataset(market.id);
    setState((current) => ({ ...current, lastDatasetId: market.id }));
    setIdx(Math.min(120, market.candles.length - 1));
  }, [refreshCatalog, setIdx, setState]);
  return (
    <div className="app" ref={appRef}>
      <AppHeader
        tradeCount={state.trades.length}
        quoteAsset={quoteAsset}
        accountStats={accountStats}
        onSettingsOpen={() => setSettingsOpen(true)}
        onJournalOpen={() => setJournal(true)}
      />
      <main>
        <section className="workspace">
          <PlayerToolbar
            datasetOptions={datasetOptions}
            datasetId={dataset}
            datasetsLoading={!catalogReady || candlesLoading}
            timeframe={tf}
            onDatasetChange={(nextDataset) => {
              setDataset(nextDataset);
              setState((current) => ({ ...current, lastDatasetId: nextDataset }));
              setIdx(120);
            }}
            onTimeframeChange={handleTimeframeChange}
            chartFullscreenActive={chartFullscreenActive}
            onToggleChartFullscreen={toggleChartFullscreen}
          />
          <div className="chartArea">
            <DrawingToolsRail
              drawingMode={drawingMode}
              drawingsVisible={drawingsVisible}
              drawingCount={drawingCount}
              canUndoDrawings={drawingActions.canUndo}
              canRedoDrawings={drawingActions.canRedo}
              onDrawingModeChange={setDrawingMode}
              onDrawingsVisibleChange={setDrawingsVisible}
              onUndoDrawings={drawingActions.undo}
              onRedoDrawings={drawingActions.redo}
              onDeleteAllDrawings={() => deleteAllDrawingsRef.current?.()}
            />
            <div className="chartWrap">
              {candles.length ? (
                <ReplayChart
                  candles={candles}
                  rawCandles={raw}
                  index={replayIndex}
                  barriers={chartDisplay.barriers}
                  trades={chartDisplay.trades}
                  onBarrierChange={moveBarrier}
                  selectingStart={selectingStart}
                  onStartSelected={selectReplayTimeWithData}
                  focusRevision={focusRevision}
                  pricePrecision={pricePrecision}
                  entryMarker={chartDisplay.entryMarker}
                  onEntryMarkerChange={moveEntryMarker}
                  showClosedTradeOverlays={simulationSettings.showClosedTradeOverlays}
                  markersEditable={chartDisplay.markersEditable}
                  drawings={drawings}
                  drawingActions={drawingActions}
                  drawingRestoreRevision={drawingActions.restoreRevision}
                  drawingMode={drawingMode}
                  datasetId={dataset}
                  drawingsVisible={drawingsVisible}
                  followCandle={simulationSettings.followCandle}
                  chartViewportRef={chartViewportRef}
                  deleteAllDrawingsRef={deleteAllDrawingsRef}
                  onDrawingComplete={() => setDrawingMode("none")}
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
            replayIndex={replayIndex}
            candleCount={candles.length}
            onMarketOpen={handleMarketOpen}
            onStartAction={handleStartAction}
            onReset={reset}
            onPlayingChange={setPlaying}
            onStep={step}
            onSpeedChange={setSpeed}
          />
        </section>
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
          onBeginOrderDraft={(side) => {
            setFocusedTradeId(null);
            setTradeEditDraft(null);
            orderForm.beginOrderDraft(side, chartViewportRef.current?.getVisiblePriceRange());
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
      </main>
      <PlayerModals
        settingsOpen={settingsOpen}
        datePickerOpen={datePickerOpen}
        journalOpen={journal}
        settings={simulationSettings}
        account={accountSettings}
        candles={candles}
        replayDateRange={activeDataset ? { from: activeDataset.from, to: activeDataset.to } : undefined}
        trades={state.trades}
        datasetOptions={datasetOptions}
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
        onDatePickerClose={() => setDatePickerOpen(false)}
        onReplayTimeSelect={selectReplayTimeWithData}
        onJournalClose={() => setJournal(false)}
        onCancelOrder={cancelOrder}
        onCloseTrade={closeTrade}
        onDeleteTrade={deleteTrade}
      />
    </div>
  );
}
