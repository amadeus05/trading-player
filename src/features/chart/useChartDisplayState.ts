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
}: UseChartDisplayStateOptions): ChartDisplayState {
  const {
    limitPrice,
    orderType,
    protectionEnabled,
    stopLoss,
    takeProfit,
    ticketPrice,
  } = orderForm;

  return useMemo(() => {
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
    const draftProtectionTrade: Trade | undefined = protectionEnabled
      && ticketPrice > 0
      && takeProfit > 0
      && stopLoss > 0
      ? {
          id: "__draft_protection__",
          side: "LONG",
          entryTime: currentCandle?.time ?? 0,
          entry: ticketPrice,
          size: 0,
          sl: stopLoss,
          tp: takeProfit,
          status: "OPEN",
          comment: "",
        }
      : undefined;
    const displayedTrade = editedTrade ?? draftProtectionTrade;
    const displayedTrades = displayedTrade?.id === "__draft_protection__"
      ? [...trades, displayedTrade]
      : tradeEditDraft && editedTrade
        ? trades.map((trade) => trade.id === editedTrade.id ? editedTrade : trade)
        : trades;
    const barriers: Barrier[] = editedTrade
      ? activeBarriers
      : draftProtectionTrade
        ? [{
            id: draftProtectionTrade.id,
            entryTime: currentCandle?.time ?? 0,
            upper: draftProtectionTrade.tp,
            lower: draftProtectionTrade.sl,
            timeLimit: Number.MAX_SAFE_INTEGER,
          }]
        : NO_BARRIERS;
    const entryMarker = editedTrade?.status === "PENDING"
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
    protectionEnabled,
    stopLoss,
    takeProfit,
    ticketPrice,
    tradeEditDraft,
    trades,
    workingTrades,
  ]);
}
