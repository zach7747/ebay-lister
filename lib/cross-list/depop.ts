import type { ListingResult } from "@/lib/types";

// ── Depop category mapping ──────────────────────────────────────────────────

const DEPOP_CATEGORY_MAP: Record<string, string> = {
  womens_top:       "Tops",
  womens_dress:     "Dresses",
  womens_skirt:     "Skirts",
  womens_pants:     "Trousers",
  womens_coat:      "Jackets & Coats",
  womens_sweater:   "Jumpers & Cardigans",
  womens_jeans:     "Jeans",
  womens_clothing:  "Tops",
  womens_shoes:     "Shoes",
  mens_top:         "Tops",
  mens_pants:       "Trousers",
  mens_coat:        "Jackets & Coats",
  mens_sweater:     "Jumpers & Cardigans",
  mens_jeans:       "Jeans",
  mens_clothing:    "Tops",
  mens_shoes:       "Shoes",
  handbag:          "Bags & Purses",
  wallet:           "Bags & Purses",
  jewelry:          "Jewellery",
  scarf:            "Accessories",
  belt:             "Accessories",
  sunglasses:       "Accessories",
  hat:              "Accessories",
  accessory:        "Accessories",
  doll:             "Toys",
  collectible:      "Other",
  collector_plate:  "Other",
  toy:              "Toys",
  home_decor:       "Home",
  book:             "Books & Magazines",
  knife:            "Other",
  sporting_goods:   "Sports & Outdoor",
  electronics:      "Electronics & Tech",
  camera:           "Electronics & Tech",
  audio:            "Electronics & Tech",
  video_game:       "Electronics & Tech",
  media:            "Other",
  vinyl_record:     "Music",
  cd:               "Music",
  dvd_bluray:       "Other",
  musical_instrument: "Music",
  kitchenware:      "Home",
  glassware:        "Home",
  pottery_ceramics: "Home",
  art:              "Art & Collectables",
  craft:            "Other",
  tool:             "Other",
  automotive:       "Other",
  office:           "Other",
  health_beauty:    "Health & Beauty",
  small_appliance:  "Home",
  lighting:         "Home",
  linens:           "Home",
  holiday:          "Other",
  board_game:       "Toys",
  puzzle:           "Toys",
  plush:            "Toys",
  action_figure:    "Toys",
  trading_card:     "Collectables & Memorabilia",
  sports_memorabilia: "Collectables & Memorabilia",
  coin:             "Collectables & Memorabilia",
  stamp:            "Collectables & Memorabilia",
  ephemera:         "Collectables & Memorabilia",
  other:            "Other",
};

// ── Depop condition mapping ─────────────────────────────────────────────────

const DEPOP_CONDITION_MAP: Record<string, string> = {
  NEW_WITH_TAGS: "New with tags",
  NEW_NO_TAGS: "New without tags",
  EXCELLENT: "Like new",
  VERY_GOOD: "Good",
  GOOD: "Good",
  FAIR: "Worn",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeCondition(condition?: string): string {
  const raw = (condition || "GOOD").trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return DEPOP_CONDITION_MAP[raw] || "Good";
}

function firstColor(color?: string[] | string): string {
  if (!color) return "";
  if (Array.isArray(color)) return color[0] || "";
  return String(color).split(/[/,|&]/)[0].trim();
}

function parsePrice(raw: number | string | undefined): number {
  const n = typeof raw === "string" ? parseFloat(raw) : raw ?? 0;
  if (!n || Number.isNaN(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

// ── Depop limits ────────────────────────────────────────────────────────────

const TITLE_LIMIT = 80;

// ── Exported mapper ─────────────────────────────────────────────────────────

export interface DepopMapped {
  title: string;
  description: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  price: number;
  color: string;
  maxPhotos: number;
}

export function mapToDepop(listing: ListingResult): DepopMapped {
  const catKey = (listing.category || "other").toString();
  const category = DEPOP_CATEGORY_MAP[catKey] || DEPOP_CATEGORY_MAP.other;

  return {
    title: (listing.title || "").slice(0, TITLE_LIMIT),
    description: listing.description || "",
    category,
    brand: (listing.brand || "Unbranded").trim(),
    size: (listing.size || "").trim(),
    condition: normalizeCondition(listing.condition),
    price: parsePrice(listing.suggested_price),
    color: firstColor(listing.color),
    maxPhotos: 4,
  };
}
