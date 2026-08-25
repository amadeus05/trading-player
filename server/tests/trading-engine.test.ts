import assert from "node:assert/strict";
import test from "node:test";
import type { Candle, Persisted, SimulationSettings, Trade } from "../../src/types";
import { createOrder } from "../../src/features/trading/lib/createOrder";
import { calculateManualClose } from "../../src/features/trading/lib/calculateTradeResult";
import { advanceSimulation, simulationTickKey } from "../../src/features/trading/lib/advanceSimulation";
import { DEFAULT_SIMULATION_SETTINGS } from "../../src/shared/config/simulation";

const settings: SimulationSettings = {
  ...DEFAULT_SIMULATION_SETTINGS,
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
  assert.equal(result.trade.createdTime, 1_000);
  assert.ok(result.trade.placedAt != null);
  assert.ok(Math.abs((result.trade.placedAt ?? 0) - Math.floor(Date.now() / 1_000)) <= 2);
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

test("switching to a higher TF does not close on unplayed 5m inside the parent bar", () => {
  const openTrade: Trade = {
    id: "partial-4h",
    side: "LONG",
    entryTime: 500,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const start = 1_800_000_000;
  const fiveMin = 5 * 60;
  const rawCandles = Array.from({ length: 48 }, (_, index) => candle(start + index * fiveMin, {
    high: index === 19 ? 101 : 101,
    low: index === 19 ? 90 : 99,
  }));
  const fourHour = candle(start, { high: 101, low: 90 });
  const playheadAfterTen = start + 10 * fiveMin - 1;
  const result = advanceSimulation({
    state,
    rawCandles,
    candle: fourHour,
    timeframeMinutes: 240,
    settings,
    playheadTime: playheadAfterTen,
  });
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test("closes when the playhead has already reached the 5m that hits SL", () => {
  const openTrade: Trade = {
    id: "reached-sl",
    side: "LONG",
    entryTime: 500,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const start = 1_800_000_000;
  const fiveMin = 5 * 60;
  const rawCandles = Array.from({ length: 48 }, (_, index) => candle(start + index * fiveMin, {
    low: index === 19 ? 90 : 99,
  }));
  const fourHour = candle(start, { high: 101, low: 90 });
  const result = advanceSimulation({
    state,
    rawCandles,
    candle: fourHour,
    timeframeMinutes: 240,
    settings,
    playheadTime: start + 20 * fiveMin - 1,
  });
  assert.equal(result.state.trades[0].status, "CLOSED");
  assert.equal(result.state.trades[0].outcome, "SL");
});

test("without playhead a full parent candle still closes via fallback", () => {
  const openTrade: Trade = {
    id: "no-playhead-fallback",
    side: "LONG",
    entryTime: 500,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const start = 1_800_000_000;
  const fourHour = candle(start, { high: 101, low: 90 });
  const result = advanceSimulation({
    state,
    rawCandles: [fourHour],
    candle: fourHour,
    timeframeMinutes: 240,
    settings,
  });
  assert.equal(result.state.trades[0].status, "CLOSED");
  assert.equal(result.state.trades[0].outcome, "SL");
});

test("does not close or fill against a candle that opens after the playhead", () => {
  const pending: Trade = {
    id: "future-pending",
    side: "LONG",
    entryTime: 1_000,
    createdTime: 1_000,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "PENDING",
    entryFee: 0.02,
    comment: "",
  };
  const openTrade: Trade = {
    id: "future-open",
    side: "LONG",
    entryTime: 1_000,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = {
    datasets: [],
    trades: [pending, openTrade],
    annotations: [{ id: pending.id, entryTime: 1_000, upper: 110, lower: 90, timeLimit: 9_999 }],
  };
  const future = candle(1_000 + 86_400, { high: 120, low: 80 });
  const result = advanceSimulation({
    state,
    rawCandles: [future],
    candle: future,
    timeframeMinutes: 1_440,
    settings,
    playheadTime: 1_000 + 86_400 - 1,
  });
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test("playhead on the fill candle still fills a pending order", () => {
  const pending: Trade = {
    id: "pending-playhead",
    side: "LONG",
    entryTime: 1_000,
    createdTime: 1_000,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "PENDING",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = {
    datasets: [],
    trades: [pending],
    annotations: [{ id: pending.id, entryTime: 1_000, upper: 110, lower: 90, timeLimit: 9_999 }],
  };
  const tick = candle(1_900, { high: 102, low: 99 });
  const result = advanceSimulation({
    state,
    rawCandles: [tick],
    candle: tick,
    timeframeMinutes: 15,
    settings,
    playheadTime: 1_900 + 15 * 60 - 1,
  });
  assert.equal(result.state.trades[0].status, "OPEN");
  assert.deepEqual(result.events.map((event) => event.type), ["order-filled"]);
});

test("does not close the entry candle even when later 5m in the same parent hit SL", () => {
  const start = 1_800_000_000;
  const openTrade: Trade = {
    id: "same-bar",
    side: "LONG",
    entryTime: start,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const fiveMin = 5 * 60;
  const rawCandles = Array.from({ length: 48 }, (_, index) => candle(start + index * fiveMin, {
    low: index === 3 ? 90 : 99,
  }));
  const result = advanceSimulation({
    state,
    rawCandles,
    candle: candle(start, { high: 101, low: 90 }),
    timeframeMinutes: 240,
    settings,
    playheadTime: start + 10 * fiveMin - 1,
  });
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test("fallback with playhead uses the played 5m range, not the full parent OHLC", () => {
  const openTrade: Trade = {
    id: "fallback-partial",
    side: "LONG",
    entryTime: 500,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const start = 1_800_000_000;
  const fiveMin = 5 * 60;
  const played = Array.from({ length: 10 }, (_, index) => candle(start + index * fiveMin, { low: 99 }));
  const fourHour = candle(start, { high: 101, low: 90 });
  const result = advanceSimulation({
    state,
    rawCandles: played,
    candle: fourHour,
    timeframeMinutes: 7,
    settings,
    playheadTime: start + 10 * fiveMin - 1,
  });
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test("fallback with playhead still closes when the played 5m already hit SL", () => {
  const openTrade: Trade = {
    id: "fallback-played-hit",
    side: "LONG",
    entryTime: 500,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const start = 1_800_000_000;
  const fiveMin = 5 * 60;
  const played = Array.from({ length: 10 }, (_, index) => candle(start + index * fiveMin, {
    low: index === 2 ? 90 : 99,
  }));
  const fourHour = candle(start, { high: 101, low: 90 });
  const result = advanceSimulation({
    state,
    rawCandles: played,
    candle: fourHour,
    timeframeMinutes: 7,
    settings,
    playheadTime: start + 10 * fiveMin - 1,
  });
  assert.equal(result.state.trades[0].status, "CLOSED");
  assert.equal(result.state.trades[0].outcome, "SL");
});

test("simulation tick key changes when 5m arrive for the same 4h bucket", () => {
  const start = 1_800_000_000;
  const playhead = start + 10 * 5 * 60 - 1;
  const empty = simulationTickKey("btc", 240, start, playhead, []);
  const loaded = simulationTickKey("btc", 240, start, playhead, [
    candle(start),
    candle(start + 5 * 60),
  ]);
  assert.notEqual(empty, loaded);
});

test("simulation tick key changes when the playhead moves inside the same 4h bucket", () => {
  const start = 1_800_000_000;
  const fiveMin = 5 * 60;
  const raw = Array.from({ length: 10 }, (_, index) => candle(start + index * fiveMin));
  const afterTen = simulationTickKey("btc", 240, start, start + 10 * fiveMin - 1, raw);
  const afterBarEnd = simulationTickKey("btc", 240, start, start + 240 * 60 - 1, raw);
  assert.notEqual(afterTen, afterBarEnd);
});

test("simulation tick key stays stable for the same head and 5m window", () => {
  const start = 1_800_000_000;
  const raw = [candle(start), candle(start + 300)];
  const key = simulationTickKey("btc", 240, start, start + 599, raw);
  assert.equal(key, simulationTickKey("btc", 240, start, start + 599, raw));
});

test("empty 5m then loaded 5m re-evaluates the same 4h bucket and can close", () => {
  const openTrade: Trade = {
    id: "reload-5m",
    side: "LONG",
    entryTime: 500,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 110,
    status: "OPEN",
    entryFee: 0.02,
    comment: "",
  };
  const state: Persisted = { datasets: [], trades: [openTrade], annotations: [] };
  const start = 1_800_000_000;
  const fiveMin = 5 * 60;
  const fourHour = candle(start, { high: 101, low: 90 });
  const playhead = start + 10 * fiveMin - 1;
  const first = advanceSimulation({
    state,
    rawCandles: [],
    candle: fourHour,
    timeframeMinutes: 240,
    settings,
    playheadTime: playhead,
  });
  assert.equal(first.state, state);
  const loaded = Array.from({ length: 10 }, (_, index) => candle(start + index * fiveMin, {
    low: index === 2 ? 90 : 99,
  }));
  assert.notEqual(
    simulationTickKey("btc", 240, start, playhead, []),
    simulationTickKey("btc", 240, start, playhead, loaded),
  );
  const second = advanceSimulation({
    state: first.state,
    rawCandles: loaded,
    candle: fourHour,
    timeframeMinutes: 240,
    settings,
    playheadTime: playhead,
  });
  assert.equal(second.state.trades[0].status, "CLOSED");
  assert.equal(second.state.trades[0].outcome, "SL");
});
