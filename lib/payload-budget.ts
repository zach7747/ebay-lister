// Client-side payload budget for POST /api/analyze.
//
// Vercel Functions cap the request body at 4.5 MB and answer anything bigger
// with 413 FUNCTION_PAYLOAD_TOO_LARGE. A real item can have 40+ photos
// (~15 MB of base64), so before analyze we shrink the photos down until the
// serialized JSON fits a comfortable budget (3.2 MB, leaving ~1.3 MB of
// headroom for the rest of the body and the 4.5 MB ceiling).
//
// Budget strategy (in order):
//   1. Total already fits  → send as-is.
//   2. Re-encode every photo at 900px / q0.72.
//   3. Re-encode every photo at 768px / q0.62.
//   4. Evenly SAMPLE (first photo + evenly spaced indices) down to the
//      largest count that fits, after the 768/q0.62 pass. Never empty —
//      at least 1 photo always goes through.
import { shrinkDataUrl } from "./resize";

export interface BudgetImage {
  mediaType: string;
  data: string; // base64, no data: prefix
}

// Serialized size of a payload wrapping these images (same shape as the
// /api/analyze body).
function payloadSize(images: BudgetImage[]): number {
  return JSON.stringify({
    profile: "auto",
    images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })),
    customInstructions: "x".repeat(4000),
  }).length;
}

async function reencodeAll(
  images: BudgetImage[],
  maxDim: number,
  quality: number
): Promise<BudgetImage[]> {
  return Promise.all(
    images.map(async (img) => ({
      mediaType: "image/jpeg",
      data: await shrinkDataUrl(img.data, maxDim, quality),
    }))
  );
}

// Keep the first photo plus evenly spaced indices down to `count`.
function evenSample(images: BudgetImage[], count: number): BudgetImage[] {
  if (count >= images.length) return images;
  if (count <= 1) return [images[0]];
  const out = [images[0]];
  for (let k = 1; k < count - 1; k++) {
    // (count-1) gaps between the first and last kept slot; land the last
    // kept photo on the last index.
    const idx = Math.round((k * (images.length - 1)) / (count - 1));
    if (out[out.length - 1] !== images[idx]) out.push(images[idx]);
  }
  out.push(images[images.length - 1]);
  // De-duplication from rounding can leave extras — trim from the end.
  return out.slice(0, count);
}

export async function fitAnalysisPayload(
  images: BudgetImage[],
  budgetBytes = 3_200_000
): Promise<BudgetImage[]> {
  if (images.length === 0) return images;

  // (a) Already fits — nothing to do.
  if (payloadSize(images) <= budgetBytes) return images;

  // (b) 900px / 0.72.
  let current = await reencodeAll(images, 900, 0.72);
  if (payloadSize(current) <= budgetBytes) return current;

  // (c) 768px / 0.62.
  current = await reencodeAll(current, 768, 0.62);
  if (payloadSize(current) <= budgetBytes) return current;

  // (d) Sample evenly from the 768/0.62 result down to the largest count
  // that fits. Because sampling changes which photos survive, measure the
  // actual sampled payload (binary search on the kept count).
  let lo = 1;
  let hi = current.length;
  let best: BudgetImage[] = [current[0]];
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const sampled = evenSample(current, mid);
    if (payloadSize(sampled) <= budgetBytes) {
      best = sampled;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  console.debug(
    `[payload-budget] analyze payload over budget: sampled ${best.length}/${images.length} photos after 768px re-encode`
  );
  return best;
}
