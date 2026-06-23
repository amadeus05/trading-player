import type { SimulationSettings, Trade } from "../../../types";

export interface TradeCloseResult {
  exit: number;
  grossResult: number;
  fees: number;
  result: number;
}

const calculateResult = (
  trade: Trade,
  exit: number,
  exitFeePct: number,
): TradeCloseResult => {
  const grossResult = (
    trade.side === "LONG" ? exit - trade.entry : trade.entry - exit
  ) * trade.size;
  const exitFee = exit * trade.size * exitFeePct / 100;
  const fees = (trade.entryFee ?? 0) + exitFee;
  return { exit, grossResult, fees, result: grossResult - fees };
};

export function calculateManualClose(
  trade: Trade,
  marketPrice: number,
  settings: SimulationSettings,
): TradeCloseResult {
  const slippage = (trade.slippagePct ?? settings.slippagePct) / 100;
  const exit = marketPrice * (trade.side === "LONG" ? 1 - slippage : 1 + slippage);
  return calculateResult(
    trade,
    exit,
    trade.takerFeePct ?? settings.takerFeePct,
  );
}

export function calculateBarrierClose(
  trade: Trade,
  outcome: "TP" | "SL",
  settings: SimulationSettings,
): TradeCloseResult {
  const isStopLoss = outcome === "SL";
  const barrierPrice = isStopLoss ? trade.sl : trade.tp;
  const stopSlippage = (trade.stopSlippagePct ?? settings.stopSlippagePct) / 100;
  const exit = isStopLoss
    ? barrierPrice * (trade.side === "LONG" ? 1 - stopSlippage : 1 + stopSlippage)
    : barrierPrice;
  const exitFeePct = outcome === "TP"
    ? trade.makerFeePct ?? settings.makerFeePct
    : trade.takerFeePct ?? settings.takerFeePct;
  return calculateResult(trade, exit, exitFeePct);
}
