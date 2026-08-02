import type { AccountSettings, Barrier, Persisted, SimulationSettings } from "../../types";

export const PAPER_BALANCE_USDT = 1_000;

export const TIMEFRAME_OPTIONS = [5, 15, 30, 60, 180, 240, 1_440] as const;
export const DEFAULT_TIMEFRAME_MINUTES = 15;

/**
 * Свеча, на которой плеер стоит при открытии рынка и после сброса.
 *
 * Совпадает с тем, сколько истории рамка показывает слева от головы, и с
 * REPLAY_BACK_TIMEFRAME_BARS — глубиной предыстории, которую грузит прыжок.
 * Благодаря этому открытие выглядит ровно как прыжок на случайную свечу:
 * первая свеча ложится на левый край, голова стоит на 80% ширины, справа
 * остаётся зазор. При большем значении часть свечей уезжала за левый край.
 */
export const REPLAY_START_BAR_INDEX = 80;

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
