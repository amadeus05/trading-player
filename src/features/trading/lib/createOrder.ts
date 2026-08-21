import type { Barrier, Candle, SimulationSettings, Trade } from "../../../types";
import type { AmountUnit, OrderType } from "../types";

const DEFAULT_BARRIER_TTL_SECONDS = 24 * 60 * 60;

export type CreateOrderError =
  | "invalid-size"
  | "missing-protection"
  | "invalid-barriers";

export type CreateOrderResult =
  | { ok: true; trade: Trade; barrier: Barrier }
  | { ok: false; error: CreateOrderError };

interface CreateOrderOptions {
  id: string;
  datasetId?: string;
  side: Trade["side"];
  candle: Candle;
  timeframeMinutes: number;
  settings: SimulationSettings;
  orderType: OrderType;
  leverage: number;
  amountUnit: AmountUnit;
  orderValue: number;
  limitPrice: number;
  protectionEnabled: boolean;
  takeProfit: number;
  stopLoss: number;
}

export function createOrder({
  id,
  datasetId,
  side,
  candle,
  timeframeMinutes,
  settings,
  orderType,
  leverage,
  amountUnit,
  orderValue,
  limitPrice,
  protectionEnabled,
  takeProfit,
  stopLoss,
}: CreateOrderOptions): CreateOrderResult {
  const requestedEntry = orderType === "MARKET"
    ? candle.close
    : limitPrice || candle.close;
  const entrySlippage = settings.slippagePct / 100;
  const entry = orderType === "MARKET"
    ? requestedEntry * (side === "LONG" ? 1 + entrySlippage : 1 - entrySlippage)
    : requestedEntry;
  if (!Number.isFinite(entry) || entry <= 0 || orderValue <= 0 || leverage <= 0) {
    return { ok: false, error: "invalid-size" };
  }
  if (!protectionEnabled || stopLoss <= 0 || takeProfit <= 0) {
    return { ok: false, error: "missing-protection" };
  }
  const invalidBarriers = side === "LONG"
    ? stopLoss >= entry || takeProfit <= entry
    : stopLoss <= entry || takeProfit >= entry;
  if (invalidBarriers) return { ok: false, error: "invalid-barriers" };

  const size = amountUnit === "USDT" ? orderValue * leverage / entry : orderValue;
  const entryFeePct = orderType === "MARKET"
    ? settings.takerFeePct
    : settings.makerFeePct;
  const entryFee = entry * size * entryFeePct / 100;
  const trade: Trade = {
    id,
    datasetId,
    timeframeMinutes,
    side,
    entryTime: candle.time,
    createdTime: candle.time,
    // Часы пользователя, не свеча: «последняя сделка» в журнале — по этой дате.
    placedAt: Math.floor(Date.now() / 1_000),
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
    id,
    entryTime: candle.time,
    upper: side === "LONG" ? takeProfit : stopLoss,
    lower: side === "LONG" ? stopLoss : takeProfit,
    timeLimit: candle.time + DEFAULT_BARRIER_TTL_SECONDS,
  };
  return { ok: true, trade, barrier };
}
