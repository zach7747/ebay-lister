// Resize photos in the browser before upload.
//
// We produce TWO sizes per photo:
//   • data      — ~1024px, used for writing the listing (needs detail: tags, etc.)
//   • previewUrl — ~400px thumbnail, used for on-screen display AND for the
//                  sort step (which only needs to tell items apart). Keeping the
//                  sort payload tiny avoids Vercel's 4.5 MB request-body limit
//                  when a whole batch is sent at once.

const FULL_DIM = 1024;
const FULL_QUALITY = 0.82;
const THUMB_DIM = 360;
const THUMB_QUALITY = 0.5;

export interface ResizedImage {
  mediaType: "image/jpeg";
  data: string; // base64 (no prefix) ~1024px — for listing analysis
  previewUrl: string; // data url ~400px — for display + sorting
}

export async function resizeImage(file: File): Promise<ResizedImage> {
  const bitmap = await loadBitmap(file);
  const full = drawToJpeg(bitmap, FULL_DIM, FULL_QUALITY);
  const thumb = drawToJpeg(bitmap, THUMB_DIM, THUMB_QUALITY);
  if ("close" in bitmap) bitmap.close();
  return {
    mediaType: "image/jpeg",
    data: full.split(",")[1],
    previewUrl: thumb,
  };
}

function drawToJpeg(
  src: ImageBitmap | HTMLImageElement,
  maxDim: number,
  quality: number
): string {
  const w = "width" in src ? src.width : 0;
  const h = "height" in src ? src.height : 0;
  const { width, height } = scaleDown(w, h, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(src, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function scaleDown(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = Math.min(max / w, max / h);
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

// Re-encode a stored base64 JPEG (NO data: prefix) at a smaller
// dimension/quality and return the new base64 (no prefix). Unlike
// resizeImage, this works from the stored string alone — the original File is
// long gone after a session restore, so we decode the base64 itself via a
// data URL. Any failure (bad decode, no canvas, no 2d context) returns the
// input unchanged so the caller degrades gracefully.
export async function shrinkDataUrl(
  data: string,
  maxDim: number,
  quality: number
): Promise<string> {
  if (!data) return data;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = `data:image/jpeg;base64,${data}`;
    });
    const { width, height } = scaleDown(img.naturalWidth, img.naturalHeight, maxDim);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return data;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL("image/jpeg", quality);
    return out.includes(",") ? out.split(",")[1] : data;
  } catch {
    return data;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path (e.g. some HEIC/Safari cases).
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image file."));
    };
    img.src = url;
  });
}
