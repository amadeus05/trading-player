/**
 * Часовой пояс графика — только подписи. Свечи, агрегация и replay остаются
 * unix UTC. IANA-зоны сами знают летнее время на конкретную секунду истории.
 */

export const CHART_TIMEZONE_UTC = "utc";
export const CHART_TIMEZONE_EXCHANGE = "exchange";
export const DEFAULT_CHART_TIMEZONE = CHART_TIMEZONE_UTC;

export interface ChartTimeZoneCity {
  id: string;
  city: string;
  iana: string;
}

const city = (name: string, iana: string): ChartTimeZoneCity => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  city: name,
  iana,
});

/** Список как у TradingView: город → IANA. Подпись оффсета считается на дату. */
export const CHART_TIMEZONE_CITIES: readonly ChartTimeZoneCity[] = [
  city("Honolulu", "Pacific/Honolulu"),
  city("Anchorage", "America/Anchorage"),
  city("Juneau", "America/Juneau"),
  city("Los Angeles", "America/Los_Angeles"),
  city("Phoenix", "America/Phoenix"),
  city("Vancouver", "America/Vancouver"),
  city("Denver", "America/Denver"),
  city("Mexico City", "America/Mexico_City"),
  city("San Salvador", "America/El_Salvador"),
  city("Bogota", "America/Bogota"),
  city("Chicago", "America/Chicago"),
  city("Lima", "America/Lima"),
  city("Caracas", "America/Caracas"),
  city("New York", "America/New_York"),
  city("Santiago", "America/Santiago"),
  city("Toronto", "America/Toronto"),
  city("Buenos Aires", "America/Argentina/Buenos_Aires"),
  city("Halifax", "America/Halifax"),
  city("Sao Paulo", "America/Sao_Paulo"),
  city("Azores", "Atlantic/Azores"),
  city("Reykjavik", "Atlantic/Reykjavik"),
  city("Casablanca", "Africa/Casablanca"),
  city("Dublin", "Europe/Dublin"),
  city("Lagos", "Africa/Lagos"),
  city("Lisbon", "Europe/Lisbon"),
  city("London", "Europe/London"),
  city("Tunis", "Africa/Tunis"),
  city("Amsterdam", "Europe/Amsterdam"),
  city("Belgrade", "Europe/Belgrade"),
  city("Berlin", "Europe/Berlin"),
  city("Bratislava", "Europe/Bratislava"),
  city("Brussels", "Europe/Brussels"),
  city("Budapest", "Europe/Budapest"),
  city("Copenhagen", "Europe/Copenhagen"),
  city("Johannesburg", "Africa/Johannesburg"),
  city("Ljubljana", "Europe/Ljubljana"),
  city("Luxembourg", "Europe/Luxembourg"),
  city("Madrid", "Europe/Madrid"),
  city("Malta", "Europe/Malta"),
  city("Oslo", "Europe/Oslo"),
  city("Paris", "Europe/Paris"),
  city("Prague", "Europe/Prague"),
  city("Rome", "Europe/Rome"),
  city("Stockholm", "Europe/Stockholm"),
  city("Vienna", "Europe/Vienna"),
  city("Warsaw", "Europe/Warsaw"),
  city("Zagreb", "Europe/Zagreb"),
  city("Zurich", "Europe/Zurich"),
  city("Athens", "Europe/Athens"),
  city("Bahrain", "Asia/Bahrain"),
  city("Bucharest", "Europe/Bucharest"),
  city("Cairo", "Africa/Cairo"),
  city("Helsinki", "Europe/Helsinki"),
  city("Istanbul", "Europe/Istanbul"),
  city("Jerusalem", "Asia/Jerusalem"),
  city("Kuwait", "Asia/Kuwait"),
  city("Moscow", "Europe/Moscow"),
  city("Nairobi", "Africa/Nairobi"),
  city("Nicosia", "Asia/Nicosia"),
  city("Qatar", "Asia/Qatar"),
  city("Riga", "Europe/Riga"),
  city("Riyadh", "Asia/Riyadh"),
  city("Sofia", "Europe/Sofia"),
  city("Tallinn", "Europe/Tallinn"),
  city("Vilnius", "Europe/Vilnius"),
  city("Tehran", "Asia/Tehran"),
  city("Dubai", "Asia/Dubai"),
  city("Muscat", "Asia/Muscat"),
  city("Kabul", "Asia/Kabul"),
  city("Ashgabat", "Asia/Ashgabat"),
  city("Astana", "Asia/Almaty"),
  city("Karachi", "Asia/Karachi"),
  city("Colombo", "Asia/Colombo"),
  city("Kolkata", "Asia/Kolkata"),
  city("Kathmandu", "Asia/Kathmandu"),
  city("Dhaka", "Asia/Dhaka"),
  city("Yangon", "Asia/Yangon"),
  city("Bangkok", "Asia/Bangkok"),
  city("Ho Chi Minh", "Asia/Ho_Chi_Minh"),
  city("Jakarta", "Asia/Jakarta"),
  city("Chongqing", "Asia/Shanghai"),
  city("Hong Kong", "Asia/Hong_Kong"),
  city("Kuala Lumpur", "Asia/Kuala_Lumpur"),
  city("Manila", "Asia/Manila"),
  city("Perth", "Australia/Perth"),
  city("Shanghai", "Asia/Shanghai"),
  city("Singapore", "Asia/Singapore"),
  city("Taipei", "Asia/Taipei"),
  city("Seoul", "Asia/Seoul"),
  city("Tokyo", "Asia/Tokyo"),
  city("Adelaide", "Australia/Adelaide"),
  city("Brisbane", "Australia/Brisbane"),
  city("Sydney", "Australia/Sydney"),
  city("Norfolk Island", "Pacific/Norfolk"),
  city("New Zealand", "Pacific/Auckland"),
  city("Chatham Islands", "Pacific/Chatham"),
  city("Tokelau", "Pacific/Fakaofo"),
];

