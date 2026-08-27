declare module "lzma-purejs" {
  /** Распаковывает поток LZMA1 (формат .lzma), в котором лежат файлы фида. */
  export function decompressFile(input: Uint8Array): Uint8Array;
}
