import assert from "node:assert/strict";
import test from "node:test";
import type { Candle, Persisted, SimulationSettings, Trade } from "../../src/types";
import { createOrder } from "../../src/features/trading/lib/createOrder";
import { calculateManualClose } from "../../src/features/trading/lib/calculateTradeResult";
import { advanceSimulation } from "../../src/features/trading/lib/advanceSimulation";

const settings: SimulationSettings = {
  makerFeePct: 0.02,
  takerFeePct: 0.055,
  slippagePct: 0.02,
  stopSlippagePct: 0.05,
  showClosedTradeOverlays: true,
  followCandle: false,
  ambiguousExitPolicy: "conservative",
};

const candle = (time: number, values: Partial<Candle> = {}): Candle => ({
  time,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  ...values,
});

test("creates a market order with entry slippage, fee snapshot and barrier", () => {
  const result = createOrder({
    id: "trade-1",
    side: "LONG",
    candle: candle(1_000),
    timeframeMinutes: 15,
    settings,
    orderType: "MARKET",
    leverage: 10,
    amountUnit: "USDT",
    orderValue: 1_000,
    limitPrice: 0,
    protectionEnabled: true,
    takeProfit: 102,
    stopLoss: 98,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.trade.entry, 100.02);
  assert.equal(result.trade.entry * result.trade.size, 10_000);
  assert.equal(result.trade.entryFee, 5.5);
  assert.deepEqual(result.barrier, {
    id: "trade-1",
    entryTime: 1_000,
    upper: 102,
    lower: 98,
    timeLimit: 1_000 + 24 * 60 * 60,
  });
});

test("rejects barriers on the wrong side of entry", () => {
  const result = createOrder({
    id: "trade-2",
    side: "SHORT",
    candle: candle(1_000),
    timeframeMinutes: 15,
    settings,
    orderType: "LIMIT",
    leverage: 5,
    amountUnit: "COIN",
    orderValue: 1,
    limitPrice: 100,
    protectionEnabled: true,
    takeProfit: 101,
    stopLoss: 99,
  });
  assert.deepEqual(result, { ok: false, error: "invalid-barriers" });
});

test("manual close applies adverse slippage and taker fees", () => {
  const trade: Trade = {
    id: "trade-3",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 2,
    sl: 98,
    tp: 104,
    status: "OPEN",
    entryFee: 0.11,
    comment: "",
  };
  const result = calculateManualClose(trade, 102, settings);
  assert.equal(result.exit, 101.9796);
  assert.ok(Math.abs(result.grossResult - 3.9592) < 1e-10);
  assert.ok(Math.abs(result.fees - 0.22217756) < 1e-10);
  assert.equal(result.result, result.grossResult - result.fees);
});

test("fills pending orders once and does not close them on the fill candle", () => {
  const pending: Trade = {
    id: "pending",
    side: "LONG",
    entryTime: 1_000,
    createdTime: 1_000,
    entry: 100,
    size: 1,
    sl: 98,
    tp: 101,
    status: "PENDING",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = {
    datasets: [],
    trades: [pending],
    annotations: [{ id: pending.id, entryTime: 1_000, upper: 101, lower: 98, timeLimit: 9_999 }],
  };
  const tick = candle(1_900, { high: 102, low: 99 });
  const first = advanceSimulation({ state, rawCandles: [tick], candle: tick, timeframeMinutes: 15, settings });
  assert.equal(first.state.trades[0].status, "OPEN");
  assert.equal(first.state.trades[0].entryTime, tick.time);
  assert.deepEqual(first.events.map((event) => event.type), ["order-filled"]);

  const repeated = advanceSimulation({ state: first.state, rawCandles: [tick], candle: tick, timeframeMinutes: 15, settings });
  assert.equal(repeated.state, first.state);
  assert.deepEqual(repeated.events, []);
});

test("closes an existing trade and becomes idempotent for the same tick", () => {
  const openTrade: Trade = {
    id: "open",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 98,
    tp: 101,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const tick = candle(1_900, { high: 102, low: 99 });
  const first = advanceSimulation({ state, rawCandles: [tick], candle: tick, timeframeMinutes: 15, settings });
  assert.equal(first.state.trades[0].status, "CLOSED");
  assert.equal(first.state.trades[0].outcome, "TP");
  assert.deepEqual(first.events.map((event) => event.type), ["trade-closed"]);

  const repeated = advanceSimulation({ state: first.state, rawCandles: [tick], candle: tick, timeframeMinutes: 15, settings });
  assert.equal(repeated.state, first.state);
  assert.deepEqual(repeated.events, []);
});

test("closes multiple open trades independently on the same tick", () => {
  const longTrade: Trade = {
    id: "open-long",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 101,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const shortTrade: Trade = {
    id: "open-short",
    side: "SHORT",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 110,
    tp: 99,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [longTrade, shortTrade], annotations: [] };
  const tick = candle(1_900, { high: 102, low: 98 });

  const result = advanceSimulation({ state, rawCandles: [tick], candle: tick, timeframeMinutes: 15, settings });

  assert.deepEqual(result.state.trades.map((trade) => trade.status), ["CLOSED", "CLOSED"]);
  assert.deepEqual(result.state.trades.map((trade) => trade.outcome), ["TP", "TP"]);
  assert.deepEqual(result.events.map((event) => event.type), ["trade-closed", "trade-closed"]);
  assert.deepEqual(result.events.map((event) => event.trade.id), ["open-long", "open-short"]);
});

test("uses conservative ambiguous fallback policy by closing at SL", () => {
  const trade: Trade = {
    id: "ambiguous-conservative",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 95,
    tp: 105,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [trade], annotations: [] };
  const tick = candle(1_900, { high: 106, low: 94 });

  const result = advanceSimulation({ state, rawCandles: [tick], candle: tick, timeframeMinutes: 15, settings });

  assert.equal(result.state.trades[0].status, "CLOSED");
  assert.equal(result.state.trades[0].outcome, "SL");
});

test("uses optimistic ambiguous fallback policy by closing at TP", () => {
  const trade: Trade = {
    id: "ambiguous-optimistic",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 95,
    tp: 105,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [trade], annotations: [] };
  const tick = candle(1_900, { high: 106, low: 94 });

  const result = advanceSimulation({
    state,
    rawCandles: [tick],
    candle: tick,
    timeframeMinutes: 15,
    settings: { ...settings, ambiguousExitPolicy: "optimistic" },
  });

  assert.equal(result.state.trades[0].status, "CLOSED");
  assert.equal(result.state.trades[0].outcome, "TP");
});

test("uses ignore ambiguous fallback policy by keeping the trade open", () => {
  const trade: Trade = {
    id: "ambiguous-ignore",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 95,
    tp: 105,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [trade], annotations: [] };
  const tick = candle(1_900, { high: 106, low: 94 });

  const result = advanceSimulation({
    state,
    rawCandles: [tick],
    candle: tick,
    timeframeMinutes: 15,
    settings: { ...settings, ambiguousExitPolicy: "ignore" },
  });

  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});
