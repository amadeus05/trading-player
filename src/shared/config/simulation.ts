import type { AccountSettings, Barrier, Persisted, SimulationSettings } from "../../types";

export const PAPER_BALANCE_USDT = 1_000;

/**
 * Разрешение, в котором скачивается и хранится история. Мельче данных нет, и
 * от него зависит, какие таймфреймы вообще собираются: 7m кратен минуте, но не
 * пяти, поэтому на пятиминутной базе он был бы недоступен.
 */
export const BASE_TIMEFRAME_MINUTES = 1;

/**
 * Закреплённые по умолчанию, как избранное в TradingView.
 * Пользователь меняет набор через «Редактировать»; остальное — в «Доступно».
 */
export const DEFAULT_PINNED_TIMEFRAMES = [1, 5, 15, 60, 240] as const;

export const TIMEFRAME_OPTIONS = [1, 3, 5, 7, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1_440] as const;
export type TimeframeOption = (typeof TIMEFRAME_OPTIONS)[number];
export const DEFAULT_TIMEFRAME_MINUTES = 15;

const PINNED_STORAGE_KEY = "player:pinned-timeframes";

export function isTimeframeOption(value: number): value is TimeframeOption {
  return (TIMEFRAME_OPTIONS as readonly number[]).includes(value);
}

export function sanitizePinnedTimeframes(values: unknown): TimeframeOption[] {
  if (!Array.isArray(values)) return [...DEFAULT_PINNED_TIMEFRAMES];
  const unique: TimeframeOption[] = [];
  for (const value of values) {
    if (typeof value !== "number" || !isTimeframeOption(value) || unique.includes(value)) continue;
    unique.push(value);
  }
  if (!unique.length) return [...DEFAULT_PINNED_TIMEFRAMES];
  return unique.sort((left, right) => left - right);
}

export function sortTimeframes<T extends number>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left - right);
}

export function availableTimeframes(pinned: readonly number[]): TimeframeOption[] {
  const set = new Set(pinned);
  return TIMEFRAME_OPTIONS.filter((value) => !set.has(value));
}

export function loadPinnedTimeframes(): TimeframeOption[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINNED_TIMEFRAMES];
    return sanitizePinnedTimeframes(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_PINNED_TIMEFRAMES];
  }
}

export function savePinnedTimeframes(values: readonly number[]): TimeframeOption[] {
  const next = sanitizePinnedTimeframes(values);
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
  return next;
}

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
  /** true — вкладка Trade всегда видна при свёрнутой панели; false — выезжает от правого края. */
  tradePanelTabPinned: true,
  headerStatsVariant: "ticker",
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
