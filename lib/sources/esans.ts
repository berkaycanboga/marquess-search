import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { fetchWithTimeout, sleep, HttpError } from "../http";
import { parseTurkishPrice, parseAmountUnit } from "../format";
import { SOURCE_LABELS, type ProductResult, type ProductVariant, type SourceResult } from "../types";
import {
  PRICE_PATTERN,
  buildVariant,
  extractQuality,
  dedupeVariants,
  variantsFromDataAttributes,
  variantsFromLabeledElements,
} from "../htmlVariants";

const BASE_URL = "https://www.esans.com.tr";

// Politeness: the source notes ask for >1-2s between requests. We only enrich
// the first few search hits with a full gram/quality variant table (one extra
// request per product) to keep a single search fast and polite.
const MAX_DETAIL_FETCHES = 5;
const DETAIL_FETCH_DELAY_MS = 700;

interface RawCard {
  name: string;
  url: string;
  imageUrl?: string;
  quality?: string;
  price?: number;
  inStock?: boolean;
}

export async function searchEsans(query: string): Promise<SourceResult> {
  const start = Date.now();
  const label = SOURCE_LABELS.esans;

  try {
    const searchUrl = `${BASE_URL}/arama?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(searchUrl, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) {
      throw new HttpError(`Arama sayfası ${res.status} döndü`, res.status);
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = extractCardsFromJsonLd($) ?? extractCardsHeuristically($);

    const products: ProductResult[] = [];
    let degraded = false;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      let variants: ProductVariant[] = [];

      if (i < MAX_DETAIL_FETCHES) {
        try {
          if (i > 0) await sleep(DETAIL_FETCH_DELAY_MS);
          variants = await fetchEsansVariants(card.url);
        } catch {
          degraded = true;
        }
      }

      if (variants.length === 0 && card.price != null) {
        // No detail-page variant table found (or not fetched) — fall back to
        // the single price shown on the search card. amount=0 marks it as
        // "not gram-normalized" so it's excluded from ₺/gram comparisons.
        variants = [buildVariant("Liste fiyatı", 0, "gr", card.price, card.quality)];
        degraded = true;
      }

      if (variants.length === 0) continue;

      products.push({
        id: card.url,
        source: "esans",
        name: card.name,
        url: card.url,
        imageUrl: card.imageUrl,
        variants,
      });
    }

    return { source: "esans", label, ok: true, degraded, products, tookMs: Date.now() - start };
  } catch (err) {
    return {
      source: "esans",
      label,
      ok: false,
      error: err instanceof Error ? err.message : "Bilinmeyen hata",
      products: [],
      tookMs: Date.now() - start,
    };
  }
}

async function fetchEsansVariants(productUrl: string): Promise<ProductVariant[]> {
  const res = await fetchWithTimeout(productUrl, {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) {
    throw new HttpError(`Ürün sayfası ${res.status} döndü`, res.status);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  return (
    variantsFromJsonLdOffers($) ??
    variantsFromDataAttributes($) ??
    variantsFromLabeledElements($) ??
    []
  );
}

// --- search-result card extraction -----------------------------------------

function extractCardsFromJsonLd($: CheerioAPI): RawCard[] | null {
  const products: RawCard[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    try {
      collectProductNodes(JSON.parse(raw), products);
    } catch {
      // not valid JSON — ignore this block, other blocks may still work
    }
  });

  return products.length > 0 ? dedupeCardsByUrl(products) : null;
}

function collectProductNodes(node: unknown, out: RawCard[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectProductNodes(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  const type = obj["@type"];
  const typeStr = Array.isArray(type) ? type.join(",") : String(type ?? "");
  if (typeStr.includes("Product")) {
    const card = productNodeToCard(obj);
    if (card) out.push(card);
  }

  if (Array.isArray(obj.itemListElement)) {
    for (const el of obj.itemListElement as unknown[]) collectProductNodes(el, out);
  }
  if (obj.item) collectProductNodes(obj.item, out);
  if (Array.isArray(obj["@graph"])) {
    for (const el of obj["@graph"] as unknown[]) collectProductNodes(el, out);
  }
}

function productNodeToCard(obj: Record<string, unknown>): RawCard | null {
  const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
  const rawUrl = typeof obj.url === "string" ? obj.url : undefined;
  if (!name || !rawUrl) return null;
  const url = absolutize(rawUrl);

  const image = typeof obj.image === "string" ? obj.image : Array.isArray(obj.image) ? String(obj.image[0]) : undefined;

  let price: number | undefined;
  let inStock: boolean | undefined;
  const offersRaw = obj.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
  if (offer && typeof offer === "object") {
    const p = (offer as Record<string, unknown>).price;
    if (typeof p === "number") price = p;
    else if (typeof p === "string") price = parseTurkishPrice(p) ?? undefined;
    const avail = (offer as Record<string, unknown>).availability;
    if (typeof avail === "string") inStock = /instock/i.test(avail);
  }

  return {
    name,
    url,
    imageUrl: image ? absolutize(image) : undefined,
    price,
    inStock,
    quality: extractQuality(name),
  };
}

function extractCardsHeuristically($: CheerioAPI): RawCard[] {
  const cards = new Map<string, RawCard>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || /^(javascript:|#|mailto:|tel:)/i.test(href)) return;
    if (/(sepet|cart|login|uye-|hesap|iletisim|hakkimizda|kampanya|sepetim)/i.test(href)) return;

    const container = $(el).closest("li, article, div").length ? $(el).closest("li, article, div") : $(el).parent();
    const containerText = container.text().replace(/\s+/g, " ");
    const priceMatch = containerText.match(PRICE_PATTERN);
    if (!priceMatch) return;

    const name = ($(el).attr("title") || $(el).text() || "").replace(/\s+/g, " ").trim();
    if (name.length < 3) return;

    const url = absolutize(href);
    if (cards.has(url)) return;

    const price = parseTurkishPrice(priceMatch[0]) ?? undefined;
    const imgSrc = container.find("img").first().attr("src");

    cards.set(url, {
      name,
      url,
      imageUrl: imgSrc ? absolutize(imgSrc) : undefined,
      price,
      quality: extractQuality(containerText),
    });
  });

  return Array.from(cards.values()).slice(0, 20);
}

// --- product-detail variant extraction --------------------------------------

function variantsFromJsonLdOffers($: CheerioAPI): ProductVariant[] | null {
  const variants: ProductVariant[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      collectOfferVariants(node, variants);
    }
  });

  return variants.length > 0 ? dedupeVariants(variants) : null;
}

function collectOfferVariants(node: unknown, out: ProductVariant[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const typeStr = Array.isArray(type) ? type.join(",") : String(type ?? "");

  if (typeStr.includes("Product")) {
    const offersRaw = obj.offers;
    const offers = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
    for (const offer of offers as Record<string, unknown>[]) {
      const priceRaw = offer.price;
      const price = typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" ? parseTurkishPrice(priceRaw) : null;
      if (price == null) continue;
      const label = String(offer.name ?? obj.name ?? "").trim();
      const amountUnit = parseAmountUnit(label) ?? parseAmountUnit(String(offer.sku ?? ""));
      if (!amountUnit) continue;
      const quality = extractQuality(label) ?? extractQuality(String(offer.sku ?? ""));
      out.push(buildVariant(label || `${amountUnit.amount} ${amountUnit.unit}`, amountUnit.amount, amountUnit.unit, price, quality));
    }
  }
  if (Array.isArray(obj["@graph"])) {
    for (const child of obj["@graph"] as unknown[]) collectOfferVariants(child, out);
  }
}

// --- shared helpers ----------------------------------------------------------

function absolutize(url: string): string {
  try {
    return new URL(url, BASE_URL).toString();
  } catch {
    return url;
  }
}

function dedupeCardsByUrl(cards: RawCard[]): RawCard[] {
  const seen = new Set<string>();
  const out: RawCard[] = [];
  for (const card of cards) {
    if (seen.has(card.url)) continue;
    seen.add(card.url);
    out.push(card);
  }
  return out;
}
