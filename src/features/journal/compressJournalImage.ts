const MAX_EDGE = 1600;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const TARGET_DATA_URL_BYTES = 1_400_000;

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);

export const JOURNAL_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export function isJournalImageFile(file: File): boolean {
  if (ACCEPTED_TYPES.has(file.type)) return true;
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Не удалось сжать изображение"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Не удалось прочитать сжатый кадр"));
      reader.readAsDataURL(blob);
    }, "image/jpeg", quality);
  });
}

async function drawToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas недоступен");
  }
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function compressJournalImage(file: File): Promise<{ name: string; mime: "image/jpeg"; dataUrl: string }> {
  if (!isJournalImageFile(file)) {
    throw new Error("Можно прикрепить только изображение");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Файл больше 12 МБ — уменьши скрин и попробуй снова");
  }
  const canvas = await drawToCanvas(file);
  let quality = 0.82;
  let dataUrl = await canvasToJpeg(canvas, quality);
  while (dataUrl.length > TARGET_DATA_URL_BYTES && quality > 0.45) {
    quality -= 0.12;
    dataUrl = await canvasToJpeg(canvas, quality);
  }
  if (dataUrl.length > TARGET_DATA_URL_BYTES * 1.4) {
    throw new Error("Скрин слишком тяжёлый даже после сжатия");
  }
  const baseName = file.name.replace(/\.[^.]+$/, "") || "screenshot";
  return { name: `${baseName}.jpg`, mime: "image/jpeg", dataUrl };
}
