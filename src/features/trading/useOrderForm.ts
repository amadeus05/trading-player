import { useEffect, useMemo, useState } from "react";
import type { Candle, SimulationSettings, Trade } from "../../types";
import type { AmountUnit, OrderType } from "./types";
import { calculateLiquidationRisk, calculateOrderRisk, calculateRiskBasedSizing } from "./lib/calculateOrderRisk";
import { buildInitialProtectionPrices, type ChartPriceRange } from "./lib/buildInitialProtectionPrices";

export const RISK_PRESETS = [0.5, 1, 2] as const;

/** Округляем вниз до центов, чтобы 100% никогда не просило больше, чем есть. */
function maxAffordableMargin(available: number) {
  if (!(available > 0)) return 0;
  return Math.floor(available * 100) / 100;
}

function marginFromOrderValue(value: number, unit: AmountUnit, price: number, leverage: number) {
  return unit === "USDT" ? value : price > 0 ? value * price / leverage : 0;
}

function orderValueFromMargin(margin: number, unit: AmountUnit, price: number, leverage: number) {
  return unit === "USDT" ? margin : price > 0 ? margin * leverage / price : 0;
}

interface UseOrderFormOptions {
  currentCandle?: Candle;
  pricePrecision: number;
  settings: SimulationSettings;
  balance: number;
  availableBalance: number;
}

