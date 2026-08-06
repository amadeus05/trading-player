/** Полуоткрытый интервал времени [from, to) в миллисекундах. */
export interface TimeRange {
  from: number;
  to: number;
}

/** Слияние диапазонов: пересекающиеся и смежные склеиваются в один. */
export function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length < 2) return ranges.map((range) => ({ ...range }));
  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  const merged: TimeRange[] = [{ ...sorted[0] }];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** Части `wanted`, не покрытые ни одним из `covered`. */
export function subtractTimeRanges(wanted: TimeRange, covered: TimeRange[]): TimeRange[] {
  let gaps: TimeRange[] = [{ ...wanted }];
  for (const range of covered) {
    const next: TimeRange[] = [];
    for (const gap of gaps) {
      if (range.to <= gap.from || range.from >= gap.to) {
        next.push(gap);
        continue;
      }
      if (range.from > gap.from) next.push({ from: gap.from, to: range.from });
      if (range.to < gap.to) next.push({ from: range.to, to: gap.to });
    }
    gaps = next;
    if (!gaps.length) break;
  }
  return gaps;
}

export function isTimeRangeCovered(wanted: TimeRange, covered: TimeRange[]): boolean {
  return subtractTimeRanges(wanted, covered).length === 0;
}

/** Индекс первого элемента с временем >= target в отсортированном массиве. */
export function lowerBoundByTime(items: { time: number }[], target: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (items[mid].time < target) low = mid + 1;
    else high = mid;
  }
  return low;
}
