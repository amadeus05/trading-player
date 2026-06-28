import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMarketCategory,
  normalizeMarketSymbol,
  normalizeRequest,
} from "../domain/MarketRequest";

test("normalizes valid market category and symbol", () => {
  assert.equal(normalizeMarketCategory("linear"), "linear");
  assert.equal(normalizeMarketSymbol("btcusdt"), "BTCUSDT");
  assert.deepEqual(normalizeRequest({
    category: "spot",
    symbol: "eth-usdt",
    from: 1,
    to: 2,
  }), {
    category: "spot",
    symbol: "ETH-USDT",
    from: 1,
    to: 2,
  });
});

test("rejects invalid market categories", () => {
  assert.throws(() => normalizeMarketCategory("../linear"), /Invalid market category/);
  assert.throws(() => normalizeMarketCategory("futures"), /Invalid market category/);
});

test("rejects symbols that can escape paths or expand globs", () => {
  assert.throws(() => normalizeMarketSymbol("../BTCUSDT"), /Invalid market symbol/);
  assert.throws(() => normalizeMarketSymbol("BTC*"), /Invalid market symbol/);
  assert.throws(() => normalizeMarketSymbol("BTC?USDT"), /Invalid market symbol/);
  assert.throws(() => normalizeMarketSymbol(""), /Invalid market symbol/);
});
