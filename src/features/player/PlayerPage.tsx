import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Empty } from "antd";
import type { Dataset, SimulationSettings } from "../../types";
import type { DrawingMode } from "../../drawing";
import { ReplayChart } from "../chart/ReplayChart";
import { PlayerModals } from "./PlayerModals";
import { ReplayControls } from "../replay/ReplayControls";
import { AppHeader } from "../../widgets/AppHeader";
import { PlayerToolbar } from "../../widgets/PlayerToolbar";
import { TradingSidebar } from "../trading/TradingSidebar";
import { DEFAULT_SIMULATION_SETTINGS } from "../../shared/config/simulation";
import { formatTimeframe, getMarketAssets, inferPricePrecision } from "../../shared/lib/market";
import { usePersistedPlayerState } from "./usePersistedPlayerState";
import { useReplayController } from "../replay/useReplayController";
import { selectDrawingCollections, useDrawingCollections } from "../drawings/useDrawingCollections";
import { useTradeEditing } from "../trading/useTradeEditing";
import { useTradingSimulation } from "../trading/useTradingSimulation";
import { useOrderForm } from "../trading/useOrderForm";
import { useChartDisplayState } from "../chart/useChartDisplayState";

export function PlayerPage() {
  const { message } = AntApp.useApp();
  const chartInteractionActive = useRef(false);
  const { state, setState, initialDatasetId, hydrated } = usePersistedPlayerState();
  const drawingActions = useDrawingCollections(setState);
  const drawings = useMemo(
    () => selectDrawingCollections(state),
    [
      state.fibonacciRetracements,
      state.fibonacciTrendExtensions,
      state.parallelChannels,
      state.rectangles,
      state.trendLines,
    ],
  );
  const [dataset, setDataset] = useState(""),
    [journal, setJournal] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [loadedMarket, setLoadedMarket] = useState<Dataset | null>(null),
    [drawingMode, setDrawingMode] = useState<DrawingMode>("none");
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
    if (initialDatasetId) setDataset((current) => current || initialDatasetId);
  }, [initialDatasetId]);

  const availableDatasets = loadedMarket ? [loadedMarket, ...state.datasets.filter(d => d.id !== loadedMarket.id)] : state.datasets;
  const simulationSettings = useMemo(
    () => ({ ...DEFAULT_SIMULATION_SETTINGS, ...state.settings }),
    [state.settings],
  );
  const activeDataset = availableDatasets.find((d) => d.id === dataset);
  const { baseAsset, quoteAsset } = getMarketAssets(activeDataset?.name);
  const raw = availableDatasets.find((d) => d.id === dataset)?.candles || [];
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
  });
  const orderForm = useOrderForm({ currentCandle: cur, pricePrecision });
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
    blockingTrade,
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
  function updateSimulationSetting(key: Exclude<keyof SimulationSettings, "showClosedTradeOverlays">, value: number | null) {
    setState((current) => ({
      ...current,
      settings: { ...(current.settings ?? DEFAULT_SIMULATION_SETTINGS), [key]: Math.max(0, value ?? 0) },
    }));
  }
  return (
    <div className="app">
      <AppHeader
        tradeCount={state.trades.length}
        onMarketOpen={(market) => {
          setLoadedMarket(market);
          setDataset(market.id);
          setIdx(Math.min(120, market.candles.length - 1));
        }}
        onSettingsOpen={() => setSettingsOpen(true)}
        onJournalOpen={() => setJournal(true)}
      />
      <main>
        <section className="workspace">
          <PlayerToolbar
            datasets={availableDatasets}
            datasetId={dataset}
            timeframe={tf}
            drawingMode={drawingMode}
            onDatasetChange={(nextDataset) => {
              setDataset(nextDataset);
              setIdx(120);
            }}
            onTimeframeChange={changeTimeframe}
            onDrawingModeChange={setDrawingMode}
          />
          <div className="chartWrap">
            {candles.length ? (
              <ReplayChart
                candles={candles}
                index={selectingStart ? lastIndex : replayIndex}
                barriers={chartDisplay.barriers}
                trades={chartDisplay.trades}
                onBarrierChange={moveBarrier}
                selectingStart={selectingStart}
                onStartSelected={selectReplayTime}
                focusRevision={focusRevision}
                pricePrecision={pricePrecision}
                entryMarker={chartDisplay.entryMarker}
                onEntryMarkerChange={moveEntryMarker}
                showClosedTradeOverlays={simulationSettings.showClosedTradeOverlays}
                markersEditable={chartDisplay.markersEditable}
                drawings={drawings}
                drawingActions={drawingActions}
                drawingMode={drawingMode}
                datasetId={dataset}
                onDrawingComplete={() => setDrawingMode("none")}
                onInteractionChange={(active) => { chartInteractionActive.current = active; }}
              />
            ) : (
              <Empty />
            )}
            <div className="symbol">
              <b>{availableDatasets.find((d) => d.id === dataset)?.name}</b>
              <span>{formatTimeframe(tf)} · Historical</span>
            </div>
          </div>
          <ReplayControls
            selectingStart={selectingStart}
            playing={playing}
            speed={speed}
            currentCandle={cur}
            replayIndex={replayIndex}
            candleCount={candles.length}
            onStartAction={handleReplayStartAction}
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
          orderForm={orderForm}
          hasBlockingTrade={blockingTrade != null}
          workingTrades={workingTrades}
          focusedTradeId={focusedTradeId}
          editingTradeId={tradeEditDraft?.id ?? null}
          onProtectionChange={(enabled) => {
            setFocusedTradeId(null);
            setTradeEditDraft(null);
            orderForm.changeProtection(enabled);
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
        candles={candles}
        trades={state.trades}
        onSettingsClose={() => setSettingsOpen(false)}
        onSettingsReset={() => setState((current) => ({ ...current, settings: DEFAULT_SIMULATION_SETTINGS }))}
        onSettingChange={updateSimulationSetting}
        onClosedTradeOverlaysChange={(checked) => setState((current) => ({
          ...current,
          settings: {
            ...DEFAULT_SIMULATION_SETTINGS,
            ...current.settings,
            showClosedTradeOverlays: checked,
          },
        }))}
        onDatePickerClose={() => setDatePickerOpen(false)}
        onReplayTimeSelect={selectReplayTime}
        onJournalClose={() => setJournal(false)}
        onCancelOrder={cancelOrder}
        onCloseTrade={closeTrade}
        onDeleteTrade={deleteTrade}
      />
    </div>
  );
}
