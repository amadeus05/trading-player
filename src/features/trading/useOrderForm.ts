import { useMemo, useState } from "react";
import type { Candle, Trade } from "../../types";
import type { AmountUnit, OrderType } from "./types";
import { calculateOrderRisk, calculateRiskBasedSizing } from "./lib/calculateOrderRisk";

interface UseOrderFormOptions {
  currentCandle?: Candle;
  pricePrecision: number;
  balance: number;
  availableBalance: number;
}

export function useOrderForm({
  currentCandle,
  pricePrecision,
  balance,
  availableBalance,
}: UseOrderFormOptions) {
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [leverage, setLeverage] = useState(10);
  const [amountUnit, setAmountUnit] = useState<AmountUnit>("USDT");
  const [orderValue, setOrderValue] = useState(100);
  const [allocationPercent, setAllocationPercent] = useState(1);
  const [selectedRiskPct, setSelectedRiskPct] = useState<number | null>(null);
  const [riskSizingCapped, setRiskSizingCapped] = useState(false);
  const [limitPrice, setLimitPrice] = useState(0);
  const [orderDraftSide, setOrderDraftSide] = useState<Trade["side"] | null>(null);
  const [takeProfit, setTakeProfit] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);

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
    return {
      ticketPrice,
      ticketQuantity,
      ticketNotional,
      ticketMargin,
      riskStats,
      longLiquidation: ticketPrice > 0 && leverage > 1
        ? ticketPrice * (1 - 1 / leverage)
        : null,
      shortLiquidation: ticketPrice > 0 && leverage > 1
        ? ticketPrice * (1 + 1 / leverage)
        : null,
    };
  }, [amountUnit, balance, currentCandle?.close, leverage, limitPrice, orderDraftSide, orderType, orderValue, stopLoss, takeProfit]);

  const changeOrderType = (nextOrderType: OrderType) => {
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    setOrderType(nextOrderType);
    if (nextOrderType === "LIMIT" && currentCandle) setLimitPrice(currentCandle.close);
  };

  const beginOrderDraft = (side: Trade["side"]) => {
    if (!currentCandle?.close) return;
    setSelectedRiskPct(null);
    setRiskSizingCapped(false);
    const currentPrice = currentCandle.close;
    setOrderDraftSide(side);
    if (orderType === "LIMIT") {
      setLimitPrice(Number(currentPrice.toFixed(pricePrecision)));
    }
    if (side === "LONG") {
      setTakeProfit(Number((currentPrice * 1.01).toFixed(pricePrecision)));
      setStopLoss(Number((currentPrice * 0.99).toFixed(pricePrecision)));
      return;
    }
    setTakeProfit(Number((currentPrice * 0.99).toFixed(pricePrecision)));
    setStopLoss(Number((currentPrice * 1.01).toFixed(pricePrecision)));
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
    setOrderValue(nextValue);
    const margin = amountUnit === "USDT"
      ? nextValue
      : ticket.ticketPrice > 0 ? nextValue * ticket.ticketPrice / leverage : 0;
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
      maxMargin: availableBalance,
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
    const margin = availableBalance * (percent / 100);
    setOrderValue(
      amountUnit === "USDT"
        ? margin
        : ticket.ticketPrice ? margin * leverage / ticket.ticketPrice : 0,
    );
  };

  const changeRiskPercent = (riskPct: number) => {
    if (!applyRiskSizing(riskPct)) return;
    setSelectedRiskPct(riskPct);
  };

  const changeLeverage = (nextLeverage: number) => {
    setLeverage(nextLeverage);
    if (!orderDraftSide || selectedRiskPct == null) return;
    void applyRiskSizing(selectedRiskPct, nextLeverage);
  };

  const changeLimitPrice = (nextLimitPrice: number) => {
    setLimitPrice(nextLimitPrice);
    if (selectedRiskPct == null) return;
    void applyRiskSizing(selectedRiskPct, leverage, stopLoss, nextLimitPrice || currentCandle?.close || 0);
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
