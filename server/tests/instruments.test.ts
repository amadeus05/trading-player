import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeInstrument } from "../domain/instruments.js";

describe("описание инструмента по коду", () => {
  test("валютная пара получает название и валюту расчёта", () => {
    assert.deepEqual(describeInstrument("EURUSD"), {
      symbol: "EURUSD",
      title: "Евро / Доллар США",
      quote: "USD",
    });
    assert.deepEqual(describeInstrument("USDJPY"), {
      symbol: "USDJPY",
      title: "Доллар США / Иена",
      quote: "JPY",
    });
  });

  /**
   * Привычные брокерские имена входят в подпись: коды HistData с ними не
   * совпадают, а искать инструмент будут по GER40 или GOLD.
   */
  test("металлы, индексы и сырьё подписываются по базе и привычным именам", () => {
    assert.equal(describeInstrument("XAUUSD").title, "Золото (GOLD) / Доллар США");
    assert.equal(describeInstrument("GRXEUR").title, "Германия 40 (DAX, GER40, GER30, DE40) / Евро");
    assert.equal(describeInstrument("SPXUSD").title, "США 500 (S&P, SPX500, US500) / Доллар США");
  });

  /** По ней интерфейс предупреждает, что прибыль выйдет не в долларах. */
  test("валюта расчёта берётся из котировки, а не из базы", () => {
    assert.equal(describeInstrument("XAUEUR").quote, "EUR");
    assert.equal(describeInstrument("GRXEUR").quote, "EUR");
    assert.equal(describeInstrument("UDXUSD").quote, "USD");
  });

  /**
   * Источник может добавить инструмент в любой момент. Показать его тикером
   * лучше, чем спрятать до правки в коде, — иначе список снова станет
   * рукописным.
   */
  test("незнакомый код остаётся в списке под своим тикером", () => {
    assert.deepEqual(describeInstrument("ABCXYZ"), {
      symbol: "ABCXYZ",
      title: "ABCXYZ",
      quote: null,
    });
    assert.deepEqual(describeInstrument("BTCUSD7"), {
      symbol: "BTCUSD7",
      title: "BTCUSD7",
      quote: null,
    });
  });

  test("регистр и пробелы вокруг кода не мешают", () => {
    assert.deepEqual(describeInstrument(" eurusd "), {
      symbol: "EURUSD",
      title: "Евро / Доллар США",
      quote: "USD",
    });
  });
});
