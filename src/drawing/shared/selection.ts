/**
 * Общий контроллер выделения для инструментов рисования: select/deselect,
 * снятие выделения кликом по фону, реакция на удаление/purge. Инструмент
 * оставляет за собой только рендер (onShow/onHide тулбара) и DOM своих фигур.
 */

import type { DrawingManager, DrawingSelectionKind } from "../DrawingManager";

/**
 * Плавающие UI-элементы поверх графика (тулбары, меню, палитры, панели).
 * Единый список: клик по ним не должен ни снимать выделение, ни ставить
 * точку в режиме рисования. Новый попап добавляется только сюда.
 */
export const DRAWING_UI_SELECTOR = [
  ".rect-toolbar",
  ".trend-toolbar",
  ".hline-toolbar",
  ".vp-toolbar",
  ".rect-line-menu",
  ".rect-templates-menu",
  ".rect-palette",
  ".measure-tooltip",
  ".drawing-settings-panel",
  ".vp-panel",
].join(", ");

export interface SelectionControllerOptions<T> {
  kind: DrawingSelectionKind;
  manager: DrawingManager;
  container: HTMLElement;
  findById: (id: string) => T | undefined;
  /** SVG-элемент фигуры для подсветки выделения менеджером. */
  getSelectionElement?: (id: string) => SVGElement | null;
  /** Показать тулбар/панель для выделенной фигуры. */
  onShow: (item: T) => void;
  /** Скрыть тулбар/панель (и закоммитить открытые редакторы). */
  onHide: () => void;
  /** Внешний коллбек об изменении выделения (опционально). */
  onChange?: (id: string | null) => void;
  syncAll: () => void;
  /** Интерактивные элементы самой фигуры (hit-area, handles, лейблы) — клик по ним не снимает выделение. */
  ignoreSelector: string;
  /** true — снимать выделение кликом по фону и в режиме рисования (horizontal line). */
  deselectWhileDrawing?: boolean;
  /** Восстановленное выделение (без показа тулбара и активации в менеджере). */
  initialSelectedId?: string | null;
}

export interface SelectionController {
  getSelectedId(): string | null;
  isSelected(id: string): boolean;
  select(id: string | null): void;
  /** Для manager.registerDeselect: снять выделение без обратного вызова clearSelection. */
  handleManagerDeselect(): void;
  /** Вызвать после удаления фигуры — сбрасывает выделение, если удалена выделенная. */
  handleDeleted(id: string): void;
  /** Вызвать при purge всех фигур инструмента. */
  reset(): void;
  destroy(): void;
}

export function createSelectionController<T>(options: SelectionControllerOptions<T>): SelectionController {
  let selectedId: string | null = options.initialSelectedId ?? null;

  function clearLocal() {
    selectedId = null;
    options.onChange?.(null);
    options.onHide();
  }

  function select(id: string | null) {
    if (!id) {
      if (selectedId !== null) {
        clearLocal();
        options.syncAll();
      }
      options.manager.clearSelection(options.kind);
      return;
    }
    selectedId = id;
    options.onChange?.(id);
    const item = options.findById(id);
    if (item) options.onShow(item);
    options.manager.activateSelection(options.kind, options.getSelectionElement?.(id) ?? null, id);
    options.syncAll();
  }

  const onBackgroundPointerDown = (event: PointerEvent) => {
    if (!options.deselectWhileDrawing && options.manager.getMode() !== "none") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(DRAWING_UI_SELECTOR) || target.closest(options.ignoreSelector)) return;
    if (selectedId) select(null);
  };
  options.container.addEventListener("pointerdown", onBackgroundPointerDown);

  return {
    getSelectedId: () => selectedId,
    isSelected: (id) => selectedId === id,
    select,
    handleManagerDeselect() {
      if (selectedId === null) return;
      clearLocal();
      options.syncAll();
    },
    handleDeleted(id) {
      if (selectedId !== id) return;
      clearLocal();
      options.manager.clearSelection(options.kind);
    },
    reset() {
      if (selectedId !== null) clearLocal();
      options.manager.clearSelection(options.kind);
    },
    destroy() {
      options.container.removeEventListener("pointerdown", onBackgroundPointerDown);
    },
  };
}