export function useOrderForm({
  currentCandle,
  pricePrecision,
  settings,
  balance,
  availableBalance,
}: UseOrderFormOptions) {
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [leverage, setLeverage] = useState(1);
  const [amountUnit, setAmountUnit] = useState<AmountUnit>("USDT");
  const [orderValue, setOrderValue] = useState(100);
  const [allocationPercent, setAllocationPercent] = useState(1);
  const [selectedRiskPct, setSelectedRiskPct] = useState<number | null>(null);
  const [riskSizingCapped, setRiskSizingCapped] = useState(false);
  const [limitPrice, setLimitPrice] = useState(0);
  const [orderDraftSide, setOrderDraftSide] = useState<Trade["side"] | null>(null);
  const [takeProfit, setTakeProfit] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);

  const affordableMargin = maxAffordableMargin(availableBalance);

  useEffect(() => {
    const price = orderType === "MARKET"
      ? currentCandle?.close ?? 0
      : limitPrice || currentCandle?.close || 0;
    const margin = marginFromOrderValue(orderValue, amountUnit, price, leverage);
    if (!(margin > affordableMargin + 1e-9)) return;
    setOrderValue(orderValueFromMargin(affordableMargin, amountUnit, price, leverage));
    setAllocationPercent(availableBalance > 0 ? 100 : 0);
  }, [affordableMargin, amountUnit, availableBalance, currentCandle?.close, leverage, limitPrice, orderType, orderValue]);

  const ticket = useMemo(() => {
    const ticketPrice = orderType === "MARKET"
      ? currentCandle?.close ?? 0
      : limitPrice || currentCandle?.close || 0;
    const ticketMargin = amountUnit === "USDT"
      ? orderValue
      : ticketPrice > 0 ? orderValue * ticketPrice / leverage : 0;
    const ticketNotional = ticketMargin * leverage;
    const ticketQuantity = ticketPrice > 0
      ? ticketNotional / ticketPrice
      : 0;
    const riskStats = calculateOrderRisk({
      side: orderDraftSide,
      entry: ticketPrice,
      stopLoss,
      takeProfit,
      quantity: ticketQuantity,
      balance,
    });
    const liquidationStats = calculateLiquidationRisk({
      side: orderDraftSide,
      entry: ticketPrice,
      stopLoss,
      leverage,
      takerFeePct: settings.takerFeePct,
    });
    // Precompute whether each risk-size preset is actually reachable with the
    // available margin — otherwise clicking between presets that all clamp to
    // the same max-margin quantity looks like the buttons do nothing.
    const riskPresetCapped: Record<number, boolean> = {};
    if (orderDraftSide) {
      RISK_PRESETS.forEach((riskPct) => {
        const sizing = calculateRiskBasedSizing({
          side: orderDraftSide,
          entry: ticketPrice,
          stopLoss,
          balance,
          riskPct,
          leverage,
          maxMargin: affordableMargin,
        });
        riskPresetCapped[riskPct] = sizing?.capped ?? false;
      });
    }
    return {
      ticketPrice,
      ticketQuantity,
      ticketNotional,
      ticketMargin,
      riskStats,
      liquidationStats,
      riskPresetCapped,
      longLiquidation: ticketPrice > 0 && leverage > 1
        ? ticketPrice * (1 - 1 / leverage)
        : null,
      shortLiquidation: ticketPrice > 0 && leverage > 1
        ? ticketPrice * (1 + 1 / leverage)
        : null,
    };
  }, [affordableMargin, amountUnit, availableBalance, balance, currentCandle?.close, leverage, limitPrice, orderDraftSide, orderType, orderValue, settings.takerFeePct, stopLoss, takeProfit]);

  const changeOrderType = (nextOrderType: OrderType) => {
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    setOrderType(nextOrderType);
    if (nextOrderType === "LIMIT" && currentCandle) setLimitPrice(currentCandle.close);
  };

  const beginOrderDraft = (side: Trade["side"], visiblePriceRange?: ChartPriceRange | null) => {
    if (!currentCandle?.close) return;
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    const currentPrice = currentCandle.close;
    setOrderDraftSide(side);
    const entry = orderType === "LIMIT"
      ? Number((limitPrice || currentPrice).toFixed(pricePrecision))
      : currentPrice;
    if (orderType === "LIMIT") {
      setLimitPrice(entry);
    }
    const { tp, sl } = buildInitialProtectionPrices(
      side,
      entry,
      visiblePriceRange,
      currentCandle,
      pricePrecision,
    );
    setTakeProfit(tp);
    setStopLoss(sl);
  };

  const cancelOrderDraft = () => {
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    setOrderDraftSide(null);
    setTakeProfit(0);
    setStopLoss(0);
  };

  const changeOrderValue = (nextValue: number) => {
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    const rawMargin = marginFromOrderValue(nextValue, amountUnit, ticket.ticketPrice, leverage);
    const margin = Math.min(Math.max(0, rawMargin), affordableMargin);
    setOrderValue(orderValueFromMargin(margin, amountUnit, ticket.ticketPrice, leverage));
    setAllocationPercent(
      availableBalance > 0 ? Math.min(100, margin / availableBalance * 100) : 0,
    );
  };

  const changeAmountUnit = (nextUnit: AmountUnit) => {
    setOrderValue(nextUnit === "USDT" ? ticket.ticketMargin : ticket.ticketQuantity);
    setAmountUnit(nextUnit);
  };

  const applyRiskSizing = (
    riskPct: number,
    nextLeverage = leverage,
    nextStopLoss = stopLoss,
    nextEntry = ticket.ticketPrice,
    nextAmountUnit = amountUnit,
  ) => {
    if (!orderDraftSide) return false;
    const sizing = calculateRiskBasedSizing({
      side: orderDraftSide,
      entry: nextEntry,
      stopLoss: nextStopLoss,
      balance,
      riskPct,
      leverage: nextLeverage,
      maxMargin: affordableMargin,
    });
    if (!sizing) return false;
    setOrderValue(nextAmountUnit === "USDT" ? sizing.margin : sizing.quantity);
    setRiskSizingCapped(sizing.capped);
    setAllocationPercent(
      availableBalance > 0 ? Math.min(100, sizing.margin / availableBalance * 100) : 0,
    );
    return true;
  };

  const changeAllocation = (percent: number) => {
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    setAllocationPercent(percent);
    const margin = affordableMargin * (percent / 100);
    setOrderValue(orderValueFromMargin(margin, amountUnit, ticket.ticketPrice, leverage));
  };

  const changeRiskPercent = (riskPct: number) => {
    if (!applyRiskSizing(riskPct)) return;
    setSelectedRiskPct(riskPct);
  };

  const resyncAllocationForUnitPrice = (nextLeverage: number, nextTicketPrice: number) => {
    if (amountUnit !== "COIN") return;
    const margin = nextTicketPrice > 0 ? orderValue * nextTicketPrice / nextLeverage : 0;
    setAllocationPercent(
      availableBalance > 0 ? Math.min(100, margin / availableBalance * 100) : 0,
    );
  };

  const changeLeverage = (nextLeverage: number) => {
    setLeverage(nextLeverage);
    if (orderDraftSide && selectedRiskPct != null) {
      void applyRiskSizing(selectedRiskPct, nextLeverage);
      return;
    }
    resyncAllocationForUnitPrice(nextLeverage, ticket.ticketPrice);
  };

  const changeLimitPrice = (nextLimitPrice: number) => {
    setLimitPrice(nextLimitPrice);
    const nextTicketPrice = nextLimitPrice || currentCandle?.close || 0;
    if (selectedRiskPct != null) {
      void applyRiskSizing(selectedRiskPct, leverage, stopLoss, nextTicketPrice);
      return;
    }
    resyncAllocationForUnitPrice(leverage, nextTicketPrice);
  };

  const changeStopLoss = (nextStopLoss: number) => {
    setStopLoss(nextStopLoss);
    if (selectedRiskPct == null) return;
    void applyRiskSizing(selectedRiskPct, leverage, nextStopLoss);
  };

  const resetProtection = () => {
    setSelectedRiskPct(null);
    cancelOrderDraft();
  };

  return {
    orderType,
    leverage,
    amountUnit,
    orderValue,
    allocationPercent,
    limitPrice,
    orderDraftSide,
    protectionEnabled: orderDraftSide != null,
    takeProfit,
    stopLoss,
    ...ticket,
    beginOrderDraft,
    cancelOrderDraft,
    changeAllocation,
    changeAmountUnit,
    changeOrderType,
    changeOrderValue,
    changeRiskPercent,
    resetProtection,
    selectedRiskPct,
    riskSizingCapped,
    setLeverage: changeLeverage,
    setLimitPrice: changeLimitPrice,
    setStopLoss: changeStopLoss,
    setTakeProfit,
  };
}

export type OrderFormController = ReturnType<typeof useOrderForm>;
