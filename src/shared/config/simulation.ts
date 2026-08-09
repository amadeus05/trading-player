import type { AccountSettings, Barrier, Persisted, SimulationSettings } from "../../types";

export const PAPER_BALANCE_USDT = 1_000;

/**
 * Разрешение, в котором скачивается и хранится история. Мельче данных нет, и
 * от него зависит, какие таймфреймы вообще собираются: 7m кратен минуте, но не
 * пяти, поэтому на пятиминутной базе он был бы недоступен.
 */
export const BASE_TIMEFRAME_MINUTES = 1;

export const TIMEFRAME_OPTIONS = [1, 5, 7, 10, 15, 30, 60, 120, 180, 240, 1_440] as const;
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
  showFairValueGaps: false,
  followCandle: false,
  /** true — вкладка Trade всегда видна при свёрнутой панели; false — выезжает от правого края. */
  tradePanelTabPinned: true,
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
