import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFocusRange,
  FOCUS_RANGE_BARS,
  FOCUS_RANGE_LOOKBACK,
  isFocusRangeApplied,
} from "../../src/features/chart/chartFocusRange.ts";

test("at replay start the first bar sits on the left edge, not in negative space", () => {
  const range = defaultFocusRange(FOCUS_RANGE_LOOKBACK);
  assert.deepEqual(range, { from: 0, to: FOCUS_RANGE_BARS });
  assert.ok(range.from >= 0);
});

test("the first candle never opens a hole to the left of the series", () => {
  assert.deepEqual(defaultFocusRange(0), { from: 0, to: FOCUS_RANGE_BARS });
  assert.deepEqual(defaultFocusRange(12), { from: 0, to: FOCUS_RANGE_BARS });
});

test("deeper in history the window keeps 80 bars of lookback", () => {
  assert.deepEqual(defaultFocusRange(200), {
    from: 200 - FOCUS_RANGE_LOOKBACK,
    to: 200 - FOCUS_RANGE_LOOKBACK + FOCUS_RANGE_BARS,
  });
});

test("a right-aligned library range is not treated as the intended focus", () => {
  const intended = defaultFocusRange(80);
  assert.equal(isFocusRangeApplied(intended, { from: -19, to: 81 }), false);
  assert.equal(isFocusRangeApplied(intended, { from: 0, to: 100 }), true);
  assert.equal(isFocusRangeApplied(intended, null), false);
});
