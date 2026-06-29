import type { Trade } from "../../../types";

export interface OrderRiskInput {
  side: Trade["side"] | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  balance: number;
}

export interface OrderRiskStats {
  riskAmount: number;
  riskPct: number;
  rewardAmount: number;
  rewardPct: number;
  riskReward: number | null;
}

export interface RiskSizingInput {
  side: Trade["side"];
  entry: number;
  stopLoss: number;
  balance: number;
  riskPct: number;
  leverage: number;
  maxMargin?: number;
}

export interface RiskSizingResult {
  quantity: number;
  margin: number;
  notional: number;
  riskAmount: number;
  capped: boolean;
}

function isValidLongProtection(entry: number, stopLoss: number, takeProfit: number): boolean {
  return stopLoss > 0 && stopLoss < entry && takeProfit > entry;
}

function isValidShortProtection(entry: number, stopLoss: number, takeProfit: number): boolean {
  return stopLoss > entry && takeProfit > 0 && takeProfit < entry;
}

export function calculateOrderRisk({
  side,
  entry,
  stopLoss,
  takeProfit,
  quantity,
  balance,
}: OrderRiskInput): OrderRiskStats | null {
  if (!side || entry <= 0 || quantity <= 0 || balance <= 0) return null;
  const validProtection = side === "LONG"
    ? isValidLongProtection(entry, stopLoss, takeProfit)
    : isValidShortProtection(entry, stopLoss, takeProfit);
  if (!validProtection) return null;

  const riskPerUnit = Math.abs(entry - stopLoss);
  const rewardPerUnit = Math.abs(takeProfit - entry);
  const riskAmount = riskPerUnit * quantity;
  const rewardAmount = rewardPerUnit * quantity;

  if (!Number.isFinite(riskAmount) || riskAmount <= 0) return null;

  return {
    riskAmount,
    riskPct: riskAmount / balance * 100,
    rewardAmount,
    rewardPct: rewardAmount / balance * 100,
    riskReward: rewardPerUnit > 0 ? rewardPerUnit / riskPerUnit : null,
  };
}

export function calculateRiskBasedSizing({
  side,
  entry,
  stopLoss,
  balance,
  riskPct,
  leverage,
  maxMargin,
}: RiskSizingInput): RiskSizingResult | null {
  if (entry <= 0 || balance <= 0 || riskPct <= 0 || leverage <= 0) return null;
  const validStop = side === "LONG"
    ? stopLoss > 0 && stopLoss < entry
    : stopLoss > entry;
  if (!validStop) return null;

  const riskAmount = balance * riskPct / 100;
  const riskPerUnit = Math.abs(entry - stopLoss);
  const uncappedQuantity = riskAmount / riskPerUnit;
  const uncappedNotional = uncappedQuantity * entry;
  const uncappedMargin = uncappedNotional / leverage;
  const capped = maxMargin != null && maxMargin >= 0 && uncappedMargin > maxMargin;
  const margin = capped ? maxMargin : uncappedMargin;
  const notional = margin * leverage;
  const quantity = entry > 0 ? notional / entry : 0;
  const effectiveRiskAmount = riskPerUnit * quantity;

  if (![quantity, notional, margin].every(Number.isFinite)) return null;

  return {
    quantity,
    margin,
    notional,
    riskAmount: effectiveRiskAmount,
    capped,
  };
}
