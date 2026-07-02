import type { ListingResult } from "@/lib/types";

// ── Poshmark category mapping ───────────────────────────────────────────────

interface PoshmarkCategory {
  category: string;
  subcategory: string;
}

const POSHMARK_CATEGORY_MAP: Record<string, PoshmarkCategory> = {
  womens_top:       { category: "Women", subcategory: "Tops" },
  womens_dress:     { category: "Women", subcategory: "Dresses" },
  womens_skirt:     { category: "Women", subcategory: "Skirts" },
  womens_pants:     { category: "Women", subcategory: "Pants & Jumpsuits" },
  womens_coat:      { category: "Women", subcategory: "Jackets & Coats" },
  womens_sweater:   { category: "Women", subcategory: "Sweaters" },
  womens_jeans:     { category: "Women", subcategory: "Jeans" },
  womens_clothing:  { category: "Women", subcategory: "Tops" },
  womens_shoes:     { category: "Women", subcategory: "Shoes" },
  mens_top:         { category: "Men", subcategory: "Tops" },
  mens_pants:       { category: "Men", subcategory: "Pants" },
  mens_coat:        { category: "Men", subcategory: "Jackets & Coats" },
  mens_sweater:     { category: "Men", subcategory: "Sweaters" },
  mens_jeans:       { category: "Men", subcategory: "Jeans" },
  mens_clothing:    { category: "Men", subcategory: "Tops" },
  mens_shoes:       { category: "Men", subcategory: "Shoes" },
  handbag:          { category: "Women", subcategory: "Bags" },
  wallet:           { category: "Women", subcategory: "Bags" },
  jewelry:          { category: "Women", subcategory: "Jewelry" },
  scarf:            { category: "Women", subcategory: "Accessories" },
  belt:             { category: "Women", subcategory: "Accessories" },
  sunglasses:       { category: "Women", subcategory: "Accessories" },
  hat:              { category: "Women", subcategory: "Accessories" },
  accessory:        { category: "Women", subcategory: "Accessories" },
  doll:             { category: "Kids", subcategory: "Toys" },
  collectible:      { category: "Other", subcategory: "Miscellaneous" },
  collector_plate:  { category: "Other", subcategory: "Miscellaneous" },
  toy:              { category: "Kids", subcategory: "Toys" },
  home_decor:       { category: "Home", subcategory: "Home Decor" },
  book:             { category: "Other", subcategory: "Miscellaneous" },
  knife:            { category: "Other", subcategory: "Miscellaneous" },
  sporting_goods:   { category: "Other", subcategory: "Miscellaneous" },
  electronics:      { category: "Other", subcategory: "Miscellaneous" },
  camera:           { category: "Other", subcategory: "Miscellaneous" },
  audio:            { category: "Other", subcategory: "Miscellaneous" },
  video_game:       { category: "Other", subcategory: "Miscellaneous" },
  media:            { category: "Other", subcategory: "Miscellaneous" },
  vinyl_record:     { category: "Other", subcategory: "Miscellaneous" },
  cd:               { category: "Other", subcategory: "Miscellaneous" },
  dvd_bluray:       { category: "Other", subcategory: "Miscellaneous" },
  musical_instrument: { category: "Other", subcategory: "Miscellaneous" },
  kitchenware:      { category: "Home", subcategory: "Home Decor" },
  glassware:        { category: "Home", subcategory: "Home Decor" },
  pottery_ceramics: { category: "Home", subcategory: "Home Decor" },
  art:              { category: "Other", subcategory: "Miscellaneous" },
  craft:            { category: "Other", subcategory: "Miscellaneous" },
  tool:             { category: "Other", subcategory: "Miscellaneous" },
  automotive:       { category: "Other", subcategory: "Miscellaneous" },
  office:           { category: "Other", subcategory: "Miscellaneous" },
  health_beauty:    { category: "Other", subcategory: "Miscellaneous" },
  small_appliance:  { category: "Home", subcategory: "Home Decor" },
  lighting:         { category: "Home", subcategory: "Home Decor" },
  linens:           { category: "Home", subcategory: "Home Decor" },
  holiday:          { category: "Other", subcategory: "Miscellaneous" },
  board_game:       { category: "Kids", subcategory: "Toys" },
  puzzle:           { category: "Kids", subcategory: "Toys" },
  plush:            { category: "Kids", subcategory: "Toys" },
  action_figure:    { category: "Kids", subcategory: "Toys" },
  trading_card:     { category: "Other", subcategory: "Miscellaneous" },
  sports_memorabilia: { category: "Other", subcategory: "Miscellaneous" },
  coin:             { category: "Other", subcategory: "Miscellaneous" },
  stamp:            { category: "Other", subcategory: "Miscellaneous" },
  ephemera:         { category: "Other", subcategory: "Miscellaneous" },
  other:            { category: "Other", subcategory: "Miscellaneous" },
};

// ── Poshmark condition mapping ──────────────────────────────────────────────

const POSHMARK_CONDITION_MAP: Record<string, string> = {
  NEW_WITH_TAGS: "NWT",
  NEW_NO_TAGS: "NWOT",
  EXCELLENT: "Excellent",
  VERY_GOOD: "Good",
  GOOD: "Good",
  FAIR: "Fair",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeCondition(condition?: string): string {
  const raw = (condition || "GOOD").trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return POSHMARK_CONDITION_MAP[raw] || "Good";
}

function firstColor(color?: string[] | string): string {
  if (!color) return "";
  if (Array.isArray(color)) return color[0] || "";
  return String(color).split(/[/,|&]/)[0].trim();
}

function parsePrice(raw: number | string | undefined): number {
  const n = typeof raw === "string" ? parseFloat(raw) : raw ?? 0;
  if (!n || Number.isNaN(n) || n <= 0) return 3;
  return Math.max(Math.round(n * 100) / 100, 3);
}

// ── Poshmark limits ─────────────────────────────────────────────────────────

const TITLE_LIMIT = 80;
const DESCRIPTION_LIMIT = 8000;

// ── Exported mapper ─────────────────────────────────────────────────────────

export interface PoshmarkMapped {
  title: string;
  description: string;
  category: string;
  subcategory: string;
  brand: string;
  size: string;
  condition: string;
  price: number;
  color: string;
}

export function mapToPoshmark(listing: ListingResult): PoshmarkMapped {
  const catKey = (listing.category || "other").toString();
  const mapped = POSHMARK_CATEGORY_MAP[catKey] || POSHMARK_CATEGORY_MAP.other;

  return {
    title: (listing.title || "").slice(0, TITLE_LIMIT),
    description: (listing.description || "").slice(0, DESCRIPTION_LIMIT),
    category: mapped.category,
    subcategory: mapped.subcategory,
    brand: (listing.brand || "Unbranded").trim(),
    size: (listing.size || "").trim(),
    condition: normalizeCondition(listing.condition),
    price: parsePrice(listing.suggested_price),
    color: firstColor(listing.color),
  };
}
