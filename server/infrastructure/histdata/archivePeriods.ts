import { SUMMER_OFFSET_MS, WINTER_OFFSET_MS } from "./histDataCsv.js";

/** Месяц равен null, когда за год отдают один архив. */
export interface ArchivePeriod {
  year: number;
  month: number | null;
}

/**
 * Архивы, покрывающие полуинтервал [from, to) в UTC.
 *
 * Архив разложен по календарю своих меток, а метка отстаёт от UTC на четыре или
 * пять часов. Обе границы берутся с запасом в эту неопределённость: лишний
 * архив стоит один запрос, а недостающий оставил бы дыру в истории.
 *
 * Завершённые годы лежат одним файлом, текущий — месячными: годового архива для
 * него ещё не существует.
 */
export function archivePeriods(from: number, to: number, currentYear: number): ArchivePeriod[] {
  if (to <= from) return [];

  const start = new Date(from - WINTER_OFFSET_MS);
  const last = new Date(to - 1 - SUMMER_OFFSET_MS);
  const lastYear = last.getUTCFullYear();
  const lastMonth = last.getUTCMonth() + 1;

  const periods: ArchivePeriod[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    if (year < currentYear) {
      periods.push({ year, month: null });
      year += 1;
      month = 1;
      continue;
    }
    periods.push({ year, month });
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }

  return periods;
}
