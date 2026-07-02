import { useState, type Dispatch, type SetStateAction } from "react";
import type { Persisted, SimulationSettings, Trade } from "../../types";
import type { TradeEditDraft } from "./types";

interface UseTradeEditingOptions {
  state: Persisted;
  setState: Dispatch<SetStateAction<Persisted>>;
  settings: SimulationSettings;
  pricePrecision: number;
  onDraftTakeProfitChange: (price: number) => void;
  onDraftStopLossChange: (price: number) => void;
  onDraftLimitPriceChange: (price: number) => void;
  onSuccess: (message: string) => void;
  onWarning: (message: string) => void;
}

export function useTradeEditing({
  state,
  setState,
  settings,
  pricePrecision,
  onDraftTakeProfitChange,
  onDraftStopLossChange,
  onDraftLimitPriceChange,
  onSuccess,
  onWarning,
}: UseTradeEditingOptions) {
  const [focusedTradeId, setFocusedTradeId] = useState<string | null>(null);
  const [tradeEditDraft, setTradeEditDraft] = useState<TradeEditDraft | null>(null);

  const moveBarrier = (id: string, kind: "tp" | "sl", price: number) => {
    const rounded = Number(price.toFixed(pricePrecision));
    if (id === "__draft_protection__") {
      if (kind === "tp") onDraftTakeProfitChange(rounded);
      else onDraftStopLossChange(rounded);
      return;
    }
    if (tradeEditDraft?.id === id) {
      setTradeEditDraft((draft) => draft?.id === id ? { ...draft, [kind]: rounded } : draft);
      return;
    }
    setState((current) => {
      const trades = current.trades.map((trade) =>
        trade.id === id ? { ...trade, [kind]: rounded } : trade,
      );
      const trade = trades.find((item) => item.id === id);
      if (!trade) return current;
      const annotations = current.annotations.map((barrier) => barrier.id === id ? {
        ...barrier,
        upper: trade.side === "LONG" ? trade.tp : trade.sl,
        lower: trade.side === "LONG" ? trade.sl : trade.tp,
      } : barrier);
      return { ...current, trades, annotations };
    });
  };

  const moveEntryMarker = (id: string, price: number) => {
    const rounded = Number(price.toFixed(pricePrecision));
    if (id === "__draft_limit_entry__") {
      onDraftLimitPriceChange(rounded);
      return;
    }
    if (tradeEditDraft?.id === id) {
      setTradeEditDraft((draft) => draft?.id === id ? { ...draft, entry: rounded } : draft);
      return;
    }
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) =>
        trade.id === id && trade.status === "PENDING" ? { ...trade, entry: rounded } : trade,
      ),
    }));
  };

  const startTradeEditing = (trade: Trade) => {
    setFocusedTradeId(trade.id);
    setTradeEditDraft({ id: trade.id, entry: trade.entry, tp: trade.tp, sl: trade.sl });
  };

  const cancelTradeEditing = () => setTradeEditDraft(null);

  const saveTradeEditing = () => {
    if (!tradeEditDraft) return;
    const trade = state.trades.find((item) => item.id === tradeEditDraft.id);
    if (!trade) {
      setTradeEditDraft(null);
      return;
    }
    const valid = trade.side === "LONG"
      ? tradeEditDraft.sl < tradeEditDraft.entry && tradeEditDraft.tp > tradeEditDraft.entry
      : tradeEditDraft.tp < tradeEditDraft.entry && tradeEditDraft.sl > tradeEditDraft.entry;
    if (!valid) {
      onWarning(trade.side === "LONG"
        ? "Для LONG: SL ниже входа, TP выше входа"
        : "Для SHORT: TP ниже входа, SL выше входа");
      return;
    }
    setState((current) => ({
      ...current,
      trades: current.trades.map((item) => item.id === trade.id ? {
        ...item,
        entry: tradeEditDraft.entry,
        tp: tradeEditDraft.tp,
        sl: tradeEditDraft.sl,
        entryFee: item.status === "PENDING"
          ? tradeEditDraft.entry * item.size * (item.makerFeePct ?? settings.makerFeePct) / 100
          : item.entryFee,
      } : item),
      annotations: current.annotations.map((barrier) => barrier.id === trade.id ? {
        ...barrier,
        upper: trade.side === "LONG" ? tradeEditDraft.tp : tradeEditDraft.sl,
        lower: trade.side === "LONG" ? tradeEditDraft.sl : tradeEditDraft.tp,
      } : barrier),
    }));
    setTradeEditDraft(null);
    onSuccess("Параметры сделки обновлены");
  };

  return {
    focusedTradeId,
    tradeEditDraft,
    cancelTradeEditing,
    moveBarrier,
    moveEntryMarker,
    saveTradeEditing,
    setFocusedTradeId,
    setTradeEditDraft,
    startTradeEditing,
  };
}