const CITY_BY_ID = new Map(CHART_TIMEZONE_CITIES.map((item) => [item.id, item]));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Календарные части unix-секунды в IANA-зоне, с учётом DST на этот момент. */
export function zonedDateParts(timeZone: string, utcSeconds: number): ZonedDateParts {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcSeconds * 1_000));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const weekday = WEEKDAYS.findIndex((name) => weekdayName.startsWith(name.slice(0, 2)));
  const hour = value("hour") % 24;
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour,
    minute: value("minute"),
    second: value("second"),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/** Смещение зоны в секундах: местное − UTC. */
export function zoneOffsetSeconds(timeZone: string, utcSeconds: number) {
  const parts = zonedDateParts(timeZone, utcSeconds);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 1_000;
  return asUtc - utcSeconds;
}

/**
 * UTC-момент, когда в зоне наступает стенные часы y-m-d h:m:s.
 * Два прохода по смещению закрывают сутки перехода на DST.
 */
export function zonedWallTime(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second) / 1_000;
  const approx = wall - zoneOffsetSeconds(timeZone, wall);
  return wall - zoneOffsetSeconds(timeZone, approx);
}

/**
 * Открытие бара, чья подпись в зоне попадает на выбранную гражданскую дату.
 * Свечи режутся по UTC, и местная полночь обычно лежит внутри бакета: его
 * открытие подписано предыдущей датой, поэтому прыжок по дате уезжал на бар
 * назад. Округление вверх безопасно, пока бакет не длиннее суток.
 */
export function zonedDateBarStart(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  bucketSeconds: number,
) {
  const wall = zonedWallTime(timeZone, year, month, day);
  if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 1) return wall;
  return Math.ceil(wall / bucketSeconds) * bucketSeconds;
}

/** Полуинтервал гражданских суток [from, to] в unix-секундах. */
export function zonedDayBounds(timeZone: string, year: number, month: number, day: number) {
  const from = zonedWallTime(timeZone, year, month, day);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const to = zonedWallTime(timeZone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) - 1;
  return { from, to };
}

