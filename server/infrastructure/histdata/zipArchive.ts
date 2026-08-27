import { inflateRawSync } from "node:zlib";

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;
const DIRECTORY_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export const isZip = (archive: Buffer): boolean =>
  archive.length > 4 && archive.readUInt32LE(0) === 0x04034b50;

/**
 * Читает zip через центральный каталог в конце файла.
 *
 * Идти по локальным заголовкам нельзя: HistData собирает архив потоком и
 * оставляет там нулевые размеры, унося настоящие в дескриптор после данных.
 * В каталоге размеры есть всегда, поэтому он единственный надёжный вход.
 */
export function readZipEntries(archive: Buffer): ZipEntry[] {
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== END_OF_DIRECTORY) end -= 1;
  if (end < 0) throw new Error("Это не zip: не найден конец центрального каталога");

  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== DIRECTORY_ENTRY) {
      throw new Error(`Повреждён центральный каталог zip на элементе ${index}`);
    }
    const method = archive.readUInt16LE(cursor + 10);
    const compressed = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + DIRECTORY_HEADER_SIZE, cursor + DIRECTORY_HEADER_SIZE + nameLength).toString("latin1");
    cursor += DIRECTORY_HEADER_SIZE + nameLength + extraLength + commentLength;

    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`Метод сжатия ${method} в ${name} не поддержан`);
    }
    const bodyStart = localOffset
      + LOCAL_HEADER_SIZE
      + archive.readUInt16LE(localOffset + 26)
      + archive.readUInt16LE(localOffset + 28);
    const body = archive.subarray(bodyStart, bodyStart + compressed);
    entries.push({ name, data: method === DEFLATED ? inflateRawSync(body) : Buffer.from(body) });
  }

  return entries;
}
