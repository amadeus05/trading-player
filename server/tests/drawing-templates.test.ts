import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  listDrawingTemplates,
  resolveDrawingTemplateState,
  type DrawingTemplate,
} from "../../src/drawing/shared/drawingTemplates";

const STORAGE_KEY = "player:drawing-templates";
const memory = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

afterEach(() => {
  memory.clear();
});

function template(name: string, text: string, id?: string): DrawingTemplate {
  return {
    id: id ?? "",
    kind: "rectangle",
    name,
    createdAt: 1,
    state: {
      lineColor: "#00c853",
      fillColor: "#131722",
      fillOpacity: 20,
      textColor: "#ffffff",
      text,
      width: 2,
      style: "solid",
    },
  };
}

test("клик по шаблону без id применяет его текст, а не первый в списке", () => {
  const first = template("1h FVG", "1H. FVG");
  const second = template("4h FVG", "4H. FVG");
  assert.equal(resolveDrawingTemplateState(second).text, "4h FVG");
  assert.notEqual(resolveDrawingTemplateState(second).text, first.state.text);
});

test("поиск по повторяющемуся id больше не подменяет выбранный шаблон первым", () => {
  const listed = [
    template("1h FVG", "1H. FVG", "same"),
    template("4h FVG", "4H. FVG", "same"),
  ];
  const byOldFind = listed.find((item) => item.id === listed[1].id);
  assert.equal(byOldFind?.state.text, "1H. FVG");
  assert.equal(resolveDrawingTemplateState(listed[1]).text, "4h FVG");
});

test("чтение склада чинит пустые и повторяющиеся id", () => {
  memory.set(STORAGE_KEY, JSON.stringify({
    templates: [
      template("1h FVG", "1H. FVG"),
      template("4h FVG", "4H. FVG"),
      template("FVG", "FVG", "dup"),
      template("ob", "ob", "dup"),
    ],
    lastStyles: {},
  }));
  const listed = listDrawingTemplates("rectangle");
  const ids = listed.map((item) => item.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => id.length > 0));
});
