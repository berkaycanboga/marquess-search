import * as cheerio from "cheerio";
import { fetchWithTimeout, sleep, CookieJar, HttpError } from "../http";
import { parseTurkishPrice } from "../format";
import { buildVariant, variantsFromDataAttributes, variantsFromLabeledElements } from "../htmlVariants";
import { SOURCE_LABELS, type ProductResult, type ProductVariant, type SourceResult } from "../types";

// John Lucas Fragrances' Shopier store slug, from the notes.
const STORE_SLUG = "jlfragrances";
const STORE_URL = `https://www.shopier.com/${STORE_SLUG}`;
const SEARCH_URL = `https://www.shopier.com/s/api/v1/search_product/${STORE_SLUG}`;

const MAX_DETAIL_FETCHES = 5;
const DETAIL_FETCH_DELAY_MS = 700;

interface RawShopierItem {
  id: string;
  name: string;
  url?: string;
  imageUrl?: string;
  price?: number;
}

export async function searchShopier(query: string): Promise<SourceResult> {
  const start = Date.now();
  const label = SOURCE_LABELS.shopier;

  try {
    const jar = new CookieJar();

    // Step 1: visit the store page like a real browser, to pick up session
    // cookies — a bare POST to the search endpoint gets 403/404 (see notes).
    const homeRes = await fetchWithTimeout(STORE_URL, { headers: { Accept: "text/html" } });
    jar.absorb(homeRes);
    if (!homeRes.ok) {
      throw new HttpError(`Mağaza sayfası ${homeRes.status} döndü`, homeRes.status);
    }
    await homeRes.text();

    await sleep(400);

    // Step 2: replicate the store's own search_elasticsearch.js request, with
    // the session cookie plus Referer/Origin so it looks like it came from the
    // store page itself.
    const body = new URLSearchParams({
      search_query: query,
      username: STORE_SLUG,
      search_as_you_type: "true",
      highlight: "",
    });

    const searchRes = await fetchWithTimeout(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/plain, */*",
        Referer: STORE_URL,
        Origin: "https://www.shopier.com",
        ...(jar.size > 0 ? { Cookie: jar.header() } : {}),
      },
      body: body.toString(),
    });
    jar.absorb(searchRes);

    if (!searchRes.ok) {
      throw new HttpError(
        `Arama isteği ${searchRes.status} döndü — Shopier bu uçta muhtemelen ek bir bot/oturum kontrolü ` +
          `yapıyor (bkz. proje notları). Cookie/Referer denendi; olmazsa headless browser (Playwright) gerekebilir.`,
        searchRes.status,
      );
    }

    const rawItems = (await extractShopierItems(searchRes)).slice(0, 20);

    const settled = await Promise.allSettled(
      rawItems.map(async (item, i) => {
        if (i >= MAX_DETAIL_FETCHES || !item.url) {
          return shopierItemToProduct(item, []);
        }
        if (i > 0) await sleep(DETAIL_FETCH_DELAY_MS);
        try {
          return await hydrateShopierProduct(item, jar);
        } catch {
          return shopierItemToProduct(item, []);
        }
      }),
    );

    const products: ProductResult[] = [];
    let degraded = false;
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) products.push(result.value);
      else degraded = true;
    }

    return { source: "shopier", label, ok: true, degraded, products, tookMs: Date.now() - start };
  } catch (err) {
    return {
      source: "shopier",
      label,
      ok: false,
      error: err instanceof Error ? err.message : "Bilinmeyen hata",
      products: [],
      tookMs: Date.now() - start,
    };
  }
}

async function hydrateShopierProduct(item: RawShopierItem, jar: CookieJar): Promise<ProductResult> {
  const res = await fetchWithTimeout(item.url!, {
    headers: {
      Accept: "text/html",
      Referer: STORE_URL,
      ...(jar.size > 0 ? { Cookie: jar.header() } : {}),
    },
  });
  if (!res.ok) {
    throw new HttpError(`Ürün sayfası ${res.status} döndü`, res.status);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const variants = variantsFromDataAttributes($) ?? variantsFromLabeledElements($) ?? [];
  return shopierItemToProduct(item, variants);
}

function shopierItemToProduct(item: RawShopierItem, variants: ProductVariant[]): ProductResult {
  const finalVariants =
    variants.length > 0
      ? variants
      : item.price != null
        ? // Only the base list price is known — amount=0/ml marks it as not
          // ₺/ml-normalized (unlike esans/Felicita this store sells finished
          // perfume by volume, not raw essence by weight, so it's never
          // comparable to their ₺/gram figures anyway).
          [buildVariant("Liste fiyatı", 0, "ml", item.price)]
        : [];

  return {
    id: item.id,
    source: "shopier",
    name: item.name,
    url: item.url ?? STORE_URL,
    imageUrl: item.imageUrl,
    variants: finalVariants,
  };
}

// --- response parsing --------------------------------------------------------

/**
 * The search endpoint's exact response shape wasn't captured in the source
 * notes (only the request format, reverse-engineered from search_elasticsearch.js).
 * We try several common shapes an Elasticsearch-backed search endpoint might
 * return. If Shopier's real payload doesn't match, run scripts/inspect.mjs
 * against SEARCH_URL (with network access) to see the actual body and adjust
 * `findCandidateArrays`/`normalizeShopierItem` below.
 */
async function extractShopierItems(res: Response): Promise<RawShopierItem[]> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError("Arama cevabı JSON olarak ayrıştırılamadı (Shopier beklenmeyen bir gövde döndürdü)");
  }

  for (const arr of findCandidateArrays(data)) {
    const items = arr.map(normalizeShopierItem).filter((x): x is RawShopierItem => x !== null);
    if (items.length > 0) return items;
  }
  return [];
}

function findCandidateArrays(data: unknown): unknown[][] {
  const arrays: unknown[][] = [];
  if (Array.isArray(data)) arrays.push(data);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["result", "results", "data", "products", "items"]) {
      if (Array.isArray(obj[key])) arrays.push(obj[key] as unknown[]);
    }
    const hits = obj.hits as Record<string, unknown> | undefined;
    if (hits && Array.isArray(hits.hits)) arrays.push(hits.hits as unknown[]);
  }
  return arrays;
}

function normalizeShopierItem(raw: unknown): RawShopierItem | null {
  if (!raw || typeof raw !== "object") return null;
  // Elasticsearch-style hits nest the real document under `_source`.
  const container = raw as Record<string, unknown>;
  const obj = (container._source && typeof container._source === "object" ? container._source : container) as Record<
    string,
    unknown
  >;

  const name = firstString(obj, ["name", "product_name", "title", "productName"]);
  if (!name) return null;

  const id = firstString(obj, ["id", "product_id", "productId", "_id"]) ?? name;
  const slug = firstString(obj, ["url", "slug", "permalink", "product_url", "productUrl"]);
  const image = firstString(obj, ["image", "img", "image_url", "imageUrl", "thumbnail"]);
  const priceRaw = obj.price ?? obj.product_price ?? obj.productPrice;
  const price =
    typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" ? (parseTurkishPrice(priceRaw) ?? undefined) : undefined;

  return {
    id,
    name,
    url: slug ? absolutizeShopier(slug) : undefined,
    imageUrl: image ? absolutizeShopier(image) : undefined,
    price,
  };
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function absolutizeShopier(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path.startsWith("/") ? path : `/${STORE_SLUG}/${path}`, "https://www.shopier.com").toString();
}
