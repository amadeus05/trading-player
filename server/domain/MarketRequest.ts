export type MarketCategory = "linear" | "inverse" | "spot";

export interface DownloadRequest {
  category: MarketCategory;
  symbol: string;
  from: number;
  to: number;
}

export function normalizeRequest(input: Partial<DownloadRequest>): DownloadRequest {
  const category = input.category ?? "linear";
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const from = Number(input.from);
  const to = Number(input.to);
  if (!symbol || !["linear", "inverse", "spot"].includes(category)) throw new Error("Invalid market");
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Invalid [from, to) interval");
  return { category, symbol, from, to };
}
