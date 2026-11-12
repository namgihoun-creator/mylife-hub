// Browser-side photo preparation for the space planner: longest side <= 1600 px, JPEG, <= 5 MB (the bucket's limit).
// Phone photos are 3-12 MB; they are shrunk here BEFORE the upload to the private `space-photos` bucket.
import { createClient } from "@/shared/lib/supabase/client";
import { fitWithin } from "@/features/kitchen/utils/image-compressor";

export const SPACE_MAX_SIDE = 1600;
export const SPACE_MAX_BYTES = 5 * 1024 * 1024;
const QUALITIES = [0.85, 0.75, 0.65, 0.5, 0.4];

export class PhotoError extends Error {}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError("사진을 압축하지 못했어요."))), "image/jpeg", quality));

export async function compressSpacePhoto(file: Blob): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !file.type.startsWith("image/")) throw new PhotoError("사진 파일만 올릴 수 있어요.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); // applies the EXIF rotation
  } catch {
    throw new PhotoError("이 사진은 읽을 수 없어요. JPG, PNG, WEBP 사진을 올려 주세요.");
  }
  try {
    const { width, height } = fitWithin(bmp.width, bmp.height, SPACE_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("사진을 처리하지 못했어요.");
    ctx.fillStyle = "#fff"; // PNG transparency -> white, JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    let blob = await toBlob(canvas, QUALITIES[0]);
    for (let i = 1; i < QUALITIES.length && blob.size > SPACE_MAX_BYTES; i++) blob = await toBlob(canvas, QUALITIES[i]);
    if (blob.size > SPACE_MAX_BYTES) throw new PhotoError("사진이 너무 커요. 다른 사진으로 올려 주세요.");
    return blob;
  } finally {
    bmp.close();
  }
}

/** Compress and upload to `<household_id>/<space_id>/<random>.jpg`; returns the storage path. */
export async function uploadSpacePhoto(householdId: string, spaceId: string, file: Blob): Promise<string> {
  const blob = await compressSpacePhoto(file);
  const path = `${householdId}/${spaceId}/${crypto.randomUUID()}.jpg`;
  const { error } = await createClient().storage.from("space-photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw new PhotoError("사진을 올리지 못했어요. 잠시 뒤에 다시 해 보세요.");
  return path;
}
