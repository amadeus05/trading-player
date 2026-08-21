import type { Trade } from "../../types";

export type JournalTradeSortKey = "entryTime" | "placedAt";
export type JournalTradeSortDir = "asc" | "desc";
export type JournalTradeSort = { key: JournalTradeSortKey; dir: JournalTradeSortDir };

const STORAGE_KEY = "player:journal-trade-sort";

/** По умолчанию сверху то, что открыли последним у себя, а не самая поздняя свеча. */
export const DEFAULT_JOURNAL_TRADE_SORT: JournalTradeSort = {
  key: "placedAt",
  dir: "desc",
};

const isSortKey = (value: unknown): value is JournalTradeSortKey =>
  value === "entryTime" || value === "placedAt";

const isSortDir = (value: unknown): value is JournalTradeSortDir =>
  value === "asc" || value === "desc";

export function loadJournalTradeSort(): JournalTradeSort {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_JOURNAL_TRADE_SORT;
    const parsed = JSON.parse(raw) as { key?: unknown; dir?: unknown };
    if (!isSortKey(parsed.key) || !isSortDir(parsed.dir)) return DEFAULT_JOURNAL_TRADE_SORT;
    return { key: parsed.key, dir: parsed.dir };
  } catch {
    return DEFAULT_JOURNAL_TRADE_SORT;
  }
}

export function saveJournalTradeSort(sort: JournalTradeSort): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
}

export function nextJournalTradeSort(
  current: JournalTradeSort,
  key: JournalTradeSortKey,
): JournalTradeSort {
  if (current.key === key) {
    return { key, dir: current.dir === "desc" ? "asc" : "desc" };
  }
  return { key, dir: "desc" };
}

function sortValue(trade: Trade, key: JournalTradeSortKey): number | null {
  if (key === "entryTime") return trade.entryTime;
  return trade.placedAt ?? null;
}

export function sortJournalTrades(trades: Trade[], sort: JournalTradeSort): Trade[] {
  return [...trades].sort((left, right) => {
    const leftValue = sortValue(left, sort.key);
    const rightValue = sortValue(right, sort.key);
    if (leftValue == null && rightValue == null) {
      const fallback = sort.dir === "asc"
        ? left.entryTime - right.entryTime
        : right.entryTime - left.entryTime;
      return fallback || left.id.localeCompare(right.id);
    }
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const delta = sort.dir === "asc" ? leftValue - rightValue : rightValue - leftValue;
    return delta || left.id.localeCompare(right.id);
  });
}
