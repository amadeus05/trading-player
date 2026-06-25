import type { DrawingLineStyle } from "./DrawingToolbar";

export type DrawingTemplateKind =
  | "trendline"
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
}

export interface DrawingTemplate {
  id: string;
  kind: DrawingTemplateKind;
  name: string;
  state: DrawingTemplateState;
  createdAt: number;
}

interface DrawingTemplatesStore {
  templates: DrawingTemplate[];
}

const STORAGE_KEY = "player:drawing-templates";

const DEFAULTS: Record<DrawingTemplateKind, DrawingTemplateState> = {
  trendline: {
    lineColor: "#ff4976",
    textColor: "#ff4976",
    width: 2,
    style: "solid",
  },
  rectangle: {
    lineColor: "#ff2727",
    fillColor: "#2962ff",
    fillOpacity: 20,
    textColor: "#2962ff",
    width: 2,
    style: "solid",
  },
  fibonacci: {
    lineColor: "#787b86",
    width: 1,
    style: "solid",
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

function readStore(): DrawingTemplatesStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { templates: [] };
    const parsed = JSON.parse(raw) as DrawingTemplatesStore;
    if (!Array.isArray(parsed.templates)) return { templates: [] };
    return { templates: parsed.templates };
  } catch {
    return { templates: [] };
  }
}

function writeStore(store: DrawingTemplatesStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getDefaultDrawingTemplateState(kind: DrawingTemplateKind): DrawingTemplateState {
  return { ...DEFAULTS[kind] };
}

export function listDrawingTemplates(kind: DrawingTemplateKind): DrawingTemplate[] {
  return readStore()
    .templates
    .filter((item) => item.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
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
