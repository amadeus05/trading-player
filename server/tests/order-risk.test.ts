import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderRisk, calculateRiskBasedSizing } from "../../src/features/trading/lib/calculateOrderRisk";

test("calculates long order risk, reward and R/R", () => {
  const risk = calculateOrderRisk({
    side: "LONG",
    entry: 100,
    stopLoss: 95,
    takeProfit: 115,
    quantity: 2,
    balance: 1_000,
  });

  assert.deepEqual(risk, {
    riskAmount: 10,
    riskPct: 1,
    rewardAmount: 30,
    rewardPct: 3,
    riskReward: 3,
  });
});

test("calculates short order risk, reward and R/R", () => {
  const risk = calculateOrderRisk({
    side: "SHORT",
    entry: 100,
    stopLoss: 106,
    takeProfit: 88,
    quantity: 3,
    balance: 900,
  });

  assert.deepEqual(risk, {
    riskAmount: 18,
    riskPct: 2,
    rewardAmount: 36,
    rewardPct: 4,
    riskReward: 2,
  });
});

test("rejects invalid protection", () => {
  const risk = calculateOrderRisk({
    side: "LONG",
    entry: 100,
    stopLoss: 105,
    takeProfit: 115,
    quantity: 1,
    balance: 1_000,
  });

  assert.equal(risk, null);
});

test("calculates margin from selected risk percent", () => {
  const sizing = calculateRiskBasedSizing({
    side: "LONG",
    entry: 100,
    stopLoss: 95,
    balance: 1_000,
    riskPct: 1,
    leverage: 10,
  });

  assert.deepEqual(sizing, {
    quantity: 2,
    margin: 20,
    notional: 200,
    riskAmount: 10,
    capped: false,
  });
});

test("keeps risk and notional stable while leverage changes margin", () => {
  const lowLeverage = calculateRiskBasedSizing({
    side: "LONG",
    entry: 100,
    stopLoss: 95,
    balance: 1_000,
    riskPct: 1,
    leverage: 5,
  });
  const highLeverage = calculateRiskBasedSizing({
    side: "LONG",
    entry: 100,
    stopLoss: 95,
    balance: 1_000,
    riskPct: 1,
    leverage: 20,
  });

  assert.equal(lowLeverage?.riskAmount, 10);
  assert.equal(highLeverage?.riskAmount, 10);
  assert.equal(lowLeverage?.quantity, highLeverage?.quantity);
  assert.equal(lowLeverage?.notional, highLeverage?.notional);
  assert.equal(lowLeverage?.margin, 40);
  assert.equal(highLeverage?.margin, 10);
});

test("caps risk based sizing by available margin", () => {
  const sizing = calculateRiskBasedSizing({
    side: "LONG",
    entry: 100,
    stopLoss: 99,
    balance: 300,
    riskPct: 2,
    leverage: 1,
    maxMargin: 300,
  });

  assert.deepEqual(sizing, {
    quantity: 3,
    margin: 300,
    notional: 300,
    riskAmount: 3,
    capped: true,
  });
});