export function formatUtcOffsetTag(offsetSeconds: number) {
  // Сначала целые минуты: иначе 14399.2с (4ч минус дробь unix) даёт 3ч и :60.
  const totalMinutes = Math.round(Math.abs(offsetSeconds) / 60);
  if (totalMinutes === 0) return "(UTC)";
  const sign = offsetSeconds > 0 ? "+" : "-";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `(UTC${sign}${hours})`;
  return `(UTC${sign}${hours}:${pad2(minutes)})`;
}

export function formatUtcOffsetShort(offsetSeconds: number) {
  return formatUtcOffsetTag(offsetSeconds).slice(1, -1);
}

export function exchangeTimeZoneIana(category?: string) {
  if (category === "linear" || category === "inverse" || category === "spot" || !category) return "UTC";
  return "America/New_York";
}

export function sanitizeChartTimeZone(value: unknown) {
  if (value === CHART_TIMEZONE_UTC || value === CHART_TIMEZONE_EXCHANGE) return value;
  if (typeof value === "string" && CITY_BY_ID.has(value)) return value;
  return DEFAULT_CHART_TIMEZONE;
}

export function resolveChartTimeZoneIana(id: string, category?: string) {
  const safe = sanitizeChartTimeZone(id);
  if (safe === CHART_TIMEZONE_UTC) return "UTC";
  if (safe === CHART_TIMEZONE_EXCHANGE) return exchangeTimeZoneIana(category);
  return CITY_BY_ID.get(safe)?.iana ?? "UTC";
}

export function chartTimeZoneEntry(id: string) {
  return CITY_BY_ID.get(id);
}

export function formatChartTimeZoneMenuLabel(id: string, iana: string, atUnix = Date.now() / 1_000) {
  if (id === CHART_TIMEZONE_UTC) return "UTC";
  if (id === CHART_TIMEZONE_EXCHANGE) return "Exchange";
  const name = CITY_BY_ID.get(id)?.city ?? iana;
  return `${formatUtcOffsetTag(zoneOffsetSeconds(iana, atUnix))} ${name}`;
}

export function formatChartTimeZoneButtonLabel(id: string, iana: string, atUnix = Date.now() / 1_000) {
  if (id === CHART_TIMEZONE_UTC) return "UTC";
  if (id === CHART_TIMEZONE_EXCHANGE) return "Exchange";
  return formatUtcOffsetShort(zoneOffsetSeconds(iana, atUnix));
}

function formatDatePart(parts: ZonedDateParts) {
  return `${WEEKDAYS[parts.weekday]} ${pad2(parts.day)} ${MONTHS[parts.month - 1]} '${String(parts.year).slice(2)}`;
}

function formatClock(parts: ZonedDateParts) {
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Подпись оси/линейки, как у TradingView. */
export function formatChartAxisTime(unixSeconds: number, timeframeSec: number, timeZone: string) {
  const parts = zonedDateParts(timeZone, unixSeconds);
  if (timeframeSec < 86_400) return `${formatDatePart(parts)} ${formatClock(parts)}`;
  return formatDatePart(parts);
}

/** Crosshair: дата и время в выбранной зоне. */
export function formatChartCrosshairTime(unixSeconds: number, timeZone: string) {
  const parts = zonedDateParts(timeZone, unixSeconds);
  return `${formatDatePart(parts)} ${formatClock(parts)}`;
}

/**
 * TickMarkType lightweight-charts: Year=0, Month=1, DayOfMonth=2, Time=3, TimeWithSeconds=4.
 */
export function formatChartTickMark(unixSeconds: number, tickMarkType: number, timeZone: string) {
  const parts = zonedDateParts(timeZone, unixSeconds);
  if (tickMarkType === 0) return String(parts.year);
  if (tickMarkType === 1) return `${MONTHS[parts.month - 1]} '${String(parts.year).slice(2)}`;
  if (tickMarkType === 2) return String(parts.day);
  if (tickMarkType === 4) return `${formatClock(parts)}:${pad2(parts.second)}`;
  return formatClock(parts);
}
