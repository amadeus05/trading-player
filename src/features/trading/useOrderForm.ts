import { useMemo, useState } from "react";
import type { Candle, Trade } from "../../types";
import { PAPER_BALANCE_USDT } from "../../shared/config/simulation";
import type { AmountUnit, OrderType } from "./types";

interface UseOrderFormOptions {
  currentCandle?: Candle;
  pricePrecision: number;
}

export function useOrderForm({
  currentCandle,
  pricePrecision,
}: UseOrderFormOptions) {
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [leverage, setLeverage] = useState(10);
  const [amountUnit, setAmountUnit] = useState<AmountUnit>("USDT");
  const [orderValue, setOrderValue] = useState(100);
  const [allocationPercent, setAllocationPercent] = useState(1);
  const [limitPrice, setLimitPrice] = useState(0);
  const [orderDraftSide, setOrderDraftSide] = useState<Trade["side"] | null>(null);
  const [takeProfit, setTakeProfit] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);

  const ticket = useMemo(() => {
    const ticketPrice = orderType === "MARKET"
      ? currentCandle?.close ?? 0
      : limitPrice || currentCandle?.close || 0;
    const ticketQuantity = ticketPrice > 0
      ? amountUnit === "USDT" ? orderValue / ticketPrice : orderValue
      : 0;
    const ticketNotional = ticketQuantity * ticketPrice;
    return {
      ticketPrice,
      ticketQuantity,
      ticketNotional,
      ticketMargin: ticketNotional / leverage,
      longLiquidation: ticketPrice > 0 && leverage > 1
        ? ticketPrice * (1 - 1 / leverage)
        : null,
      shortLiquidation: ticketPrice > 0 && leverage > 1
        ? ticketPrice * (1 + 1 / leverage)
        : null,
    };
  }, [amountUnit, currentCandle?.close, leverage, limitPrice, orderType, orderValue]);

  const changeOrderType = (nextOrderType: OrderType) => {
    setOrderType(nextOrderType);
    if (nextOrderType === "LIMIT" && currentCandle) setLimitPrice(currentCandle.close);
  };

  const beginOrderDraft = (side: Trade["side"]) => {
    if (!currentCandle?.close) return;
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
    setOrderDraftSide(null);
    setTakeProfit(0);
    setStopLoss(0);
  };

  const changeOrderValue = (nextValue: number) => {
    setOrderValue(nextValue);
    const notional = amountUnit === "USDT"
      ? nextValue
      : nextValue * ticket.ticketPrice;
    setAllocationPercent(
      Math.min(100, notional / leverage / PAPER_BALANCE_USDT * 100),
    );
  };

  const changeAmountUnit = (nextUnit: AmountUnit) => {
    setOrderValue(nextUnit === "USDT" ? ticket.ticketNotional : ticket.ticketQuantity);
    setAmountUnit(nextUnit);
  };

  const changeAllocation = (percent: number) => {
    setAllocationPercent(percent);
    const notional = PAPER_BALANCE_USDT * (percent / 100) * leverage;
    setOrderValue(
      amountUnit === "USDT"
        ? notional
        : ticket.ticketPrice ? notional / ticket.ticketPrice : 0,
    );
  };

  const resetProtection = () => {
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
    resetProtection,
    setLeverage,
    setLimitPrice,
    setStopLoss,
    setTakeProfit,
  };
}

export type OrderFormController = ReturnType<typeof useOrderForm>;
