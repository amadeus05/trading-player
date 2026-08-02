import { useMemo } from "react";
import type { Barrier, Candle, Persisted, Trade } from "../../types";
import { NO_BARRIERS } from "../../shared/config/simulation";
import type { OrderFormController } from "../trading/useOrderForm";
import type { TradeEditDraft } from "../trading/types";

interface UseChartDisplayStateOptions {
  trades: Trade[];
  annotations: Persisted["annotations"];
  workingTrades: Trade[];
  focusedTradeId: string | null;
  tradeEditDraft: TradeEditDraft | null;
  currentCandle?: Candle;
  orderForm: OrderFormController;
  /** Комиссии нужны черновику, чтобы метки TP/SL показывали сумму «в чистоте». */
  makerFeePct: number;
  takerFeePct: number;
}

export interface ChartDisplayState {
  trades: Trade[];
  barriers: Barrier[];
  entryMarker?: { id: string; price: number };
  markersEditable: boolean;
}

export function useChartDisplayState({
  trades,
  annotations,
  workingTrades,
  focusedTradeId,
  tradeEditDraft,
  currentCandle,
  orderForm,
  makerFeePct,
  takerFeePct,
}: UseChartDisplayStateOptions): ChartDisplayState {
  const {
    limitPrice,
    orderType,
    orderDraftSide,
    protectionEnabled,
    stopLoss,
    takeProfit,
    ticketPrice,
    ticketQuantity,
  } = orderForm;

  return useMemo(() => {
    const currentTime = currentCandle?.time ?? 0;
    const replayVisibleTrades = trades.filter((trade) => {
      if (trade.status !== "CLOSED" || trade.exitTime == null) return true;
      return trade.entryTime <= currentTime && trade.exitTime <= currentTime;
    });
    const focusedTrade = workingTrades.find((trade) => trade.id === focusedTradeId);
    const editedTrade = focusedTrade && tradeEditDraft?.id === focusedTrade.id
      ? {
          ...focusedTrade,
          entry: tradeEditDraft.entry,
          tp: tradeEditDraft.tp,
          sl: tradeEditDraft.sl,
        }
      : focusedTrade;
    const activeBarriers = editedTrade
      ? annotations.filter(
          (barrier) => barrier.id === editedTrade.id
            && barrier.entryTime <= (currentCandle?.time ?? 0),
        )
      : NO_BARRIERS;
    const draftProtectionTrade: Trade | undefined = orderDraftSide
      && ticketPrice > 0
      && takeProfit > 0
      && stopLoss > 0
      ? {
          id: "__draft_protection__",
          side: orderDraftSide,
          entryTime: currentCandle?.time ?? 0,
          entry: ticketPrice,
          // Настоящий размер тикета, а не заглушка: из него метки TP/SL считают
          // сумму прибыли и убытка ещё до того, как заявка выставлена.
          size: ticketQuantity,
          makerFeePct,
          takerFeePct,
          sl: stopLoss,
          tp: takeProfit,
          status: "OPEN",
          comment: "",
        }
      : undefined;
    const displayedTrade = (tradeEditDraft && editedTrade)
      ? editedTrade
      : draftProtectionTrade;
    const displayedTrades = displayedTrade?.id === "__draft_protection__"
      ? [...replayVisibleTrades, displayedTrade]
      : tradeEditDraft && editedTrade
        ? replayVisibleTrades.map((trade) => trade.id === editedTrade.id ? editedTrade : trade)
        : replayVisibleTrades;
    const focusedBarrierFromAnnotations = !tradeEditDraft && focusedTrade
      ? annotations.find(
          (barrier) => barrier.id === focusedTrade.id
            && barrier.entryTime <= (currentCandle?.time ?? 0),
        )
      : undefined;
    const staticFocusBarrier: Barrier | undefined = !focusedBarrierFromAnnotations
      && !tradeEditDraft
      && focusedTrade
      && (focusedTrade.tp > 0 || focusedTrade.sl > 0)
      ? {
          id: focusedTrade.id,
          entryTime: focusedTrade.entryTime,
          upper: focusedTrade.side === "LONG" ? focusedTrade.tp : focusedTrade.sl,
          lower: focusedTrade.side === "LONG" ? focusedTrade.sl : focusedTrade.tp,
          timeLimit: Number.MAX_SAFE_INTEGER,
        }
      : undefined;
    const focusBarrier = focusedBarrierFromAnnotations ?? staticFocusBarrier;
    const barriers: Barrier[] = tradeEditDraft && editedTrade
      ? activeBarriers
      : draftProtectionTrade
        ? [{
            id: draftProtectionTrade.id,
            entryTime: currentCandle?.time ?? 0,
            upper: draftProtectionTrade.side === "LONG" ? draftProtectionTrade.tp : draftProtectionTrade.sl,
            lower: draftProtectionTrade.side === "LONG" ? draftProtectionTrade.sl : draftProtectionTrade.tp,
            timeLimit: Number.MAX_SAFE_INTEGER,
          }]
        : focusBarrier
          ? [focusBarrier]
          : NO_BARRIERS;
    const entryMarker = editedTrade?.status === "PENDING" && tradeEditDraft?.id === editedTrade.id
      ? { id: editedTrade.id, price: editedTrade.entry }
      : protectionEnabled && orderType === "LIMIT" && ticketPrice > 0
        ? { id: "__draft_limit_entry__", price: limitPrice || ticketPrice }
        : undefined;
    return {
      trades: displayedTrades,
      barriers,
      entryMarker,
      markersEditable: displayedTrade?.id === "__draft_protection__"
        || tradeEditDraft?.id === displayedTrade?.id,
    };
  }, [
    annotations,
    currentCandle?.time,
    focusedTradeId,
    limitPrice,
    orderType,
    orderDraftSide,
    protectionEnabled,
    stopLoss,
    takeProfit,
    ticketPrice,
    ticketQuantity,
    makerFeePct,
    takerFeePct,
    tradeEditDraft,
    trades,
    workingTrades,
  ]);
}
