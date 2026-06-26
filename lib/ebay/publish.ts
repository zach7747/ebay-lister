// eBay publish pipeline — uses Trading API AddItem with ScheduleTime so
// listings appear in Seller Hub → Scheduled (editable drafts).
//
// Sequence: upload photos → resolve category/condition/aspects → AddItem.
// The Inventory API is only used for category metadata (aspects, conditions).

import {
  EBAY_ACC_BASE,
  EBAY_TRADING,
  EBAY_MARKETPLACE_ID,
} from "./config";
import {
  suggestLeafCategory,
  categoryAspects,
  acceptedConditionIds,
  type AspectMeta,
} from "./taxonomy";
import type { ListingResult } from "@/lib/types";
import { logInfo, logError } from "@/lib/logger";

// ── Category map (category key → eBay leaf category ID) ─────────────────────

const CATEGORY_MAP: Record<string, string> = {
  womens_top: "15724", womens_dress: "63861", womens_skirt: "11554",
  womens_pants: "57988", womens_coat: "57990", womens_sweater: "63864",
  womens_jeans: "11554", womens_clothing: "15724", womens_shoes: "3034",
  mens_top: "57991", mens_pants: "57989", mens_coat: "57988",
  mens_sweater: "11484", mens_jeans: "11483", mens_clothing: "1059",
  mens_shoes: "93427", handbag: "169291", wallet: "2996", jewelry: "281",
  scarf: "45238", belt: "2996", sunglasses: "79720", hat: "52382",
  accessory: "4250", doll: "22733", collectible: "1463", collector_plate: "1467",
  toy: "2550", home_decor: "10033", book: "267", knife: "7313",
  sporting_goods: "159044", electronics: "293", camera: "625", audio: "293",
  video_game: "139973", media: "11232", vinyl_record: "176985", cd: "176984",
  dvd_bluray: "617", musical_instrument: "619", kitchenware: "20625",
  glassware: "50693", pottery_ceramics: "24", art: "550", craft: "14339",
  tool: "631", automotive: "6028", office: "25298", health_beauty: "26395",
  small_appliance: "20667", lighting: "20697", linens: "20444", holiday: "16086",
  board_game: "233", puzzle: "2613", plush: "2624", action_figure: "246",
  trading_card: "183050", sports_memorabilia: "64482", coin: "11116",
  stamp: "260", ephemera: "165800", other: "99",
};

const LEAF_FALLBACKS = ["1463", "22733", "2550", "48108", "316", "171485", "2624", "2613"];

// ── Condition mapping ───────────────────────────────────────────────────────

const CONDITION_ALIASES: Record<string, string> = {
  NEW: "NEW_WITH_TAGS", NWT: "NEW_WITH_TAGS", NEW_WITH_TAGS: "NEW_WITH_TAGS",
  NEW_WITH_BOX: "NEW_WITH_TAGS", NEW_WITHOUT_TAGS: "NEW_NO_TAGS",
  NEW_WITHOUT_BOX: "NEW_NO_TAGS", NEW_NO_TAGS: "NEW_NO_TAGS",
  NEW_OTHER: "NEW_NO_TAGS", OPEN_BOX: "NEW_NO_TAGS", LIKE_NEW: "EXCELLENT",
  PREOWNED_EXCELLENT: "EXCELLENT", PRE_OWNED_EXCELLENT: "EXCELLENT",
  USED_EXCELLENT: "EXCELLENT", EXCELLENT: "EXCELLENT", VERY_GOOD: "VERY_GOOD",
  PREOWNED_VERY_GOOD: "VERY_GOOD", PRE_OWNED_VERY_GOOD: "VERY_GOOD",
  USED_VERY_GOOD: "VERY_GOOD", USED: "GOOD", PREOWNED: "GOOD",
  PRE_OWNED: "GOOD", USED_GOOD: "GOOD", PREOWNED_GOOD: "GOOD",
  PRE_OWNED_GOOD: "GOOD", GOOD: "GOOD", ACCEPTABLE: "FAIR",
  USED_ACCEPTABLE: "FAIR", FAIR: "FAIR", PREOWNED_FAIR: "FAIR",
  PRE_OWNED_FAIR: "FAIR",
};

