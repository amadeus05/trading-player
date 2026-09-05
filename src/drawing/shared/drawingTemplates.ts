import type { FibonacciLevel } from "../../types";
import { getDefaultFibLevels } from "../fibonacci/fibLevels";
import type { DrawingLineStyle } from "./DrawingToolbar";

export type DrawingTemplateKind =
  | "trendline"
  | "horizontalline"
  | "rectangle"
  | "fibonacci"
  | "fibtrendext"
  | "parallelchannel";

export interface DrawingTemplateState {
  lineColor: string;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  text?: string;
  showLabel?: boolean;
  width: number;
  style: DrawingLineStyle;
  /** Уровни Fibonacci (вкл/выкл, цвет, значение) — для шаблонов fib. */
  levels?: FibonacciLevel[];
}

export interface DrawingTemplate {
  id: string;
  kind: DrawingTemplateKind;
  name: string;
  state: DrawingTemplateState;
  createdAt: number;
}

/** Оформление без содержимого: то, что переносится на следующую фигуру. */
export type DrawingStyleState = Omit<DrawingTemplateState, "text" | "showLabel">;

interface DrawingTemplatesStore {
  templates: DrawingTemplate[];
  /** Последнее выбранное оформление по каждому типу фигуры. */
  lastStyles: Partial<Record<DrawingTemplateKind, Partial<DrawingStyleState>>>;
}

const STORAGE_KEY = "player:drawing-templates";

const DEFAULTS: Record<DrawingTemplateKind, DrawingTemplateState> = {
  trendline: {
    lineColor: "#ff4976",
    textColor: "#ff4976",
    width: 2,
    style: "solid",
  },
  horizontalline: {
    lineColor: "#ff4976",
    width: 2,
    style: "solid",
  },
  rectangle: {
    lineColor: "#00c853",
    // Тёмный из первого ряда палитры: заливка почти сливается с графиком и не
    // мешает читать свечи внутри зоны, а границу держит цветная рамка.
    fillColor: "#131722",
    fillOpacity: 20,
    textColor: "#ffffff",
    width: 2,
    style: "solid",
  },
  fibonacci: {
    lineColor: "#787b86",
    width: 1,
    style: "solid",
    showLabel: true,
  },
  fibtrendext: {
    lineColor: "#787b86",
    width: 1,
    style: "solid",
  },
  parallelchannel: {
    lineColor: "#d1d4dc",
    fillColor: "#787b86",
    fillOpacity: 20,
    width: 1,
    style: "solid",
  },
};

function ensureTemplateIds(templates: DrawingTemplate[]): { templates: DrawingTemplate[]; changed: boolean } {
  const seen = new Set<string>();
  let changed = false;
  const next = templates.map((item) => {
    let id = item.id;
    if (!id || seen.has(id)) {
      id = crypto.randomUUID();
      changed = true;
    }
    seen.add(id);
    return id === item.id ? item : { ...item, id };
  });
  return { templates: next, changed };
}

function readStore(): DrawingTemplatesStore {
  const empty: DrawingTemplatesStore = { templates: [], lastStyles: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<DrawingTemplatesStore>;
    if (!Array.isArray(parsed.templates)) return empty;
    const { templates, changed } = ensureTemplateIds(parsed.templates);
    const store: DrawingTemplatesStore = {
      templates,
      // Ключ появился позже шаблонов — у прежних пользователей его в хранилище нет.
      lastStyles: parsed.lastStyles ?? {},
    };
    if (changed) writeStore(store);
    return store;
  } catch {
    return empty;
  }
}

function writeStore(store: DrawingTemplatesStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Заводское оформление. Им же отвечает пункт «Применить шаблон по умолчанию». */
export function getDefaultDrawingTemplateState(kind: DrawingTemplateKind): DrawingTemplateState {
  const base = { ...DEFAULTS[kind] };
  if (kind === "fibonacci") {
    base.levels = getDefaultFibLevels();
  }
  return base;
}

/**
 * Оформление для новой фигуры: последнее выбранное, а поверх него заводское для
 * всего, что пользователь не трогал.
 *
 * Выбрал красную пунктирную линию — следующие такие же, пока не поменяешь.
 * Раньше каждая новая фигура начиналась с заводских настроек, и оформление
 * приходилось назначать заново.
 */
export function getNewDrawingStyle(kind: DrawingTemplateKind): DrawingTemplateState {
  const last = readStore().lastStyles[kind];
  const base = getDefaultDrawingTemplateState(kind);
  if (!last) return base;
  return {
    ...base,
    ...last,
    ...(last.levels?.length ? { levels: last.levels.map((level) => ({ ...level })) } : {}),
  };
}

/**
 * Запоминает оформление, выбранное в панели. Содержимое сюда не попадает:
 * текст и признак показа подписи принадлежат конкретной фигуре, а блокировка —
 * это состояние, а не стиль, и переносить их на следующие фигуры нельзя.
 */
export function rememberDrawingStyle(
  kind: DrawingTemplateKind,
  patch: Partial<DrawingStyleState>,
): void {
  const keys = ["lineColor", "fillColor", "fillOpacity", "textColor", "width", "style"] as const;
  const next: Partial<DrawingStyleState> = {};
  for (const key of keys) {
    const value = patch[key];
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  if (patch.levels?.length) {
    next.levels = patch.levels.map((level) => ({ ...level }));
  }
  if (!Object.keys(next).length) return;
  const store = readStore();
  store.lastStyles[kind] = { ...store.lastStyles[kind], ...next };
  writeStore(store);
}

export function listDrawingTemplates(kind: DrawingTemplateKind): DrawingTemplate[] {
  return readStore()
    .templates
    .filter((item) => item.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/**
 * Состояние именно того пункта, по которому кликнули.
 *
 * Раньше искали шаблон в storage по id: у старых записей id не было или он
 * совпадал, и `find` всегда отдавал первый в списке — «4h FVG» становился
 * «1h FVG». Список меню уже актуальный, перечитывать его не нужно.
 */
export function resolveDrawingTemplateState(clicked: DrawingTemplate): DrawingTemplateState {
  return { ...clicked.state, text: clicked.name };
}

export function saveDrawingTemplate(
  kind: DrawingTemplateKind,
  name: string,
  state: DrawingTemplateState,
): DrawingTemplate | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const store = readStore();
  const template: DrawingTemplate = {
    id: crypto.randomUUID(),
    kind,
    name: trimmed,
    state: { ...state },
    createdAt: Date.now(),
  };
  store.templates.push(template);
  writeStore(store);
  return template;
}

export function deleteDrawingTemplate(id: string): void {
  const store = readStore();
  store.templates = store.templates.filter((item) => item.id !== id);
  writeStore(store);
}
