export const DEFAULT_ORDER_MARGIN = 100;

export function allocationPercentFromMargin(margin: number, available: number): number {
  if (!(available > 0) || !(margin > 0)) return 0;
  return Math.min(100, margin / available * 100);
}

/**
 * Кламп тикета к доступной марже. Ноль доступного не затирает размер:
 * иначе после закрытия позиции Available уже есть, а Long/Short остаются
 * серыми, потому что orderValue так и лежит нулём.
 */
export function resolveTicketMargin(
  currentMargin: number,
  affordable: number,
  fallback = DEFAULT_ORDER_MARGIN,
): number {
  if (!(affordable > 0)) return currentMargin;
  if (currentMargin > affordable + 1e-9) return affordable;
  if (!(currentMargin > 0)) return Math.min(fallback, affordable);
  return currentMargin;
}