// Inventory API enum → Trading API numeric ConditionID
const CONDITION_TO_ID: Record<string, number> = {
  NEW: 1000, NEW_OTHER: 1500, NEW_WITH_DEFECTS: 1750,
  LIKE_NEW: 2750, PRE_OWNED_EXCELLENT: 2990, USED_EXCELLENT: 3000,
  PRE_OWNED_FAIR: 3010, USED_VERY_GOOD: 4000, USED_GOOD: 5000,
  USED_ACCEPTABLE: 6000, FOR_PARTS_OR_NOT_WORKING: 7000,
};

const CONDITION_ID_ENUM: Record<number, string> = {
  1000: "NEW", 1500: "NEW_OTHER", 1750: "NEW_WITH_DEFECTS",
  2750: "LIKE_NEW", 2990: "PRE_OWNED_EXCELLENT", 3000: "USED_EXCELLENT",
  3010: "PRE_OWNED_FAIR", 4000: "USED_VERY_GOOD", 5000: "USED_GOOD",
  6000: "USED_ACCEPTABLE", 7000: "FOR_PARTS_OR_NOT_WORKING",
};

const GENERAL_CONDITION_ID_PREFERENCES: Record<string, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750], NEW_NO_TAGS: [1500, 1000, 1750],
  EXCELLENT: [3000, 2750, 4000, 5000], VERY_GOOD: [4000, 3000, 5000, 2750],
  GOOD: [5000, 4000, 3000, 6000], FAIR: [6000, 5000, 4000, 3000],
};

const APPAREL_CONDITION_ID_PREFERENCES: Record<string, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750], NEW_NO_TAGS: [1500, 1000, 1750],
  EXCELLENT: [2990, 3000, 3010], VERY_GOOD: [3000, 2990, 3010],
  GOOD: [3000, 3010, 2990], FAIR: [3010, 3000, 2990],
};

const APPAREL_CATEGORIES = new Set([
  "womens_top", "womens_dress", "womens_skirt", "womens_pants", "womens_coat",
  "womens_sweater", "womens_jeans", "womens_clothing", "womens_shoes", "mens_top",
  "mens_pants", "mens_coat", "mens_sweater", "mens_jeans", "mens_clothing",
  "mens_shoes", "scarf", "belt", "hat",
]);

