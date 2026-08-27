/**
 * Инструменты, которые умеем качать помимо крипты.
 *
 * Списка доступных инструментов здесь нет и быть не должно: его отдаёт сам
 * источник, а плеер только подписывает коды человеческими названиями. Незнакомый
 * код не отбрасывается — источник может добавить инструмент в любой момент, и
 * показать его тикером лучше, чем спрятать до правки в коде.
 */

/** Настройки тикового фида Dukascopy, откуда докачиваются отдельные дыры. */
export interface FeedInstrument {
  /** Код инструмента в фиде: со своими кодами HistData он не совпадает. */
  feedSymbol: string;
  /**
   * Фид отдаёт цены целыми числами в пунктах. Делитель подобран не по правилу
   * «пять знаков у валют», а проверен запросом по каждому инструменту: ошибка
   * здесь тихо смещает всю историю в десять раз. Поэтому в списке только
   * проверенные инструменты, а не все, что есть у HistData.
   */
  priceDivisor: number;
}

const DUKASCOPY_INSTRUMENTS: Record<string, FeedInstrument> = {
  EURUSD: { feedSymbol: "EURUSD", priceDivisor: 1e5 },
  GBPUSD: { feedSymbol: "GBPUSD", priceDivisor: 1e5 },
  AUDUSD: { feedSymbol: "AUDUSD", priceDivisor: 1e5 },
  NZDUSD: { feedSymbol: "NZDUSD", priceDivisor: 1e5 },
  XAUUSD: { feedSymbol: "XAUUSD", priceDivisor: 1e3 },
  XAGUSD: { feedSymbol: "XAGUSD", priceDivisor: 1e3 },
};

export const DUKASCOPY_SYMBOLS = Object.keys(DUKASCOPY_INSTRUMENTS);

export function feedInstrument(symbol: string): FeedInstrument | undefined {
  return DUKASCOPY_INSTRUMENTS[symbol.toUpperCase()];
}

/** Валюты, в которых источник котирует инструменты. */
const CURRENCIES: Record<string, string> = {
  USD: "Доллар США",
  EUR: "Евро",
  GBP: "Фунт стерлингов",
  JPY: "Иена",
  CHF: "Швейцарский франк",
  AUD: "Австралийский доллар",
  NZD: "Новозеландский доллар",
  CAD: "Канадский доллар",
  SGD: "Сингапурский доллар",
  HKD: "Гонконгский доллар",
  ZAR: "Южноафриканский рэнд",
  TRY: "Турецкая лира",
  MXN: "Мексиканское песо",
  NOK: "Норвежская крона",
  SEK: "Шведская крона",
  DKK: "Датская крона",
  PLN: "Польский злотый",
  HUF: "Венгерский форинт",
  CZK: "Чешская крона",
};

/**
 * Базы, которые валютой не являются: металлы, индексы и сырьё.
 *
 * В скобках — как тот же инструмент называют брокеры и терминалы. Свои коды
 * HistData ни с кем не совпадают: DAX у неё GRX, а в TradingView он GER40,
 * GER30 или DE40 — по одному брокеру на строку. Поэтому привычные имена входят
 * в подпись: по ним инструмент и ищут в списке.
 */
const UNDERLYINGS: Record<string, string> = {
  XAU: "Золото (GOLD)",
  XAG: "Серебро (SILVER)",
  WTI: "Нефть WTI (USOIL)",
  BCO: "Нефть Brent (UKOIL)",
  GRX: "Германия 40 (DAX, GER40, GER30, DE40)",
  FRX: "Франция 40 (CAC, FRA40)",
  UKX: "Великобритания 100 (FTSE, UK100)",
  ETX: "Euro Stoxx 50 (STOXX50, EU50)",
  SPX: "США 500 (S&P, SPX500, US500)",
  NSX: "США 100 (Nasdaq, NAS100, US100)",
  UDX: "Индекс доллара (DXY)",
  JPX: "Япония 225 (Nikkei, JP225)",
  HKX: "Гонконг 50 (Hang Seng, HK50)",
  AUX: "Австралия 200 (ASX, AUS200)",
};

export interface MarketInstrument {
  symbol: string;
  /** Подпись для списка выбора: по одному тикеру не всем понятно, что это. */
  title: string;
  /**
   * Валюта, в которой получается результат сделки: он считается как
   * (выход − вход) × размер, то есть сразу в валюте котировки. null — код
   * незнакомый, и валюту угадывать не берёмся.
   */
  quote: string | null;
}

export function describeInstrument(symbol: string): MarketInstrument {
  const code = symbol.trim().toUpperCase();
  const base = code.slice(0, 3);
  const quote = code.slice(3);
  const baseName = UNDERLYINGS[base] ?? CURRENCIES[base];
  const quoteName = CURRENCIES[quote];
  return {
    symbol: code,
    title: code.length === 6 && baseName && quoteName ? `${baseName} / ${quoteName}` : code,
    quote: quoteName ? quote : null,
  };
}
