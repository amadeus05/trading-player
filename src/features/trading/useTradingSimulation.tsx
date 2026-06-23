import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { App as AntApp } from "antd";
import type { Barrier, Candle, Persisted, SimulationSettings, Trade } from "../../types";
import { IntrabarExitResolver } from "../../simulation/IntrabarExitResolver";
import { formatNumber, formatPrice } from "../../shared/lib/market";
import type { AmountUnit, OrderType, TradeEditDraft } from "./types";

const intrabarExitResolver = new IntrabarExitResolver();

interface UseTradingSimulationOptions {
  state: Persisted;
  setState: Dispatch<SetStateAction<Persisted>>;
  rawCandles: Candle[];
  currentCandle?: Candle;
  timeframe: number;
  settings: SimulationSettings;
  pricePrecision: number;
  orderType: OrderType;
  leverage: number;
  amountUnit: AmountUnit;
  orderValue: number;
  limitPrice: number;
  protectionEnabled: boolean;
  takeProfit: number;
  stopLoss: number;
  setProtectionEnabled: Dispatch<SetStateAction<boolean>>;
  setTakeProfit: Dispatch<SetStateAction<number>>;
  setStopLoss: Dispatch<SetStateAction<number>>;
  setFocusedTradeId: Dispatch<SetStateAction<string | null>>;
  setTradeEditDraft: Dispatch<SetStateAction<TradeEditDraft | null>>;
}

