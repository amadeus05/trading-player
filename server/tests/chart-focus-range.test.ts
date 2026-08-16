import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFocusRange,
  FOCUS_RANGE_BARS,
  FOCUS_RANGE_LOOKBACK,
  isFocusRangeApplied,
  resolveChartViewport,
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

test("after the user pans, a later series rebuild keeps the live window, not the jump focus", () => {
  const jumpFocus = defaultFocusRange(80);
  const live = { from: -24, to: 76 };
  assert.deepEqual(
    resolveChartViewport({
      forcedRange: null,
      userMoved: true,
      liveRange: live,
      savedRange: jumpFocus,
      datasetChanged: false,
      preserveViewport: false,
      followRealtime: false,
    }),
    live,
  );
});

test("a new jump still wins after the user has panned", () => {
  const jumpFocus = defaultFocusRange(200);
  const live = { from: -24, to: 76 };
  assert.deepEqual(
    resolveChartViewport({
      forcedRange: jumpFocus,
      userMoved: true,
      liveRange: live,
      savedRange: defaultFocusRange(80),
      datasetChanged: false,
      preserveViewport: false,
      followRealtime: false,
    }),
    jumpFocus,
  );
});

test("follow-candle does not keep the panned window on a rebuild", () => {
  const jumpFocus = defaultFocusRange(80);
  const live = { from: -24, to: 76 };
  assert.equal(
    resolveChartViewport({
      forcedRange: null,
      userMoved: true,
      liveRange: live,
      savedRange: jumpFocus,
      datasetChanged: false,
      preserveViewport: false,
      followRealtime: true,
    }),
    null,
  );
});
