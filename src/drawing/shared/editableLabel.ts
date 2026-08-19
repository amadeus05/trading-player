/**
 * Общий inline-редактируемый лейбл поверх графика (trend line, rectangle, …).
 * Модуль владеет DOM-элементами лейблов и всей edit-механикой (placeholder,
 * caret, commit/cancel); позиционирование и правила видимости остаются
 * за инструментом.
 *
 * Подсказка никогда не живёт в textContent: иначе contentEditable даёт ходить
 * по ней стрелками и стирать по буквам, как настоящий текст. Рисуем её через
 * CSS ::before, а поле при открытии оставляем пустым.
 */

export const LABEL_PLACEHOLDER = "+ Add text";
/**
 * Подсказка внутри открытого редактора. Плюс — это приглашение «добавить», и
 * когда поле уже открыто, он лишний.
 */
const LABEL_PLACEHOLDER_EDITING = "Add text";
/**
 * Приглушённый серый из палитры рисования. Подсказка — это разметка, а не
 * содержание: почти белый #d1d4dc читался как настоящая надпись на линии.
 */
const PLACEHOLDER_COLOR = "#787b86";

const PLACEHOLDER_NAV_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Backspace",
  "Delete",
]);

export interface EditableLabelStoreOptions {
  container: HTMLElement;
  className: string;
  /** Разрешено ли сейчас начинать редактирование (режим менеджера, locked и т.д.). */
  canEdit: (id: string) => boolean;
  getText: (id: string) => string;
  getTextColor: (id: string) => string;
  /** Вызывается перед открытием редактора (выделить фигуру, пересинхронизировать позицию). */
  onBeforeEdit?: (id: string) => void;
  onCommit: (id: string, value: string) => void;
  /** Отмена по Escape — инструмент должен пересинхронизировать лейбл. */
  onCancel: (id: string) => void;
}

export type EditableLabelContentState = "editing" | "hidden" | "visible";

export interface EditableLabelStore {
  /** Возвращает (создавая при необходимости) элемент лейбла для фигуры. */
  ensure(id: string): HTMLDivElement;
  get(id: string): HTMLDivElement | undefined;
  isEditing(id: string): boolean;
  startEdit(id: string): void;
  /** Коммитит активный редактор, если он открыт. */
  commitActive(): void;
  /**
   * Обновляет текст/цвет/placeholder. Возвращает состояние: инструмент сам
   * решает, что делать с display и позицией ("hidden" — текста нет и фигура
   * не выделена).
   */
  syncContent(id: string, selected: boolean): EditableLabelContentState;
  remove(id: string): void;
  destroy(): void;
}

function placeCaretAtStart(el: HTMLElement) {
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Двойной rAF: даём браузеру применить focus/contentEditable перед установкой caret. */
function placeCaretAtStartDeferred(el: HTMLElement) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => placeCaretAtStart(el));
  });
}

function isPlaceholderHint(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || trimmed === LABEL_PLACEHOLDER || trimmed === LABEL_PLACEHOLDER_EDITING;
}

export function normalizeLabelValue(raw: string): string {
  return raw.replaceAll(LABEL_PLACEHOLDER, "").replaceAll(LABEL_PLACEHOLDER_EDITING, "").trim();
}