export function useTradingSimulation({
  state,
  setState,
  rawCandles,
  currentCandle,
  timeframe,
  settings,
  pricePrecision,
  orderType,
  leverage,
  amountUnit,
  orderValue,
  limitPrice,
  protectionEnabled,
  takeProfit,
  stopLoss,
  setProtectionEnabled,
  setTakeProfit,
  setStopLoss,
  setFocusedTradeId,
  setTradeEditDraft,
}: UseTradingSimulationOptions) {
  const { message, notification } = AntApp.useApp();
  const notifiedTrades = useRef(new Set<string>());
  const workingTrades = state.trades.filter(
    (trade) => trade.status === "OPEN" || trade.status === "PENDING",
  );
  const blockingTrade = workingTrades.at(-1);

  const notifyTradeClosed = (
    trade: Trade,
    outcome: NonNullable<Trade["outcome"]>,
    exit: number,
    result: number,
  ) => {
    if (notifiedTrades.current.has(trade.id)) return;
    notifiedTrades.current.add(trade.id);
    const profitable = result >= 0;
    notification.open({
      placement: "topRight",
      type: profitable ? "success" : "error",
      message: `Сделка закрыта · ${outcome}`,
      description: (
        <div className="close-notification">
          <b>{trade.side}</b>
          <span>{formatNumber(trade.entry)} → {formatNumber(exit)}</span>
          <strong className={profitable ? "pos" : "neg"}>
            P&amp;L {result >= 0 ? "+" : ""}{formatNumber(result)}
          </strong>
        </div>
      ),
      duration: 5,
    });
  };

  useEffect(() => {
    if (!currentCandle) return;
    const filled = state.trades.filter((trade) =>
      trade.status === "PENDING"
      && (trade.createdTime ?? trade.entryTime) < currentCandle.time
      && currentCandle.low <= trade.entry
      && currentCandle.high >= trade.entry,
    );
    if (!filled.length) return;
    const ids = new Set(filled.map((trade) => trade.id));
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) => ids.has(trade.id)
        ? { ...trade, status: "OPEN", entryTime: currentCandle.time }
        : trade),
      annotations: current.annotations.map((barrier) => ids.has(barrier.id)
        ? { ...barrier, entryTime: currentCandle.time }
        : barrier),
    }));
    filled.forEach((trade) => {
      void message.success(`${trade.side} limit исполнен по ${formatPrice(trade.entry, pricePrecision)}`);
    });
  }, [currentCandle?.time]);

  useEffect(() => {
    if (!currentCandle) return;
    const closures = state.trades.flatMap((trade) => {
      if (trade.status !== "OPEN" || trade.entryTime >= currentCandle.time) return [];
      const intrabar = intrabarExitResolver.resolve(
        rawCandles,
        currentCandle.time,
        timeframe * 60,
        trade,
      );
      let outcome: "TP" | "SL";
      let exitTime: number;
      if (intrabar.kind === "resolved") {
        outcome = intrabar.outcome;
        exitTime = intrabar.candleTime;
      } else if (intrabar.kind === "not-hit") {
        return [];
      } else {
        const slHit = trade.side === "LONG"
          ? currentCandle.low <= trade.sl
          : currentCandle.high >= trade.sl;
        const tpHit = trade.side === "LONG"
          ? currentCandle.high >= trade.tp
          : currentCandle.low <= trade.tp;
        if (!slHit && !tpHit) return [];
        outcome = slHit ? "SL" : "TP";
        exitTime = currentCandle.time;
      }
      const slHit = outcome === "SL";
      const rawExit = slHit ? trade.sl : trade.tp;
      const stopSlip = (trade.stopSlippagePct ?? settings.stopSlippagePct) / 100;
      const exit = slHit
        ? rawExit * (trade.side === "LONG" ? 1 - stopSlip : 1 + stopSlip)
        : rawExit;
      const grossResult = (trade.side === "LONG"
        ? exit - trade.entry
        : trade.entry - exit) * trade.size;
      const exitFeePct = outcome === "TP"
        ? trade.makerFeePct ?? settings.makerFeePct
        : trade.takerFeePct ?? settings.takerFeePct;
      const exitFee = exit * trade.size * exitFeePct / 100;
      const fees = (trade.entryFee ?? 0) + exitFee;
      return [{ trade, outcome, exitTime, exit, grossResult, fees, result: grossResult - fees }];
    });
    if (!closures.length) return;
    const byId = new Map(closures.map((closure) => [closure.trade.id, closure]));
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) => {
        const closed = byId.get(trade.id);
        return closed ? {
          ...trade,
          status: "CLOSED",
          exitTime: closed.exitTime,
          exit: closed.exit,
          grossResult: closed.grossResult,
          fees: closed.fees,
          result: closed.result,
          outcome: closed.outcome,
        } : trade;
      }),
    }));
    closures.forEach(({ trade, outcome, exit, result }) => {
      notifyTradeClosed(trade, outcome, exit, result);
    });
  }, [currentCandle?.time]);

  const placeOrder = (side: Trade["side"]) => {
    if (!currentCandle) return;
    if (blockingTrade) {
      void message.warning("Сначала закройте позицию или отмените лимитную заявку");
      return;
    }
    const requestedEntry = orderType === "MARKET"
      ? currentCandle.close
      : limitPrice || currentCandle.close;
    const entrySlip = settings.slippagePct / 100;
    const entry = orderType === "MARKET"
      ? requestedEntry * (side === "LONG" ? 1 + entrySlip : 1 - entrySlip)
      : requestedEntry;
    if (!Number.isFinite(entry) || entry <= 0 || orderValue <= 0) {
      void message.warning("Проверьте цену и размер заявки");
      return;
    }
    const size = amountUnit === "USDT" ? orderValue / entry : orderValue;
    const entryFeePct = orderType === "MARKET" ? settings.takerFeePct : settings.makerFeePct;
    const entryFee = entry * size * entryFeePct / 100;
    if (!protectionEnabled || stopLoss <= 0 || takeProfit <= 0) {
      void message.warning("Включите TP/SL и укажите обе цены");
      return;
    }
    const invalidBarriers = side === "LONG"
      ? stopLoss >= entry || takeProfit <= entry
      : stopLoss <= entry || takeProfit >= entry;
    if (invalidBarriers) {
      void message.warning(side === "LONG"
        ? "Для LONG: SL ниже цены, TP выше цены"
        : "Для SHORT: SL выше цены, TP ниже цены");
      return;
    }
    const trade: Trade = {
      id: crypto.randomUUID(),
      side,
      entryTime: currentCandle.time,
      createdTime: currentCandle.time,
      entry,
      size,
      sl: stopLoss,
      tp: takeProfit,
      status: orderType === "MARKET" ? "OPEN" : "PENDING",
      orderType,
      leverage,
      inputUnit: amountUnit,
      inputValue: orderValue,
      entryFee,
      makerFeePct: settings.makerFeePct,
      takerFeePct: settings.takerFeePct,
      slippagePct: settings.slippagePct,
      stopSlippagePct: settings.stopSlippagePct,
      comment: "",
    };
    const barrier: Barrier = {
      id: trade.id,
      entryTime: currentCandle.time,
      upper: side === "LONG" ? takeProfit : stopLoss,
      lower: side === "LONG" ? stopLoss : takeProfit,
      timeLimit: currentCandle.time + timeframe * 60 * 24,
    };
    setState((current) => ({
      ...current,
      trades: [...current.trades, trade],
      annotations: [...current.annotations, barrier],
    }));
    setProtectionEnabled(false);
    setFocusedTradeId(trade.id);
    setTradeEditDraft(null);
    setTakeProfit(0);
    setStopLoss(0);
    void message.success(orderType === "MARKET" ? `${side} открыт` : `${side} limit размещён`);
  };

  const cancelOrder = (id: string) => {
    setState((current) => ({
      ...current,
      trades: current.trades.filter((trade) => trade.id !== id),
      annotations: current.annotations.filter((barrier) => barrier.id !== id),
    }));
    void message.info("Лимитная заявка отменена");
  };

  const closeTrade = (trade: Trade) => {
    if (trade.status === "PENDING") {
      cancelOrder(trade.id);
      return;
    }
    if (!currentCandle) return;
    const slippage = (trade.slippagePct ?? settings.slippagePct) / 100;
    const exit = currentCandle.close * (trade.side === "LONG" ? 1 - slippage : 1 + slippage);
    const grossResult = (trade.side === "LONG" ? exit - trade.entry : trade.entry - exit) * trade.size;
    const exitFee = exit * trade.size * (trade.takerFeePct ?? settings.takerFeePct) / 100;
    const fees = (trade.entryFee ?? 0) + exitFee;
    const result = grossResult - fees;
    setState((current) => ({
      ...current,
      trades: current.trades.map((item) => item.id === trade.id ? {
        ...item,
        status: "CLOSED",
        exitTime: currentCandle.time,
        exit,
        grossResult,
        fees,
        result,
        outcome: "MANUAL",
      } : item),
    }));
    notifyTradeClosed(trade, "MANUAL", exit, result);
  };

  const deleteTrade = (id: string) => {
    setState((current) => ({
      ...current,
      trades: current.trades.filter((trade) => trade.id !== id),
      annotations: current.annotations.filter((barrier) => barrier.id !== id),
    }));
    void message.success("Сделка удалена");
  };

  return { blockingTrade, workingTrades, cancelOrder, closeTrade, deleteTrade, placeOrder };
}