const ASPECT_DEFAULTS: Record<string, string> = {
  "Skirt Length": "Knee-Length", "Dress Length": "Knee-Length", Rise: "Mid Rise",
  "Leg Style": "Straight", Closure: "Pull-On", "Shoe Width": "Medium",
  "Heel Height": "Flat", "Toe Shape": "Round", Adjustable: "Yes",
  "Exterior Pockets": "Yes", Lining: "Lined", Hood: "No Hood", "Bag Closure": "Zip",
  "Strap Type": "Adjustable", "Hat Style": "Baseball Cap", "Brim Style": "Curved Bill",
  "Size Type": "Regular", Size: "Regular", Style: "Casual", Department: "Unisex Adult",
  Type: "Item", Brand: "Unbranded", Color: "Multicolor", Material: "Mixed Materials",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Convert plain-text listing description to HTML for eBay. */
function textToHtml(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trim();

    // Close list if we hit a non-bullet, non-empty line
    if (inList && (!line.startsWith("- ") && line !== "")) {
      out.push("</ul>");
      inList = false;
    }

    if (line === "") {
      // Blank line — skip (spacing handled by CSS/margins)
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${esc(line.slice(2))}</li>`);
    } else if (/^(Style|Measurements|Condition):/i.test(line)) {
      out.push(`<p><b>${esc(line)}</b></p>`);
    } else {
      out.push(`<p>${esc(line)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  return out.join("");
}

function computeBufferedPrice(raw: number | string | undefined): number {
  let base = typeof raw === "string" ? parseFloat(raw) : raw ?? 0;
  if (!base || Number.isNaN(base) || base <= 0) base = 29.99;
  const buffered = Math.max(base * 1.18, base + 5);
  return Math.round(buffered * 100) / 100;
}

function normalizeConditionInput(value: string | undefined): string {
  const cleaned = (value || "GOOD").trim().toUpperCase()
    .replace(/['']/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return CONDITION_ALIASES[cleaned] || "GOOD";
}

function isApparelConditionPolicy(acceptedIds: Set<number>): boolean {
  return acceptedIds.has(2990) || acceptedIds.has(3010);
}

function conditionIdsForGrade(grade: string, acceptedIds: Set<number>): number[] {
  const apparel = isApparelConditionPolicy(acceptedIds);
  const prefs = apparel ? APPAREL_CONDITION_ID_PREFERENCES : GENERAL_CONDITION_ID_PREFERENCES;
  const preferred = prefs[grade] || prefs.GOOD;
  if (!acceptedIds.size) return preferred;
  const out: number[] = [];
  const add = (id: number) => {
    if (acceptedIds.has(id) && CONDITION_ID_ENUM[id] && !out.includes(id)) out.push(id);
  };
  for (const id of preferred) add(id);
  for (const id of [3000, 4000, 5000, 6000, 2750, 1500, 1000, 1750, 7000]) add(id);
  for (const id of acceptedIds) add(id);
  return out.length ? out : preferred;
}

function resolveCategory(listing: ListingResult): { categoryId: string; fallbacks: string[] } {
  const explicit = (listing.category_id || "").toString().trim();
  const catKey = (listing.category || "other").toString();
  const mapped = CATEGORY_MAP[catKey] || CATEGORY_MAP.other;
  return { categoryId: explicit || mapped, fallbacks: LEAF_FALLBACKS.filter(c => c && c !== (explicit || mapped)) };
}

const MAX_ASPECT_VALUE_LEN = 65;
function clipAspectValue(s: string): string {
  const t = (s || "").trim();
  if (t.length <= MAX_ASPECT_VALUE_LEN) return t;
  const cut = t.slice(0, MAX_ASPECT_VALUE_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_ASPECT_VALUE_LEN * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function singleValue(v: unknown): string {
  if (Array.isArray(v)) { for (const x of v) { const s = singleValue(x); if (s) return s; } return ""; }
  let s = String(v ?? "").trim();
  if (!s) return "";
  for (const sep of ["/", ",", "|", "&", " and "]) { if (s.includes(sep)) { s = s.split(sep)[0].trim(); break; } }
  return s.replace(/\s+/g, " ");
}

function departmentForCategory(catKey: string): string {
  if (catKey.startsWith("womens_")) return "Women";
  if (catKey.startsWith("mens_")) return "Men";
  return "Unisex Adult";
}

function buildAspects(listing: ListingResult, catKey: string): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const put = (k: string, v: string) => { const val = clipAspectValue(v); if (val) aspects[k] = [val]; };
  put("Brand", String(listing.brand || "").trim());
  put("Size", String(listing.size || "").trim());
  put("Color", singleValue(listing.color));
  put("Material", singleValue(listing.material));
  put("Type", String(listing.item_type || "").trim());
  const feats = (Array.isArray(listing.key_features) ? listing.key_features : [])
    .map(f => clipAspectValue(String(f))).filter(Boolean).slice(0, 5);
  if (feats.length) aspects.Features = feats;
  if (APPAREL_CATEGORIES.has(catKey) || catKey === "accessory") {
    aspects.Department = [departmentForCategory(catKey)];
  }
  for (const [k, v] of Object.entries(listing.item_specifics || {})) {
    if (!k || k.startsWith("---")) continue;
    const val = clipAspectValue(singleValue(v));
    if (val && !aspects[k]) aspects[k] = [val];
  }
  return aspects;
}

function matchAllowed(value: string, allowed: string[]): string | null {
  const ls = (value || "").trim().toLowerCase();
  if (!ls) return null;
  for (const v of allowed) {
    const lv = v.toLowerCase();
    if (lv === ls || lv === `${ls}s` || `${lv}s` === ls) return v;
  }
  return null;
}

function pickDepartment(allowed: string[], listing: ListingResult, catKey: string): string {
  const text = `${catKey} ${listing.title || ""} ${listing.item_type || ""} ${listing.item_specifics?.Department || ""}`.toLowerCase();
  const women = catKey.startsWith("womens_") || /\b(women|woman|ladies|female|girl)\b/.test(text);
  const men = catKey.startsWith("mens_") || /\b(men|man|male|boy)\b/.test(text);
  const pref = women
    ? ["Women", "Women's", "Girls", "Unisex Adults", "Unisex Kids", "Unisex"]
    : men
      ? ["Men", "Men's", "Boys", "Unisex Adults", "Unisex Kids", "Unisex"]
      : ["Unisex Adults", "Unisex Kids", "Unisex", "Women", "Men"];
  for (const p of pref) { const m = matchAllowed(p, allowed); if (m) return m; }
  return allowed[0] || "";
}

function freeTextDefault(name: string, listing: ListingResult): string {
  const n = name.toLowerCase();
  if (n.includes("brand")) return String(listing.brand || "").trim() || "Unbranded";
  if (n.includes("color")) return singleValue(listing.color) || "Multicolor";
  if (n.includes("shoe size") || n === "size") return String(listing.size || "").trim();
  if (n.includes("material")) return singleValue(listing.material) || "Man Made";
  if (n.includes("style")) return String(listing.item_specifics?.Style || listing.item_type || "").trim();
  if (n.includes("type")) return String(listing.item_type || "").trim();
  return "";
}

function reconcileAspects(
  aspects: Record<string, string[]>, meta: AspectMeta[], listing: ListingResult, catKey: string
): void {
  for (const a of meta) {
    if (!a.required || !a.name) continue;
    const current = aspects[a.name]?.[0];
    if (a.mode === "SELECTION_ONLY") {
      const canonical = matchAllowed(current || "", a.values) ||
        matchAllowed(ASPECT_DEFAULTS[a.name] || "", a.values) ||
        (a.name === "Department" ? pickDepartment(a.values, listing, catKey) : "") ||
        a.values[0] || "";
      if (canonical) aspects[a.name] = [canonical];
    } else if (!current) {
      const v = freeTextDefault(a.name, listing) || ASPECT_DEFAULTS[a.name] || a.values[0] || "";
      const clipped = clipAspectValue(v);
      if (clipped) aspects[a.name] = [clipped];
    }
  }
}

// ── Photo upload (Trading API — unchanged) ─────────────────────────────────

async function uploadPhoto(
  accessToken: string, base64: string, mediaType: string, name: string
): Promise<string | null> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <PictureName>${esc(name.slice(0, 50))}</PictureName>
  <PictureUploadPolicy>ClearAndNew</PictureUploadPolicy>
</UploadSiteHostedPicturesRequest>`;
  const data = base64.includes(",") ? base64.split(",")[1] : base64;
  const bytes = Buffer.from(data, "base64");
  const form = new FormData();
  form.append("XML Payload", new Blob([xml], { type: "text/xml;charset=utf-8" }), "payload.xml");
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mediaType }), name);
  const resp = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: form,
  });
  const text = await resp.text();
  const m = text.match(/<FullURL>([^<]+)<\/FullURL>/);
  return m ? m[1] : null;
}

// ── Trading API AddItem ─────────────────────────────────────────────────────

async function addItemViaTradingApi(
  accessToken: string,
  item: {
    title: string;
    description: string;
    categoryId: string;
    conditionId: number;
    conditionDescription?: string;
    price: number;
    photoUrls: string[];
    aspects: Record<string, string[]>;
    scheduleTime: string; // ISO 8601
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    location: string;
    postalCode: string;
  }
): Promise<{ success: boolean; itemId?: string; fees?: string; error?: string }> {
  // Build ItemSpecifics XML
  let itemSpecificsXml = "";
  for (const [name, values] of Object.entries(item.aspects)) {
    if (!values.length) continue;
    const nameValuePairs = values.map(v => `<NameValueList><Name>${esc(name)}</Name><Value>${esc(v)}</Value></NameValueList>`).join("");
    itemSpecificsXml += nameValuePairs;
  }

  // Build PictureDetails XML
  const pictureDetailsXml = item.photoUrls
    .map(url => `<PictureURL>${esc(url)}</PictureURL>`)
    .join("");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${esc(item.title.slice(0, 80))}</Title>
    <Description><![CDATA[${textToHtml(item.description)}]]></Description>
    <PrimaryCategory><CategoryID>${esc(item.categoryId)}</CategoryID></PrimaryCategory>
    <ConditionID>${item.conditionId}</ConditionID>${item.conditionDescription ? `
    <ConditionDescription>${esc(item.conditionDescription)}</ConditionDescription>` : ""}
    <ScheduleTime>${item.scheduleTime}</ScheduleTime>
    <Country>US</Country>
    <Currency>USD</Currency>
    <Location>${esc(item.location)}</Location>
    <PostalCode>${esc(item.postalCode)}</PostalCode>
    <DispatchTimeMax>1</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <StartPrice>${item.price.toFixed(2)}</StartPrice>
    <Quantity>1</Quantity>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <PictureDetails>${pictureDetailsXml}</PictureDetails>
    <ItemSpecifics>${itemSpecificsXml}</ItemSpecifics>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSFirstClass</ShippingService>
        <ShippingServiceCost>5.99</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <PackageWeightAndSize>
      <WeightMajor>1</WeightMajor>
      <WeightMajorUnit>lbs</WeightMajorUnit>
      <Length>12</Length>
      <Width>10</Width>
      <Height>2</Height>
      <DimensionsUnit>in</DimensionsUnit>
    </PackageWeightAndSize>
  </Item>
</AddItemRequest>`;

  const resp = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-CALL-NAME": "AddItem",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: xml,
  });

  const text = await resp.text();
  const ackMatch = text.match(/<Ack>(\w+)<\/Ack>/);
  const ack = ackMatch?.[1] || "";
  const itemIdMatch = text.match(/<ItemID>(\d+)<\/ItemID>/);
  const itemId = itemIdMatch?.[1];

  if (ack === "Success" || ack === "Warning") {
    // Extract fees
    const feeMatches = [...text.matchAll(/<Fee[^>]*currencyID="USD"[^>]*>([\d.]+)<\/Fee>/g)];
    const totalFees = feeMatches.reduce((sum, m) => sum + parseFloat(m[1] || "0"), 0);
    return { success: true, itemId, fees: totalFees.toFixed(2) };
  }

  // Extract error
  const shortMsg = text.match(/<ShortMessage>([^<]*)<\/ShortMessage>/)?.[1] || "";
  const longMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] || "";
  const errCode = text.match(/<ErrorCode>(\d+)<\/ErrorCode>/)?.[1] || "";
  return { success: false, error: `${errCode}: ${shortMsg || longMsg || text.slice(0, 300)}` };
}

// ── Policies ───────────────────────────────────────────────────────────────

export interface AccountSetup {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  locationKey: string;
}

function pickFirstPolicy(text: string, listKey: string, idField: string): string {
  try {
    const json = JSON.parse(text);
    const list = json?.[listKey] || [];
    return list.length ? String(list[0][idField] || "") : "";
  } catch { return ""; }
}

export async function fetchAccountSetup(accessToken: string): Promise<AccountSetup> {
  const mp = `marketplace_id=${EBAY_MARKETPLACE_ID}`;
  const hdrs = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "en-US" };
  const [ful, pay, ret] = await Promise.all([
    fetch(`${EBAY_ACC_BASE}/fulfillment_policy?${mp}`, { headers: hdrs }).then(r => r.text()),
    fetch(`${EBAY_ACC_BASE}/payment_policy?${mp}`, { headers: hdrs }).then(r => r.text()),
    fetch(`${EBAY_ACC_BASE}/return_policy?${mp}`, { headers: hdrs }).then(r => r.text()),
  ]);
  return {
    fulfillmentPolicyId: pickFirstPolicy(ful, "fulfillmentPolicies", "fulfillmentPolicyId"),
    paymentPolicyId: pickFirstPolicy(pay, "paymentPolicies", "paymentPolicyId"),
    returnPolicyId: pickFirstPolicy(ret, "returnPolicies", "returnPolicyId"),
    locationKey: "HOME_OFFICE",
  };
}