export function createEditableLabelStore(options: EditableLabelStoreOptions): EditableLabelStore {
  const labels = new Map<string, HTMLDivElement>();
  let editingId: string | null = null;

  function showPlaceholder(el: HTMLDivElement) {
    el.textContent = "";
    el.classList.add("is-placeholder");
    el.style.color = PLACEHOLDER_COLOR;
  }

  function clearPlaceholder(el: HTMLDivElement, id: string) {
    el.classList.remove("is-placeholder");
    el.style.color = options.getTextColor(id);
  }

  function commitEdit(id: string) {
    if (editingId !== id) return;
    const el = labels.get(id);
    editingId = null;
    if (!el) return;
    el.contentEditable = "false";
    el.classList.remove("is-editing");
    // Пустой лейбл узнаём по классу, а не по совпадению строки: класс снимается
    // на первом же введённом символе. Вырезание текста подсказки затёрло бы
    // ввод у того, кто честно напечатал «Add text».
    const untouched = el.classList.contains("is-placeholder") || isPlaceholderHint(el.textContent ?? "");
    options.onCommit(id, untouched ? "" : normalizeLabelValue(el.textContent ?? ""));
  }

  function cancelEdit(id: string) {
    if (editingId !== id) return;
    editingId = null;
    options.onCancel(id);
  }

  function build(id: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = options.className;
    el.dataset.placeholder = LABEL_PLACEHOLDER;
    el.dataset.placeholderEditing = LABEL_PLACEHOLDER_EDITING;

    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      // По настоящему тексту клик ставит каретку в место нажатия. По пустому
      // полю браузер тоже пытается тыкать «внутрь» подсказки, если она лежит
      // в DOM — отменяем default, фокус и каретку ставим сами.
      if (!options.getText(id).trim()) event.preventDefault();
      startEdit(id);
    });
    el.addEventListener("focus", () => {
      if (editingId !== id) return;
      if (!el.classList.contains("is-placeholder")) return;
      placeCaretAtStartDeferred(el);
    });
    el.addEventListener("beforeinput", (event) => {
      if (editingId !== id) return;
      if (!el.classList.contains("is-placeholder")) return;
      // Стирать и перемещать нечего: подсказки в поле нет. Delete/Backspace
      // иначе могли бы проглотить служебный <br>, который Chrome суёт в пустой
      // contentEditable, и подсказка мигала бы.
      if (event.inputType.startsWith("delete") || event.inputType === "historyUndo") {
        event.preventDefault();
        return;
      }
      if (!event.inputType.startsWith("insert")) return;
      clearPlaceholder(el, id);
    });
    // Страховка: вставка из буфера и IME не всегда дают data в beforeinput.
    el.addEventListener("input", () => {
      if (editingId !== id) return;
      if (!el.classList.contains("is-placeholder")) return;
      if (isPlaceholderHint(el.textContent ?? "")) return;
      clearPlaceholder(el, id);
    });
    el.addEventListener("keydown", (event) => {
      if (editingId !== id) return;
      if (event.key === "Enter") {
        event.preventDefault();
        el.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit(id);
        return;
      }
      if (el.classList.contains("is-placeholder") && PLACEHOLDER_NAV_KEYS.has(event.key)) {
        event.preventDefault();
      }
    });
    el.addEventListener("blur", () => {
      if (editingId === id) commitEdit(id);
    });

    options.container.appendChild(el);
    labels.set(id, el);
    return el;
  }

  function startEdit(id: string) {
    if (!options.canEdit(id)) return;
    // Уже редактируем этот лейбл — выходим. Второй клик двойного клика снова
    // звал бы startEdit, а тот через два кадра ставит схлопнутую каретку и тем
    // самым убивал выделение слова, которое браузер только что сделал. По той
    // же причине не работало и тройное нажатие «выделить всё».
    if (editingId === id) return;
    if (editingId && editingId !== id) commitEdit(editingId);
    options.onBeforeEdit?.(id);
    const el = labels.get(id) ?? build(id);

    const hasText = Boolean(options.getText(id).trim());
    if (!hasText) showPlaceholder(el);
    else clearPlaceholder(el, id);

    editingId = id;
    el.classList.add("is-editing");
    el.contentEditable = "true";
    el.focus({ preventScroll: true });
    if (!hasText) placeCaretAtStartDeferred(el);
  }

  return {
    ensure: (id) => labels.get(id) ?? build(id),
    get: (id) => labels.get(id),
    isEditing: (id) => editingId === id,
    startEdit,
    commitActive: () => {
      if (editingId) commitEdit(editingId);
    },
    syncContent(id, selected) {
      const el = labels.get(id) ?? build(id);
      if (editingId === id) return "editing";

      const text = options.getText(id);
      const hasText = Boolean(text.trim());
      const showHint = selected && !hasText;
      if (!hasText && !showHint) return "hidden";

      el.contentEditable = "false";
      el.classList.remove("is-editing");
      if (hasText) {
        el.textContent = text;
        clearPlaceholder(el, id);
      } else {
        showPlaceholder(el);
      }
      return "visible";
    },
    remove(id) {
      if (editingId === id) editingId = null;
      labels.get(id)?.remove();
      labels.delete(id);
    },
    destroy() {
      editingId = null;
      for (const el of labels.values()) el.remove();
      labels.clear();
    },
  };
}
