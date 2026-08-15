import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { App as AntApp } from "antd";
import type { Candle, Persisted, SimulationSettings, Trade } from "../../types";
import { formatNumber, formatPrice } from "../../shared/lib/market";
import { advanceSimulation, type SimulationEvent } from "./lib/advanceSimulation";
import { calculateManualClose } from "./lib/calculateTradeResult";
import { createOrder, type CreateOrderError } from "./lib/createOrder";
import type { TradeEditDraft } from "./types";
import type { OrderFormController } from "./useOrderForm";

interface UseTradingSimulationOptions {
  enabled: boolean;
  datasetId: string;
  state: Persisted;
  setState: Dispatch<SetStateAction<Persisted>>;
  rawCandles: Candle[];
  currentCandle?: Candle;
  timeframe: number;
  settings: SimulationSettings;
  pricePrecision: number;
  availableBalance: number;
  orderForm: OrderFormController;
  setFocusedTradeId: Dispatch<SetStateAction<string | null>>;
  setTradeEditDraft: Dispatch<SetStateAction<TradeEditDraft | null>>;
}

const orderErrorMessages: Record<CreateOrderError, string> = {
  "invalid-size": "Проверьте цену и размер заявки",
  "missing-protection": "Укажите Take Profit и Stop Loss",
  "invalid-barriers": "Проверьте расположение TP/SL относительно цены входа",
};

export function useTradingSimulation({
  enabled,
  datasetId,
  state,
  setState,
  rawCandles,
  currentCandle,
  timeframe,
  settings,
  pricePrecision,
  availableBalance,
  orderForm,
  setFocusedTradeId,
  setTradeEditDraft,
}: UseTradingSimulationOptions) {
  const {
    orderType,
    leverage,
    amountUnit,
    orderValue,
    limitPrice,
    protectionEnabled,
    takeProfit,
    stopLoss,
    ticketMargin,
    cancelOrderDraft,
  } = orderForm;
  const { message, notification } = AntApp.useApp();
  const processedTick = useRef<string | null>(null);
  const notifiedTrades = useRef(new Set<string>());
  const workingTrades = useMemo(
    () => state.trades.filter((trade) => trade.status === "OPEN" || trade.status === "PENDING"),
    [state.trades],
  );
  const tickKey = currentCandle
    ? `${datasetId}:${timeframe}:${currentCandle.time}`
    : null;

  const notifyTradeClosed = useCallback((
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
      title: `Сделка закрыта · ${outcome}`,
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
  }, [notification]);

  const publishSimulationEvent = useCallback((event: SimulationEvent) => {
    if (event.type === "order-filled") {
      void message.success(
        `${event.trade.side} limit исполнен по ${formatPrice(event.trade.entry, pricePrecision)}`,
      );
      return;
    }
    notifyTradeClosed(event.trade, event.outcome, event.exit, event.result);
  }, [message, notifyTradeClosed, pricePrecision]);

  useEffect(() => {
    if (!enabled || !currentCandle || !tickKey || processedTick.current === tickKey) return;
    processedTick.current = tickKey;
    const advanced = advanceSimulation({
      state,
      rawCandles,
      candle: currentCandle,
      timeframeMinutes: timeframe,
      settings,
    });
    if (advanced.state !== state) setState(advanced.state);
    advanced.events.forEach(publishSimulationEvent);
  }, [
    currentCandle,
    enabled,
    publishSimulationEvent,
    rawCandles,
    setState,
    settings,
    state,
    tickKey,
    timeframe,
  ]);

  const placeOrder = (side: Trade["side"]) => {
    if (!currentCandle) return;
    if (ticketMargin > availableBalance) {
      void message.warning("Недостаточно свободного баланса для маржи");
      return;
    }
    const created = createOrder({
      id: crypto.randomUUID(),
      datasetId,
      side,
      candle: currentCandle,
      timeframeMinutes: timeframe,
      settings,
      orderType,
      leverage,
      amountUnit,
      orderValue,
      limitPrice,
      protectionEnabled,
      takeProfit,
      stopLoss,
    });
    if (!created.ok) {
      const detail = created.error === "invalid-barriers"
        ? side === "LONG"
          ? "Для LONG: SL ниже цены, TP выше цены"
          : "Для SHORT: SL выше цены, TP ниже цены"
        : orderErrorMessages[created.error];
      void message.warning(detail);
      return;
    }
    setState((current) => ({
      ...current,
      trades: [...current.trades, created.trade],
      annotations: [...current.annotations, created.barrier],
    }));
    cancelOrderDraft();
    setFocusedTradeId(created.trade.id);
    setTradeEditDraft(null);
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
    const close = calculateManualClose(trade, currentCandle.close, settings);
    setState((current) => ({
      ...current,
      trades: current.trades.map((item) => item.id === trade.id ? {
        ...item,
        status: "CLOSED",
        exitTime: currentCandle.time,
        ...close,
        outcome: "MANUAL",
      } : item),
    }));
    notifyTradeClosed(trade, "MANUAL", close.exit, close.result);
  };

  const deleteTrade = (id: string) => {
    setState((current) => ({
      ...current,
      trades: current.trades.filter((trade) => trade.id !== id),
      annotations: current.annotations.filter((barrier) => barrier.id !== id),
    }));
    void message.success("Сделка удалена");
  };

  // Разметка на графике создаётся только вместе со сделкой и живёт под её id,
  // поэтому чистится целиком — осиротевших барьеров остаться не может.
  const deleteAllTrades = () => {
    setState((current) => ({
      ...current,
      trades: [],
      annotations: [],
    }));
    void message.success("Все сделки удалены");
  };

  const updateTradeJournal = (
    id: string,
    patch: { comment?: string; screenshots?: Trade["screenshots"]; tags?: string[] },
  ) => {
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) => trade.id === id ? { ...trade, ...patch } : trade),
    }));
  };

  return { workingTrades, cancelOrder, closeTrade, deleteTrade, deleteAllTrades, placeOrder, updateTradeJournal };
}
