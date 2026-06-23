import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Empty } from "antd";
import type { Barrier, Dataset, SimulationSettings, Trade } from "../../types";
import type { DrawingMode } from "../../drawing";
import { ReplayChart } from "../chart/ReplayChart";
import { PlayerModals } from "./PlayerModals";
import { ReplayControls } from "../replay/ReplayControls";
import { AppHeader } from "../../widgets/AppHeader";
import { PlayerToolbar } from "../../widgets/PlayerToolbar";
import { TradingSidebar } from "../trading/TradingSidebar";
import type { AmountUnit, OrderType } from "../trading/types";
import { parseCandleCsv } from "../datasets/parseCandleCsv";
import { DEFAULT_SIMULATION_SETTINGS, NO_BARRIERS, PAPER_BALANCE_USDT } from "../../shared/config/simulation";
import { formatTimeframe, getMarketAssets, inferPricePrecision } from "../../shared/lib/market";
import { usePersistedPlayerState } from "./usePersistedPlayerState";
import { useReplayController } from "../replay/useReplayController";
import { useDrawingCollections } from "../drawings/useDrawingCollections";
import { useTradeEditing } from "../trading/useTradeEditing";
import { useTradingSimulation } from "../trading/useTradingSimulation";

export function PlayerPage() {
  const { message } = AntApp.useApp();
  const chartInteractionActive = useRef(false);
  const { state, setState, initialDatasetId } = usePersistedPlayerState();
  const {
    handleFibonacciCreate,
    handleFibonacciDelete,
    handleFibonacciTrendExtensionCreate,
    handleFibonacciTrendExtensionDelete,
    handleFibonacciTrendExtensionUpdate,
    handleFibonacciUpdate,
    handleParallelChannelCreate,
    handleParallelChannelDelete,
    handleParallelChannelUpdate,
    handleRectangleCreate,
    handleRectangleDelete,
    handleRectangleUpdate,
    handleTrendLineCreate,
    handleTrendLineDelete,
    handleTrendLineUpdate,
  } = useDrawingCollections(setState);
  const [dataset, setDataset] = useState(""),
    [journal, setJournal] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [loadedMarket, setLoadedMarket] = useState<Dataset | null>(null),
    [orderType, setOrderType] = useState<OrderType>("MARKET"),
    [leverage, setLeverage] = useState(10),
    [amountUnit, setAmountUnit] = useState<AmountUnit>("USDT"),
    [orderValue, setOrderValue] = useState(100),
    [allocationPercent, setAllocationPercent] = useState(1),
    [limitPrice, setLimitPrice] = useState(0),
    [protectionEnabled, setProtectionEnabled] = useState(false),
    [limitTakeProfit, setLimitTakeProfit] = useState(0),
    [limitStopLoss, setLimitStopLoss] = useState(0),
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
  const simulationSettings = { ...DEFAULT_SIMULATION_SETTINGS, ...state.settings };
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
    onDraftTakeProfitChange: setLimitTakeProfit,
    onDraftStopLossChange: setLimitStopLoss,
    onDraftLimitPriceChange: setLimitPrice,
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
    state,
    setState,
    rawCandles: raw,
    currentCandle: cur,
    timeframe: tf,
    settings: simulationSettings,
    pricePrecision,
    orderType,
    leverage,
    amountUnit,
    orderValue,
    limitPrice,
    protectionEnabled,
    takeProfit: limitTakeProfit,
    stopLoss: limitStopLoss,
    setProtectionEnabled,
    setTakeProfit: setLimitTakeProfit,
    setStopLoss: setLimitStopLoss,
    setFocusedTradeId,
    setTradeEditDraft,
  });

  const focusedTrade = workingTrades.find((trade) => trade.id === focusedTradeId);
  const chartTrade = focusedTrade && tradeEditDraft?.id === focusedTrade.id
    ? { ...focusedTrade, entry: tradeEditDraft.entry, tp: tradeEditDraft.tp, sl: tradeEditDraft.sl }
    : focusedTrade;
  const activeBarriers = useMemo(() => chartTrade
    ? state.annotations.filter(
      (b) => b.id === chartTrade.id && b.entryTime <= (cur?.time || 0),
    )
    : NO_BARRIERS, [chartTrade?.id, state.annotations, cur?.time]);
  function importCsv(file: File) {
    void parseCandleCsv(file)
      .then((parsedCandles) => {
        if (!parsedCandles.length) {
          message.error("Не найдены колонки time, open, high, low, close");
          return;
        }
        const id = crypto.randomUUID();
        setState((current) => ({
          ...current,
          datasets: [...current.datasets, { id, name: file.name, candles: parsedCandles }],
        }));
        setDataset(id);
        setIdx(Math.min(120, parsedCandles.length - 1));
        message.success(`Загружено ${parsedCandles.length} свечей`);
      })
      .catch(() => message.error("Не удалось прочитать CSV"));
    return false;
  }
  const ticketPrice = orderType === "MARKET" ? (cur?.close ?? 0) : (limitPrice || cur?.close || 0);
  const ticketQuantity = ticketPrice > 0 ? (amountUnit === "USDT" ? orderValue / ticketPrice : orderValue) : 0;
  const ticketNotional = ticketQuantity * ticketPrice;
  const ticketMargin = ticketNotional / leverage;
  const longLiquidation = ticketPrice > 0 && leverage > 1 ? ticketPrice * (1 - 1 / leverage) : null;
  const shortLiquidation = ticketPrice > 0 && leverage > 1 ? ticketPrice * (1 + 1 / leverage) : null;

  function changeOrderType(nextOrderType: OrderType) {
    setOrderType(nextOrderType);
    if (nextOrderType === "LIMIT" && cur) setLimitPrice(cur.close);
  }

  function changeProtection(enabled: boolean) {
    setFocusedTradeId(null);
    setTradeEditDraft(null);
    setProtectionEnabled(enabled);
    if (!enabled || !cur?.close) return;
    const currentPrice = cur.close;
    if (orderType === "LIMIT") setLimitPrice(Number(currentPrice.toFixed(pricePrecision)));
    setLimitTakeProfit(Number((currentPrice * 1.01).toFixed(pricePrecision)));
    setLimitStopLoss(Number((currentPrice * 0.99).toFixed(pricePrecision)));
  }

  function changeOrderValue(nextValue: number) {
    setOrderValue(nextValue);
    const notional = amountUnit === "USDT" ? nextValue : nextValue * ticketPrice;
    setAllocationPercent(Math.min(100, notional / leverage / PAPER_BALANCE_USDT * 100));
  }

  function changeAmountUnit(nextUnit: AmountUnit) {
    setOrderValue(nextUnit === "USDT" ? ticketNotional : ticketQuantity);
    setAmountUnit(nextUnit);
  }

  function changeAllocation(percent: number) {
    setAllocationPercent(percent);
    const notional = PAPER_BALANCE_USDT * (percent / 100) * leverage;
    setOrderValue(amountUnit === "USDT" ? notional : ticketPrice ? notional / ticketPrice : 0);
  }

  const draftProtectionTrade: Trade | undefined = protectionEnabled && ticketPrice > 0 && limitTakeProfit > 0 && limitStopLoss > 0 ? {
    id: "__draft_protection__", side: "LONG", entryTime: cur?.time ?? 0, entry: ticketPrice,
    size: 0, sl: limitStopLoss, tp: limitTakeProfit, status: "OPEN", comment: "",
  } : undefined;
  const displayedChartTrade = chartTrade ?? draftProtectionTrade;
  const markersEditable = displayedChartTrade?.id === "__draft_protection__" || tradeEditDraft?.id === displayedChartTrade?.id;
  const chartTrades = displayedChartTrade?.id === "__draft_protection__"
    ? [...state.trades, displayedChartTrade]
    : tradeEditDraft && chartTrade
      ? state.trades.map((trade) => trade.id === chartTrade.id ? chartTrade : trade)
      : state.trades;
  const displayedBarriers: Barrier[] = chartTrade ? activeBarriers : draftProtectionTrade ? [{
    id: draftProtectionTrade.id, entryTime: cur?.time ?? 0,
    upper: draftProtectionTrade.tp, lower: draftProtectionTrade.sl,
    timeLimit: Number.MAX_SAFE_INTEGER,
  }] : NO_BARRIERS;
  const displayedEntryMarker = chartTrade?.status === "PENDING"
    ? { id: chartTrade.id, price: chartTrade.entry }
    : protectionEnabled && orderType === "LIMIT" && ticketPrice > 0
      ? { id: "__draft_limit_entry__", price: ticketPrice }
      : undefined;
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
            onCsvImport={importCsv}
          />
          <div className="chartWrap">
            {candles.length ? (
              <ReplayChart
                candles={candles}
                index={selectingStart ? lastIndex : replayIndex}
                barriers={displayedBarriers}
                trades={chartTrades}
                onBarrierChange={moveBarrier}
                selectingStart={selectingStart}
                onStartSelected={selectReplayTime}
                focusRevision={focusRevision}
                pricePrecision={pricePrecision}
                entryMarker={displayedEntryMarker}
                onEntryMarkerChange={moveEntryMarker}
                showClosedTradeOverlays={simulationSettings.showClosedTradeOverlays}
                markersEditable={markersEditable}
                trendLines={state.trendLines ?? []}
                drawingMode={drawingMode}
                datasetId={dataset}
                onTrendLineCreate={handleTrendLineCreate}
                onTrendLineUpdate={handleTrendLineUpdate}
                onTrendLineDelete={handleTrendLineDelete}
                rectangles={state.rectangles ?? []}
                onRectangleCreate={handleRectangleCreate}
                onRectangleUpdate={handleRectangleUpdate}
                onRectangleDelete={handleRectangleDelete}
                fibonacciRetracements={state.fibonacciRetracements ?? []}
                onFibonacciCreate={handleFibonacciCreate}
                onFibonacciUpdate={handleFibonacciUpdate}
                onFibonacciDelete={handleFibonacciDelete}
                fibonacciTrendExtensions={state.fibonacciTrendExtensions ?? []}
                onFibonacciTrendExtensionCreate={handleFibonacciTrendExtensionCreate}
                onFibonacciTrendExtensionUpdate={handleFibonacciTrendExtensionUpdate}
                onFibonacciTrendExtensionDelete={handleFibonacciTrendExtensionDelete}
                parallelChannels={state.parallelChannels ?? []}
                onParallelChannelCreate={handleParallelChannelCreate}
                onParallelChannelUpdate={handleParallelChannelUpdate}
                onParallelChannelDelete={handleParallelChannelDelete}
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
          orderType={orderType}
          leverage={leverage}
          amountUnit={amountUnit}
          orderValue={orderValue}
          allocationPercent={allocationPercent}
          limitPrice={limitPrice}
          protectionEnabled={protectionEnabled}
          takeProfit={limitTakeProfit}
          stopLoss={limitStopLoss}
          ticketQuantity={ticketQuantity}
          ticketMargin={ticketMargin}
          longLiquidation={longLiquidation}
          shortLiquidation={shortLiquidation}
          hasBlockingTrade={blockingTrade != null}
          workingTrades={workingTrades}
          focusedTradeId={focusedTradeId}
          editingTradeId={tradeEditDraft?.id ?? null}
          onOrderTypeChange={changeOrderType}
          onLeverageChange={setLeverage}
          onAmountUnitChange={changeAmountUnit}
          onOrderValueChange={changeOrderValue}
          onAllocationChange={changeAllocation}
          onLimitPriceChange={setLimitPrice}
          onProtectionChange={changeProtection}
          onTakeProfitChange={setLimitTakeProfit}
          onStopLossChange={setLimitStopLoss}
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
