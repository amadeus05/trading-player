/**
 * Общий inline-редактируемый лейбл поверх графика (trend line, rectangle, …).
 * Модуль владеет DOM-элементами лейблов и всей edit-механикой (placeholder,
 * caret, commit/cancel); позиционирование и правила видимости остаются
 * за инструментом.
 */

export const LABEL_PLACEHOLDER = "+ Add text";
/**
 * Подсказка внутри открытого редактора. Плюс — это приглашение «добавить», и
 * когда поле уже открыто, он лишний: пользователь стоит курсором перед ним и
 * начинает печатать прямо в него.
 */
const LABEL_PLACEHOLDER_EDITING = "Add text";
/**
 * Приглушённый серый из палитры рисования. Подсказка — это разметка, а не
 * содержание: почти белый #d1d4dc читался как настоящая надпись на линии.
 */
const PLACEHOLDER_COLOR = "#787b86";

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
  /** Куда ставить caret при открытии пустого лейбла (у placeholder). */
  emptyCaretAtEnd?: boolean;
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

function placeCaret(el: HTMLElement, atEnd: boolean) {
  const range = document.createRange();
  const selection = window.getSelection();
  const textNode = el.firstChild;
  if (textNode?.nodeType === Node.TEXT_NODE) {
    const offset = atEnd ? (textNode.textContent?.length ?? 0) : 0;
    range.setStart(textNode, offset);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Двойной rAF: даём браузеру применить focus/contentEditable перед установкой caret. */
function placeCaretDeferred(el: HTMLElement, atEnd: boolean) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => placeCaret(el, atEnd));
  });
}

export function normalizeLabelValue(raw: string): string {
  return raw.replaceAll(LABEL_PLACEHOLDER, "").trim();
}

export function createEditableLabelStore(options: EditableLabelStoreOptions): EditableLabelStore {
  const labels = new Map<string, HTMLDivElement>();
  let editingId: string | null = null;

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
    const untouched = el.classList.contains("is-placeholder");
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

    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      // По placeholder браузер тоже ставит каретку — по месту нажатия, то есть
      // в середину подсказки. Наша установка идёт отложенно, через два кадра, и
      // кто окажется последним, зависит от везения: иногда курсор оказывался
      // между буквами «+ Add text». Отменяем поведение по умолчанию, фокус
      // ставим сами ниже. Для непустого лейбла не мешаем: там клик по месту —
      // это ровно то, что нужно.
      if (!options.getText(id).trim()) event.preventDefault();
      startEdit(id);
    });
    el.addEventListener("focus", () => {
      if (editingId !== id) return;
      placeCaretDeferred(el, true);
    });
    el.addEventListener("beforeinput", (event) => {
      if (editingId !== id) return;
      if (!el.classList.contains("is-placeholder")) return;
      if (!event.inputType.startsWith("insert")) return;
      const data = (event as InputEvent).data;
      if (!data) return;
      event.preventDefault();
      el.textContent = data;
      el.classList.remove("is-placeholder");
      el.style.color = options.getTextColor(id);
      placeCaret(el, true);
    });
    // Страховка на всё, что не проходит через beforeinput выше: вставка из
    // буфера приходит без data, и без этого класс подсказки остался бы висеть,
    // а commitEdit счёл бы лейбл нетронутым и выбросил вставленный текст.
    el.addEventListener("input", () => {
      if (editingId !== id) return;
      if (!el.classList.contains("is-placeholder")) return;
      const text = el.textContent ?? "";
      if (text === LABEL_PLACEHOLDER_EDITING || text === LABEL_PLACEHOLDER) return;
      el.classList.remove("is-placeholder");
      el.style.color = options.getTextColor(id);
    });
    el.addEventListener("keydown", (event) => {
      if (editingId !== id) return;
      if (event.key === "Enter") {
        event.preventDefault();
        el.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit(id);
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
    if (editingId && editingId !== id) commitEdit(editingId);
    options.onBeforeEdit?.(id);
    const el = labels.get(id) ?? build(id);

    const hasText = Boolean(options.getText(id).trim());
    if (!hasText) {
      el.textContent = LABEL_PLACEHOLDER_EDITING;
      el.classList.add("is-placeholder");
      el.style.color = PLACEHOLDER_COLOR;
    }

    editingId = id;
    el.classList.add("is-editing");
    el.contentEditable = "true";
    el.focus({ preventScroll: true });
    placeCaretDeferred(el, hasText || (options.emptyCaretAtEnd ?? true));
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
      const showPlaceholder = selected && !hasText;
      if (!hasText && !showPlaceholder) return "hidden";

      el.contentEditable = "false";
      el.classList.remove("is-editing");
      el.style.color = hasText ? options.getTextColor(id) : PLACEHOLDER_COLOR;
      el.textContent = hasText ? text : LABEL_PLACEHOLDER;
      el.classList.toggle("is-placeholder", showPlaceholder);
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
