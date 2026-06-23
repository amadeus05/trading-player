import Papa from "papaparse";
import type { Candle } from "../../types";

type CsvValue = string | number | null | undefined;

interface RawCandleRow {
  time?: CsvValue;
  timestamp?: CsvValue;
  date?: CsvValue;
  open?: CsvValue;
  high?: CsvValue;
  low?: CsvValue;
  close?: CsvValue;
  volume?: CsvValue;
}

const toNumber = (value: CsvValue) => Number(value ?? Number.NaN);

export function parseCandleCsv(file: File): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawCandleRow>(file, {
      header: true,
      dynamicTyping: true,
      complete: ({ data, errors }) => {
        if (errors.length && !data.length) {
          reject(new Error(errors[0].message));
          return;
        }
        const candles = data
          .map((row): Candle => ({
            time: Math.floor(new Date(row.time ?? row.timestamp ?? row.date ?? "").getTime() / 1_000),
            open: toNumber(row.open),
            high: toNumber(row.high),
            low: toNumber(row.low),
            close: toNumber(row.close),
            volume: toNumber(row.volume ?? 0),
          }))
          .filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.close))
          .sort((left, right) => left.time - right.time);
        resolve(candles);
      },
      error: (error) => reject(error),
    });
  });
}