// ── Main publish flow ──────────────────────────────────────────────────────

export interface PublishInput {
  sku: string;
  listing: ListingResult;
  images: { mediaType: string; data: string }[];
  draft?: boolean;
}

export interface PublishResult {
  success: boolean;
  sku: string;
  listingId?: string;
  offerId?: string;
  error?: string;
}

export async function publishListing(
  accessToken: string,
  setup: AccountSetup,
  input: PublishInput
): Promise<PublishResult> {
  const { sku, listing } = input;
  const catKey = String(listing.category || "other");
  const { categoryId: staticCat, fallbacks } = resolveCategory(listing);

  // Resolve best leaf category
  let catId: string;
  try {
    const leaf = await suggestLeafCategory(`${listing.category_hint || ""} ${listing.title || ""}`);
    catId = leaf || staticCat;
  } catch { catId = staticCat; }

  if (!setup.fulfillmentPolicyId || !setup.paymentPolicyId || !setup.returnPolicyId) {
    return { success: false, sku, error: "Your eBay account is missing a business policy (payment, shipping, or returns). Set these up in eBay → Account → Business policies, then try again." };
  }

  // 1. Upload photos → EPS URLs.
  const photoUrls: string[] = [];
  for (const img of input.images.slice(0, 12)) {
    const url = await uploadPhoto(accessToken, img.data, img.mediaType, `${sku}.jpg`);
    if (url) photoUrls.push(url);
  }
  if (!photoUrls.length) return { success: false, sku, error: "Could not upload any photos to eBay." };

  // 2. Build item specifics & resolve condition.
  const aspects = buildAspects(listing, catKey);
  let acceptedConds = new Set<number>();
  try {
    const [meta, conds] = await Promise.all([
      categoryAspects(catId),
      acceptedConditionIds(catId),
    ]);
    if (meta.length) reconcileAspects(aspects, meta, listing, catKey);
    acceptedConds = conds;
  } catch { /* taxonomy unavailable — proceed with best-effort */ }

  const grade = normalizeConditionInput(listing.condition);
  const condIdCandidates = conditionIdsForGrade(grade, acceptedConds);
  let conditionId = condIdCandidates[0] || 3000;

  // 3. Schedule 24 hours from now (appears in Seller Hub → Scheduled).
  const scheduleTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // 4. Resolve location info
  const postalCode = process.env.EBAY_LOCATION_POSTAL_CODE || "98270";
  const location = process.env.EBAY_LOCATION || "Marysville, WA";

  // 5. Try AddItem with the best category/condition; fall back if needed.
  const categoriesToTry = [catId, ...fallbacks];

  for (const tryCat of categoriesToTry) {
    for (const tryCond of [conditionId, ...condIdCandidates.filter(c => c !== conditionId)]) {
      logInfo("ebay/publish", `Trying AddItem: SKU=${sku}, cat=${tryCat}, conditionId=${tryCond}`);

      const result = await addItemViaTradingApi(accessToken, {
        title: listing.title || "Untitled",
        description: listing.description || "",
        categoryId: tryCat,
        conditionId: tryCond,
        conditionDescription: listing.condition_notes || undefined,
        price: computeBufferedPrice(listing.suggested_price),
        photoUrls,
        aspects,
        scheduleTime,
        fulfillmentPolicyId: setup.fulfillmentPolicyId,
        paymentPolicyId: setup.paymentPolicyId,
        returnPolicyId: setup.returnPolicyId,
        location,
        postalCode,
      });

      if (result.success) {
        logInfo("ebay/publish", `Scheduled SKU ${sku} → item ${result.itemId} (scheduled for ${scheduleTime})`);
        return { success: true, sku, listingId: result.itemId };
      }

      const err = result.error || "";
      logError("ebay/publish", `AddItem failed for SKU ${sku}: ${err}`);

      // If eBay suggests a specific condition ID, inject it and retry
      const suggestedCond = err.match(/(?:applicable|valid) condition id (?:is|are)[\s:]*([\d, ]+)/i);
      if (suggestedCond) {
        const ids = (suggestedCond[1].match(/\d+/g) || []).map(Number);
        for (const id of ids) {
          if (!condIdCandidates.includes(id)) condIdCandidates.unshift(id);
        }
        conditionId = ids[0] || conditionId;
        logInfo("ebay/publish", `eBay suggested condition IDs: ${ids.join(", ")} -- retrying`);
        continue;
      }
      // If it's a condition error, try next condition
      if (/condition/i.test(err) || /25021|25059|21919168/i.test(err)) continue;
      // If it's a category error, break to try next category
      if (/category|25005|25006/i.test(err)) break;
      // Any other error — return it
      return { success: false, sku, error: err };
    }
  }

  return { success: false, sku, error: `Could not list item after trying all category/condition combinations.` };
}
