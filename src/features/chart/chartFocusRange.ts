/**
 * Стабильная ширина окна: 80 баров слева от головы и запас справа.
 * Влево за первую свечу не уезжаем — иначе у старта датасета пустая полоса.
 */
export const FOCUS_RANGE_BARS = 100;
export const FOCUS_RANGE_LOOKBACK = 80;

export function defaultFocusRange(barIndex: number): { from: number; to: number } {
  const from = Math.max(0, barIndex - FOCUS_RANGE_LOOKBACK);
  return { from, to: from + FOCUS_RANGE_BARS };
}

/** Рамка прилипла: левый край там, куда мы его ставили, а не в минусе. */
export function isFocusRangeApplied(
  intended: { from: number; to: number },
  actual: { from: number; to: number } | null,
): boolean {
  if (!actual || !Number.isFinite(actual.from) || !Number.isFinite(actual.to)) return false;
  return Math.abs(actual.from - intended.from) < 0.75;
}
