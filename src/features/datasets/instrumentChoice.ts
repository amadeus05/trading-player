import type { MarketInstrument } from "../../shared/api/marketDataApi";

/** Наборы инструментов по категориям, как их отдаёт /api/market/instruments. */
export type ListedInstruments = Record<string, MarketInstrument[]>;

const CATEGORY_TITLES: Record<string, string> = {
  forex: "Форекс, металлы и индексы",
};

export interface InstrumentOptionGroup {
  label: string;
  options: Array<{ value: string; label: string }>;
}

/**
 * Категория, которой принадлежит инструмент.
 *
 * Выбирать её руками пользователь не должен: он ищет инструмент по тикеру и не
 * обязан знать, что GRXEUR лежит в forex, а BTCUSDT — в linear. С неверной
 * категорией запрос уходил в Bybit и падал «Symbol Is Invalid» — снаружи это
 * выглядело так, будто загрузка просто ничего не сделала.
 */
export function categoryForInstrument(
  symbol: string,
  instruments: ListedInstruments,
  current: string,
): string {
  const code = symbol.trim().toUpperCase();
  if (!code) return current;
  for (const [category, list] of Object.entries(instruments)) {
    if (list.some((item) => item.symbol === code)) return category;
  }
  // Тикера нет ни в одном перечисленном наборе — значит это крипта. Остаться в
  // категории с закрытым списком нельзя: такого инструмента там просто нет.
  return instruments[current]?.length ? "linear" : current;
}

/** Подсказки для поля инструмента: по группе на категорию с известным набором. */
export function instrumentOptions(instruments: ListedInstruments): InstrumentOptionGroup[] {
  return Object.entries(instruments)
    .filter(([, list]) => list.length)
    .map(([category, list]) => ({
      label: CATEGORY_TITLES[category] ?? category,
      options: list.map((item) => ({
        value: item.symbol,
        label: `${item.symbol} · ${item.title}`,
      })),
    }));
}

/** Поиск идёт и по коду источника, и по привычному имени внутри подписи. */
export function matchInstrument(input: string, label: unknown): boolean {
  const query = input.trim().toLowerCase();
  if (!query) return true;
  return String(label ?? "").toLowerCase().includes(query);
}

/** Валюта расчёта выбранного инструмента; null — доллар либо неизвестный код. */
export function foreignQuoteOf(symbol: string, instruments: ListedInstruments): string | null {
  const code = symbol.trim().toUpperCase();
  for (const list of Object.values(instruments)) {
    const found = list.find((item) => item.symbol === code);
    if (found) return found.quote && found.quote !== "USD" ? found.quote : null;
  }
  return null;
}
