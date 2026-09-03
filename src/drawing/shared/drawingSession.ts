/**
 * Общая state machine создания фигуры кликами: N кликов → commit, с ghost-превью
 * под курсором, отменой (Esc/ПКМ/смена инструмента) и пересчётом ghost при
 * скролле/зуме. Инструмент описывает только конвертацию клика в точку,
 * отрисовку ghost и создание фигуры.
 */

import type { IChartApi } from "lightweight-charts";
import type { DrawingMode, ChartCandleStore, SeriesApiLike } from "./types";
import type { DrawingManager } from "../DrawingManager";
import { bindDrawingPointerClick, type DrawingPointerClickEvent } from "./drawingPointerClick";
import { type PixelPoint, type DrawingPoint } from "./coordinates";
import { getPlotWidth } from "./ManagedDrawingTool";
import { magnetPlotHeight, snapPixelsWithMagnet } from "./magnet";

/** Клик по графику → точка time/price (со снапом X к свече и магнитом к OHLC). */
export function drawingPointFromClick(
  event: DrawingPointerClickEvent,
  opts: {
    container: HTMLElement;
    chart: IChartApi;
    series: SeriesApiLike;
    candleStore: ChartCandleStore;
    manager: DrawingManager;
    clampX?: boolean;
  },
): DrawingPoint | null {
  const rect = opts.container.getBoundingClientRect();
  const x = event.sourceEvent.clientX - rect.left;
  const y = event.sourceEvent.clientY - rect.top;
  const snap = snapPixelsWithMagnet(
    opts.manager,
    opts.chart,
    opts.series,
    opts.candleStore.candles,
    x,
    y,
    magnetPlotHeight(opts.container, opts.chart),
    opts.clampX ? { clampX: true, plotWidth: getPlotWidth(opts.chart) } : undefined,
  );
  if (snap.time == null || snap.price == null || snap.price <= 0) return null;
  return { time: snap.time, price: snap.price };
}

export interface DrawingSessionOptions<P> {
  mode: DrawingMode | readonly DrawingMode[];
  manager: DrawingManager;
  container: HTMLElement;
  chart: IChartApi;
  series: SeriesApiLike;
  candleStore: ChartCandleStore;
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
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const snap = snapPixelsWithMagnet(
      options.manager,
      options.chart,
      options.series,
      options.candleStore.candles,
      x,
      y,
      magnetPlotHeight(options.container, options.chart),
      options.clampCursorX ? { clampX: true, plotWidth: getPlotWidth(options.chart) } : undefined,
    );
    return { x: snap.x, y: snap.y };
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
