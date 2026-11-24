// @ts-check
// Resizes a picture in the browser before upload (TECH-SPEC 5.2, H-03):
// at most 1920 x 1080, re-encoded as JPEG (quality 0.85), or kept as PNG when
// it has transparency. The server needs no image library.

export const MAX_W = 1920;
export const MAX_H = 1080;

/**
 * Size that fits inside 1920 x 1080 without upscaling.
 * @param {number} w @param {number} h
 * @returns {{ w: number, h: number }}
 */
export function fitSize(w, h) {
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function hasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (/** @type {number} */ (data[i]) < 255) return true;
  return false;
}

/**
 * @param {File} file
 * @returns {Promise<{ blob: Blob, name: string, width: number, height: number }>}
 */
export async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Pick a JPEG, PNG or WebP picture.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That picture could not be read. Try saving it again as a JPEG or PNG.");
  }
  const { w, h } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize pictures.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const png = file.type !== "image/jpeg" && hasTransparency(ctx, w, h);
  const type = png ? "image/png" : "image/jpeg";
  /** @type {Blob | null} */
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) throw new Error("This browser can't resize pictures.");
  return { blob, name: png ? "picture.png" : "picture.jpg", width: w, height: h };
}
