// Browser-side photo compression for the kitchen's photo intake. Camera photos are 3-12 MB; Vercel's request limit is
// 4.5 MB (and our Server Action body limit is lower), so the photo is shrunk BEFORE it is sent: longest side <= 1024 px,
// re-encoded as JPEG (quality 0.75), returned as a light base64 string (typically 80-250 KB). Uses only Canvas — no
// dependencies. `fitWithin` is pure and unit-tested; the rest needs a browser.

export const MAX_SIDE = 1024;
export const JPEG_QUALITY = 0.75;
/** Target ceiling for the base64 string; noisy photos are re-encoded smaller until they fit. */
export const MAX_BASE64_CHARS = 600_000;

export type CompressedImage = {
  /** base64 WITHOUT the `data:` prefix */
  base64: string;
  mimeType: "image/jpeg";
  /** size of the encoded image in bytes (≈ base64.length * 3/4) */
  bytes: number;
  width: number;
  height: number;
  /** quality actually used (lowered only when the first pass was above MAX_BASE64_CHARS) */
  quality: number;
};

/** Scale (w, h) so the longest side is at most `max`, keeping the aspect ratio; never upscales. Always >= 1px. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` applies the EXIF rotation, so phone photos are not sideways.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 압축하지 못했어요."))), "image/jpeg", quality));

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(",") + 1)); // strip "data:image/jpeg;base64,"
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Photo file -> `{ base64, ... }`: resized to a 1024px long side and JPEG-encoded at 0.75. If the result is still above
 * MAX_BASE64_CHARS (very detailed photo) it is re-encoded with lower quality, then a smaller size, until it fits.
 * Throws a Korean, user-safe Error for non-images / undecodable files.
 */
export async function compressImage(file: Blob, opts: { maxSide?: number; quality?: number } = {}): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) throw new Error("사진 파일만 올릴 수 있어요.");
  const img = await decode(file);
  try {
    let side = opts.maxSide ?? MAX_SIDE;
    let quality = opts.quality ?? JPEG_QUALITY;
    for (let pass = 0; pass < 6; pass++) {
      const { width, height } = fitWithin(img.width, img.height, side);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("이 브라우저에서는 사진을 압축할 수 없어요.");
      ctx.fillStyle = "#ffffff"; // PNG/WebP transparency would turn black in JPEG
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img.source, 0, 0, width, height);
      const blob = await toBlob(canvas, quality);
      const base64 = await blobToBase64(blob);
      if (base64.length <= MAX_BASE64_CHARS || pass === 5) {
        return { base64, mimeType: "image/jpeg", bytes: blob.size, width, height, quality };
      }
      if (quality > 0.5) quality = Math.max(0.5, Math.round((quality - 0.1) * 100) / 100);
      else side = Math.round(side * 0.8);
    }
    throw new Error("사진을 충분히 줄이지 못했어요.");
  } finally {
    img.close();
  }
}
