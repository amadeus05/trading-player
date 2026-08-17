export const MAX_TRADE_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

export function normalizeTradeTag(raw: string): string | null {
  const tag = raw.trim().replace(/\s+/g, " ");
  if (!tag) return null;
  return tag.slice(0, MAX_TAG_LENGTH);
}

export function normalizeTradeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTradeTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= MAX_TRADE_TAGS) break;
  }
  return result;
}

export function tradeHasTag(trade: { tags?: string[] }, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return false;
  return (trade.tags ?? []).some((item) => item.toLowerCase() === needle);
}

export function collectKnownTags(trades: Array<{ tags?: string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const trade of trades) {
    for (const tag of trade.tags ?? []) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right, "ru"));
}
