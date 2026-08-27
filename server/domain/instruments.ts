/**
 * Инструменты, которые умеем качать помимо крипты.
 *
 * Пока только те, что котируются в долларе. Результат сделки считается как
 * (выход − вход) × размер, то есть сразу в валюте котировки: для EURUSD и XAUUSD
 * это доллары, а для USDJPY или EURGBP были бы йены и фунты, которые статистика
 * молча сложила бы с долларами. Такие пары ждут конвертации по курсу и потому
 * здесь отсутствуют — лучше не иметь инструмента, чем иметь неверную эквити.
 */
export interface FeedInstrument {
  /** Код инструмента в фиде Dukascopy. */
  feedSymbol: string;
  /**
   * Фид отдаёт цены целыми числами в пунктах. Делитель подобран не по правилу
   * «пять знаков у валют», а проверен запросом по каждому инструменту: ошибка
   * здесь тихо смещает всю историю в десять раз.
   */
  priceDivisor: number;
  /** Код пары в путях HistData, откуда берётся длинная история. */
  histDataPair: string;
  /** Название для списка выбора: по одному тикеру не всем понятно, что это. */
  title: string;
}

const FEED_INSTRUMENTS: Record<string, FeedInstrument> = {
  EURUSD: { feedSymbol: "EURUSD", priceDivisor: 1e5, histDataPair: "eurusd", title: "Евро / Доллар США" },
  GBPUSD: { feedSymbol: "GBPUSD", priceDivisor: 1e5, histDataPair: "gbpusd", title: "Фунт стерлингов / Доллар США" },
  AUDUSD: { feedSymbol: "AUDUSD", priceDivisor: 1e5, histDataPair: "audusd", title: "Австралийский доллар / Доллар США" },
  NZDUSD: { feedSymbol: "NZDUSD", priceDivisor: 1e5, histDataPair: "nzdusd", title: "Новозеландский доллар / Доллар США" },
  XAUUSD: { feedSymbol: "XAUUSD", priceDivisor: 1e3, histDataPair: "xauusd", title: "Золото / Доллар США" },
  XAGUSD: { feedSymbol: "XAGUSD", priceDivisor: 1e3, histDataPair: "xagusd", title: "Серебро / Доллар США" },
};

export const FOREX_SYMBOLS = Object.keys(FEED_INSTRUMENTS);

/** Список для интерфейса: без него узнать доступные инструменты можно только из кода. */
export const forexInstruments = (): Array<{ symbol: string; title: string }> =>
  Object.entries(FEED_INSTRUMENTS).map(([symbol, instrument]) => ({ symbol, title: instrument.title }));

export function feedInstrument(symbol: string): FeedInstrument | undefined {
  return FEED_INSTRUMENTS[symbol.toUpperCase()];
}
