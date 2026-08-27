import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  categoryForInstrument,
  foreignQuoteOf,
  instrumentOptions,
  matchInstrument,
  type ListedInstruments,
} from "../../src/features/datasets/instrumentChoice";

const LISTED: ListedInstruments = {
  forex: [
    { symbol: "EURUSD", title: "Евро / Доллар США", quote: "USD" },
    { symbol: "GRXEUR", title: "Германия 40 (DAX, GER40, GER30, DE40) / Евро", quote: "EUR" },
    { symbol: "USDJPY", title: "Доллар США / Иена", quote: "JPY" },
  ],
};

describe("выбор инструмента", () => {
  /**
   * Ровно на этом ломалась загрузка: GRXEUR ввели при категории linear, запрос
   * ушёл в Bybit и вернул «Symbol Is Invalid».
   */
  test("категорию задаёт инструмент, а не пользователь", () => {
    assert.equal(categoryForInstrument("GRXEUR", LISTED, "linear"), "forex");
    assert.equal(categoryForInstrument("grxeur", LISTED, "spot"), "forex");
    assert.equal(categoryForInstrument(" EURUSD ", LISTED, "inverse"), "forex");
  });

  test("тикер вне перечисленных наборов уводит из форекса в крипту", () => {
    assert.equal(categoryForInstrument("BTCUSDT", LISTED, "forex"), "linear");
  });

  /** Внутри крипты выбор остаётся за пользователем: символы у категорий общие. */
  test("выбранная категория крипты не сбрасывается", () => {
    assert.equal(categoryForInstrument("BTCUSDT", LISTED, "spot"), "spot");
    assert.equal(categoryForInstrument("BTCUSD", LISTED, "inverse"), "inverse");
  });

  test("пустое поле категорию не меняет", () => {
    assert.equal(categoryForInstrument("", LISTED, "forex"), "forex");
    assert.equal(categoryForInstrument("   ", LISTED, "linear"), "linear");
  });

  test("подсказки группируются по категории и содержат код с названием", () => {
    assert.deepEqual(instrumentOptions(LISTED), [{
      label: "Форекс, металлы и индексы",
      options: [
        { value: "EURUSD", label: "EURUSD · Евро / Доллар США" },
        { value: "GRXEUR", label: "GRXEUR · Германия 40 (DAX, GER40, GER30, DE40) / Евро" },
        { value: "USDJPY", label: "USDJPY · Доллар США / Иена" },
      ],
    }]);
  });

  test("пустые наборы в подсказки не попадают", () => {
    assert.deepEqual(instrumentOptions({ forex: [] }), []);
  });

  /** Код источника не совпадает с брокерским: GER40 должен находить GRXEUR. */
  test("поиск идёт и по коду, и по привычному имени", () => {
    const label = "GRXEUR · Германия 40 (DAX, GER40, GER30, DE40) / Евро";
    for (const query of ["grx", "GER40", "dax", "de40", " Германия "]) {
      assert.ok(matchInstrument(query, label), query);
    }
    assert.ok(!matchInstrument("BTC", label));
    assert.ok(matchInstrument("", label), "пустой запрос ничего не отсекает");
  });

  test("валюта расчёта подсказывается только когда она не доллар", () => {
    assert.equal(foreignQuoteOf("GRXEUR", LISTED), "EUR");
    assert.equal(foreignQuoteOf("usdjpy", LISTED), "JPY");
    assert.equal(foreignQuoteOf("EURUSD", LISTED), null);
    assert.equal(foreignQuoteOf("BTCUSDT", LISTED), null);
  });
});
