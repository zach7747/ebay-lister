export type WireImage = { mediaType: string; data: string };

// OpenAI-compatible image content part
export type ImageBlock = {
  type: "image_url";
  image_url: { url: string };
};

// Text content part
export type TextBlock = {
  type: "text";
  text: string;
};

export type ChatContentPart = TextBlock | ImageBlock;

type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

// Guard: 5 MB per image
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

// Strip an optional data-url prefix to get raw base64.
function rawBase64(data: string): string {
  return data.includes(",") ? data.split(",")[1] : data;
}

export function toImageBlock(img: WireImage | undefined): ImageBlock | null {
  if (!img?.data || !ALLOWED_MEDIA.has(img.mediaType)) return null;
  const data = rawBase64(img.data);
  if (data.length * 0.75 > MAX_IMAGE_BYTES) return null;
  return {
    type: "image_url",
    image_url: { url: `data:${img.mediaType};base64,${data}` },
  };
}

// Build "Photo N:" text + image content blocks for a set of images.
export function labeledContent(
  images: WireImage[],
  labelStart = 1
): ChatContentPart[] {
  const content: ChatContentPart[] = [];
  images.forEach((img, i) => {
    const block = toImageBlock(img);
    if (!block) return;
    content.push({ type: "text", text: `Photo ${labelStart + i}:` });
    content.push(block);
  });
  return content;
}
