import type { AccountSettings, Barrier, Persisted, SimulationSettings } from "../../types";

export const PAPER_BALANCE_USDT = 1_000;

export const TIMEFRAME_OPTIONS = [5, 15, 30, 60, 180, 240, 1_440] as const;
export const DEFAULT_TIMEFRAME_MINUTES = 15;

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  makerFeePct: 0.02,
  takerFeePct: 0.055,
  slippagePct: 0.02,
  stopSlippagePct: 0.05,
  showClosedTradeOverlays: true,
  showTradingSessions: false,
  followCandle: false,
  ambiguousExitPolicy: "conservative",
};

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  initialBalance: PAPER_BALANCE_USDT,
  quoteAsset: "USDT",
};

export const INITIAL_PLAYER_STATE: Persisted = {
  datasets: [],
  trades: [],
  annotations: [],
  horizontalLines: [],
  settings: DEFAULT_SIMULATION_SETTINGS,
  account: DEFAULT_ACCOUNT_SETTINGS,
};

export const NO_BARRIERS: Barrier[] = [];
