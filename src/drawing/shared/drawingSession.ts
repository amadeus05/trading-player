/**
 * Общая state machine создания фигуры кликами: N кликов → commit, с ghost-превью
 * под курсором, отменой (Esc/ПКМ/смена инструмента) и пересчётом ghost при
 * скролле/зуме. Инструмент описывает только конвертацию клика в точку,
 * отрисовку ghost и создание фигуры.
 */

import type { IChartApi } from "lightweight-charts";
import type { DrawingMode, ChartCandleStore } from "./types";
import type { DrawingManager } from "../DrawingManager";
import { bindDrawingPointerClick, type DrawingPointerClickEvent } from "./drawingPointerClick";
import { snapXToNearestCandle, xToSnappedTime, type PixelPoint, type DrawingPoint } from "./coordinates";
import { clampPlotX, getPlotWidth } from "./ManagedDrawingTool";

/** Клик по графику → точка time/price (со снапом X к свече). */
export function drawingPointFromClick(
  event: DrawingPointerClickEvent,
  opts: {
    container: HTMLElement;
    chart: IChartApi;
    series: { coordinateToPrice(y: number): number | null };
    candleStore: ChartCandleStore;
    clampX?: boolean;
  },
): DrawingPoint | null {
  const rect = opts.container.getBoundingClientRect();
  let x = event.sourceEvent.clientX - rect.left;
  const y = event.sourceEvent.clientY - rect.top;
  if (opts.clampX) x = clampPlotX(x, getPlotWidth(opts.chart));
  const time = xToSnappedTime(opts.chart, x, opts.candleStore.candles);
  const price = opts.series.coordinateToPrice(y);
  if (time == null || price == null || price <= 0) return null;
  return { time, price };
}

export interface DrawingSessionOptions<P> {
  mode: DrawingMode | readonly DrawingMode[];
  manager: DrawingManager;
  container: HTMLElement;
  chart: IChartApi;
  /** Сколько кликов собирает сессия (2 — линия/прямоугольник, 3 — канал). */
  pointCount: number;
  /** Клик → точка; null — клик игнорируется. */
  pointFromClick: (event: DrawingPointerClickEvent) => P | null;
  /** Дополнительный фильтр кликов (например, клики по handle другой фигуры). */
  ignoreClick?: (event: DrawingPointerClickEvent) => boolean;
  /**
   * Превью по собранным точкам и позиции курсора (пиксели контейнера,
   * X снапится к свече). Ghost-элементы создаются лениво здесь же.
   */
  ghostUpdate: (points: P[], cursor: PixelPoint) => void;
  ghostRemove: () => void;
  /** false на финальном клике — сброс сессии без создания фигуры (rectangle: слишком маленький drag). */
  shouldCommit?: (points: P[]) => boolean;
  /** Создание фигуры; cursor — пиксели финального клика (нужен каналу для widthPoint). */
  commit: (points: P[], cursor: PixelPoint) => void;
  /** callbacks.onDrawingComplete — вызывается после commit и при не-тихой отмене. */
  onComplete: () => void;
  /** Ограничивать X курсора шириной плота (rectangle, volume profile). */
  clampCursorX?: boolean;
}

export interface DrawingSession {
  isActive(): boolean;
  /** Отмена незавершённого рисования; silent — без onComplete (смена инструмента). */
  cancel(silent?: boolean): boolean;
  destroy(): void;
}

export function createDrawingSession<P>(options: DrawingSessionOptions<P>): DrawingSession {
  let points: P[] = [];
  let lastCursor: PixelPoint | null = null;
  let ghostRaf = 0;

  const cursorFromClient = (clientX: number, clientY: number): PixelPoint => {
    const rect = options.container.getBoundingClientRect();
    let x = clientX - rect.left;
    if (options.clampCursorX) x = clampPlotX(x, getPlotWidth(options.chart));
    return { x: snapXToNearestCandle(options.chart, x), y: clientY - rect.top };
  };

  const flushGhost = () => {
    ghostRaf = 0;
    if (points.length && lastCursor) options.ghostUpdate(points, lastCursor);
  };
  const scheduleGhost = () => {
    if (!ghostRaf) ghostRaf = requestAnimationFrame(flushGhost);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!points.length) return;
    lastCursor = cursorFromClient(event.clientX, event.clientY);
    scheduleGhost();
  };

  const reset = () => {
    points = [];
    lastCursor = null;
    if (ghostRaf) {
      cancelAnimationFrame(ghostRaf);
      ghostRaf = 0;
    }
    window.removeEventListener("pointermove", onPointerMove);
    options.ghostRemove();
  };

  const onClick = (event: DrawingPointerClickEvent) => {
    if (options.ignoreClick?.(event)) return;
    const point = options.pointFromClick(event);
    if (point == null) return;
    const cursor = cursorFromClient(event.sourceEvent.clientX, event.sourceEvent.clientY);

    if (points.length + 1 < options.pointCount) {
      if (!points.length) window.addEventListener("pointermove", onPointerMove);
      points.push(point);
      lastCursor = cursor;
      options.ghostUpdate(points, cursor);
      return;
    }

    const all = [...points, point];
    reset();
    if (options.shouldCommit && !options.shouldCommit(all)) return;
    options.commit(all, cursor);
    options.onComplete();
  };

  const unbindClick = bindDrawingPointerClick({
    container: options.container,
    chart: options.chart,
    manager: options.manager,
    mode: options.mode,
    onClick,
  });

  // Скролл/зум во время рисования — ghost пересчитывается под последний курсор.
  const onViewportChange = () => {
    if (points.length && lastCursor) scheduleGhost();
  };
  options.chart.timeScale().subscribeVisibleLogicalRangeChange(onViewportChange);

  return {
    isActive: () => points.length > 0,
    cancel(silent = false) {
      if (!points.length) return false;
      reset();
      if (!silent) options.onComplete();
      return true;
    },
    destroy() {
      reset();
      unbindClick();
      // На teardown график может быть уже уничтожен (chart.remove() в React cleanup).
      try {
        options.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onViewportChange);
      } catch { /* noop */ }
    },
  };
}
