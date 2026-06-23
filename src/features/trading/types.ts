export type OrderType = "MARKET" | "LIMIT";
export type AmountUnit = "USDT" | "COIN";

export interface TradeEditDraft {
  id: string;
  entry: number;
  tp: number;
  sl: number;
}
