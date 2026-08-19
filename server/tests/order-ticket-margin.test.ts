import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ORDER_MARGIN, resolveTicketMargin } from "../../src/features/trading/lib/resolveTicketMargin";

test("does not wipe size when available margin is zero", () => {
  assert.equal(resolveTicketMargin(100, 0), 100);
});

test("caps size down to what is actually affordable", () => {
  assert.equal(resolveTicketMargin(100, 99.46), 99.46);
});

test("restores default size after it was zeroed and funds are back", () => {
  assert.equal(resolveTicketMargin(0, 99.46), 99.46);
  assert.equal(resolveTicketMargin(0, 10_000), DEFAULT_ORDER_MARGIN);
});

test("leaves a valid in-range ticket untouched", () => {
  assert.equal(resolveTicketMargin(50, 99.46), 50);
});
