// Shape of a generated listing. Mirrors the JSON the model returns in the
// Python script's analyze_photos(), plus the routed profile.

export interface ListingResult {
  title: string;
  category?: string;
  category_hint?: string;
  category_id?: string;
  brand?: string;
  item_type?: string;
  color?: string[] | string;
  size?: string;
  material?: string;
  condition?: string;
  condition_notes?: string;
  measurements?: string;
  description: string;
  suggested_price?: number | string;
  seo_keywords?: string[];
  key_features?: string[];
  item_specifics?: Record<string, string>;
  item_profile?: string;
}

export interface AnalyzeRequestBody {
  // Browser-resized JPEG data URLs or raw base64 strings.
  images: { mediaType: string; data: string }[];
  // Blob pathnames (from /api/photo-upload) when the photos were stored in
  // Vercel Blob instead of sent inline. When present and non-empty the
  // analyze route fetches each ref from the private store.
  photoRefs?: string[];
  profile: string;
  customInstructions?: string;
}

export interface AnalyzeResponse {
  ok: boolean;
  listing?: ListingResult;
  error?: string;
}

export interface SortResponse {
  ok: boolean;
  groups?: { name: string; photoIndices: number[] }[];
  orphanIndices?: number[];
  error?: string;
}

// ── Client-side working model for the bulk flow ──────────────────────────────

export interface Photo {
  id: string;
  previewUrl: string;
  mediaType: string;
  data: string; // base64, no prefix
}

export type ItemStatus = "idle" | "writing" | "done" | "error";

export type PostStatus = "idle" | "posting" | "posted" | "error";

export type ShippingOption = "light" | "medium" | "heavy";

export type PlatformStatus = "idle" | "listed" | "skipped";

export interface PlatformListingStatus {
  status: PlatformStatus;
  url?: string;
}

export interface ItemGroup {
  id: string;
  sku: string; // bin reference, e.g. "K75-A"
  name: string;
  photoIds: string[];
  listing?: ListingResult;
  status: ItemStatus;
  error?: string;
  shippingOption?: ShippingOption;
  // eBay posting state (Phase 2)
  postStatus?: PostStatus;
  listingId?: string;
  postError?: string;
  // Cross-listing state
  crossList?: {
    poshmark?: PlatformListingStatus;
    depop?: PlatformListingStatus;
  };
}
