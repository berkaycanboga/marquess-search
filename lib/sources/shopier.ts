import * as cheerio from "cheerio";
import type { Page } from "playwright-core";
import { fetchWithTimeout, sleep, withTimeout, CookieJar, HttpError, BROWSER_USER_AGENT } from "../http";
import { launchBrowser } from "../browser";
import { parseTurkishPrice } from "../format";
import { PRICE_PATTERN, buildVariant, variantsFromDataAttributes, variantsFromLabeledElements } from "../htmlVariants";
import { SOURCE_LABELS, type ProductResult, type ProductVariant, type SourceResult } from "../types";

// John Lucas Fragrances' Shopier store slug, from the notes.
const STORE_SLUG = "jlfragrances";
const STORE_URL = `https://www.shopier.com/${STORE_SLUG}`;
const SEARCH_URL = `https://www.shopier.com/s/api/v1/search_product/${STORE_SLUG}`;

const MAX_DETAIL_FETCHES = 5;
const DETAIL_FETCH_DELAY_MS = 700;
const BROWSER_FALLBACK_TIMEOUT_MS = 30_000;

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
    let items: RawShopierItem[];
    let jar = new CookieJar();

    try {
      const httpResult = await fetchShopierSearchViaHttp(query);
      items = httpResult.items;
      jar = httpResult.jar;
    } catch (httpErr) {
      // Plain HTTP got blocked (see notes: Shopier's WAF appears to fingerprint
      // at the TLS/JS level, not just headers) — fall back to a real headless
      // browser, which carries a genuine browser fingerprint. See lib/browser.ts.
      try {
        items = await withTimeout(
          fetchShopierSearchViaBrowser(query),
          BROWSER_FALLBACK_TIMEOUT_MS,
          `Headless browser denemesi ${BROWSER_FALLBACK_TIMEOUT_MS}ms içinde tamamlanamadı`,
        );
      } catch (browserErr) {
        const httpMsg = httpErr instanceof Error ? httpErr.message : "istek başarısız";
        const browserMsg = browserErr instanceof Error ? browserErr.message : "bilinmeyen hata";
        throw new HttpError(`${httpMsg} — headless browser denemesi de başarısız oldu: ${browserMsg}`);
      }
    }

    const rawItems = items.slice(0, 20);

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

// --- search: plain HTTP (fast path) ------------------------------------------

async function fetchShopierSearchViaHttp(query: string): Promise<{ items: RawShopierItem[]; jar: CookieJar }> {
  const jar = new CookieJar();

  // Visit the store page like a real browser, to pick up session cookies —
  // a bare POST to the search endpoint gets 403/404 (see notes).
  const homeRes = await fetchWithTimeout(STORE_URL, { headers: { Accept: "text/html" } });
  jar.absorb(homeRes);
  if (!homeRes.ok) {
    throw new HttpError(`Mağaza sayfası ${homeRes.status} döndü`, homeRes.status);
  }
  await homeRes.text();

  await sleep(400);

  // Replicate the store's own search_elasticsearch.js request, with the
  // session cookie plus Referer/Origin so it looks like it came from the
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
      "X-Requested-With": "XMLHttpRequest",
      Referer: STORE_URL,
      Origin: "https://www.shopier.com",
      ...(jar.size > 0 ? { Cookie: jar.header() } : {}),
    },
    body: body.toString(),
  });
  jar.absorb(searchRes);

  if (!searchRes.ok) {
    throw new HttpError(`Arama isteği ${searchRes.status} döndü`, searchRes.status);
  }

  const text = await searchRes.text();
  return { items: parseShopierSearchPayload(text), jar };
}

// --- search: headless browser (fallback path) --------------------------------

async function fetchShopierSearchViaBrowser(query: string): Promise<RawShopierItem[]> {
  const { browser, cleanup } = await launchBrowser();
  try {
    const context = await browser.newContext({ userAgent: BROWSER_USER_AGENT });
    const page = await context.newPage();
    await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await dismissPopup(page);

    try {
      return await searchViaRealInput(page, query);
    } catch (inputErr) {
      try {
        return await searchViaDirectFetch(page, query);
      } catch (fetchErr) {
        const inputMsg = inputErr instanceof Error ? inputErr.message : "bilinmeyen hata";
        const fetchMsg = fetchErr instanceof Error ? fetchErr.message : "bilinmeyen hata";
        throw new HttpError(`gerçek arama kutusu denemesi başarısız (${inputMsg}); doğrudan istek denemesi de başarısız (${fetchMsg})`);
      }
    }
  } finally {
    await cleanup();
  }
}

// Confirmed against the store's real markup (user-supplied): the search bar
// lives behind a Bootstrap-style dropdown toggle, and results render into an
// initially-empty <ul id="shopier-es--results"> with NO page navigation and
// NO URL change — so there may not even be a plain request/response to
// intercept (could be filtering an already-loaded list client-side). Reading
// the rendered DOM after typing is the only approach that works regardless.
const SEARCH_TOGGLE_SELECTOR = ".shopier-es .dropdown-toggle, .dropdown-toggle";
const SEARCH_INPUT_SELECTOR = '#shopier-es--input, input[name="search"], .shopier--search-input';
const SEARCH_RESULTS_SELECTOR = "#shopier-es--results, .shopier-es--results";

/**
 * Types into the store's own search box and reads the results it renders
 * into its dropdown — the notes' recommended last resort, and the only
 * approach that doesn't depend on guessing a request/response shape we have
 * no confirmed visibility into. The inner <li> markup for a populated result
 * is still a guess (unverified — we only have the empty-state container); if
 * this keeps coming back with 0 items despite a query that should have hits,
 * share the populated dropdown's HTML/screenshot to pin down the real shape.
 */
async function searchViaRealInput(page: Page, query: string): Promise<RawShopierItem[]> {
  const toggle = page.locator(SEARCH_TOGGLE_SELECTOR).first();
  if ((await toggle.count().catch(() => 0)) > 0) {
    await toggle.click({ timeout: 3000 }).catch(() => {});
  }

  const input = page.locator(SEARCH_INPUT_SELECTOR).first();
  if ((await input.count().catch(() => 0)) === 0) {
    throw new HttpError("Arama kutusu bulunamadı (#shopier-es--input eşleşmedi)");
  }

  await input.click({ timeout: 5000 });
  await input.fill("").catch(() => {});
  await input.pressSequentially(query, { delay: 80, timeout: 15_000 });

  const results = page.locator(SEARCH_RESULTS_SELECTOR).first();
  try {
    await results.locator("li").first().waitFor({ state: "attached", timeout: 10_000 });
  } catch {
    // Debounce elapsed with nothing rendered — either a genuine "no matches"
    // or the widget never populated at all; either way there's nothing to read.
    return [];
  }

  const rawItems = await results.locator("li").evaluateAll((lis) =>
    lis.map((li) => ({
      href: li.querySelector("a")?.getAttribute("href") ?? null,
      text: (li.textContent ?? "").replace(/\s+/g, " ").trim(),
      imgSrc: li.querySelector("img")?.getAttribute("src") ?? null,
    })),
  );

  return rawItems.map(normalizeShopierListItem).filter((x): x is RawShopierItem => x !== null);
}

function normalizeShopierListItem(item: { href: string | null; text: string; imgSrc: string | null }): RawShopierItem | null {
  if (!item.text) return null;
  const priceMatch = item.text.match(PRICE_PATTERN);
  const price = priceMatch ? (parseTurkishPrice(priceMatch[0]) ?? undefined) : undefined;
  const name = (priceMatch ? item.text.replace(priceMatch[0], "") : item.text).trim();
  if (!name) return null;

  return {
    id: item.href ?? name,
    name,
    url: item.href ? absolutizeShopier(item.href) : undefined,
    imageUrl: item.imgSrc ? absolutizeShopier(item.imgSrc) : undefined,
    price,
  };
}

/**
 * Fallback when the real search box isn't found: fire the same request
 * search_elasticsearch.js would, from within the page's own JS context (real
 * TLS/JS fingerprint, real cookies) — reuses the exact same parsing as the
 * plain-HTTP path.
 */
async function searchViaDirectFetch(page: Page, query: string): Promise<RawShopierItem[]> {
  const requestBody = new URLSearchParams({
    search_query: query,
    username: STORE_SLUG,
    search_as_you_type: "true",
    highlight: "",
  }).toString();

  const result = await page.evaluate(
    async ({ url, requestBody }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: requestBody,
      });
      return { status: res.status, text: await res.text() };
    },
    { url: SEARCH_URL, requestBody },
  );

  if (result.status < 200 || result.status >= 300) {
    throw new HttpError(`Arama isteği (headless browser) ${result.status} döndü`, result.status);
  }

  return parseShopierSearchPayload(result.text);
}

/**
 * Shopier stores commonly show a discount/newsletter popup on first visit.
 * It doesn't block the fetch() call made from page.evaluate below, but it can
 * leave the page in a state a real, fully-loaded session wouldn't be in — so
 * we make a best-effort attempt to close it like a real visitor would before
 * issuing the search request. Selectors are generic guesses (unverified
 * against the live markup, see scripts/inspect.mjs); Escape is a cheap,
 * safe fallback that closes most modal implementations regardless of markup.
 *
 * The wait here also doubles as headroom for a possible WAF/JS challenge
 * (e.g. Cloudflare-style interstitial) to finish and set its clearance
 * cookie before the search request fires — domcontentloaded alone doesn't
 * guarantee that's done. Deliberately not `waitUntil: "networkidle"` on the
 * goto instead: sites with any background analytics/beacon traffic can keep
 * the network "busy" indefinitely and that would eat the whole navigation
 * timeout for nothing.
 */
async function dismissPopup(page: Page): Promise<void> {
  await page.waitForTimeout(2500);

  const closeSelectors = [
    'button[aria-label="Kapat" i]',
    'button[aria-label="close" i]',
    '[class*="modal"] [class*="close"]',
    '[class*="popup"] [class*="close"]',
    '[class*="overlay"] [class*="close"]',
  ];

  for (const selector of closeSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0) {
      await locator.click({ timeout: 1000 }).catch(() => {});
      return;
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
}

// --- product detail (variant) hydration --------------------------------------

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

const PAYLOAD_PREVIEW_LENGTH = 500;

/**
 * The search endpoint's exact response shape wasn't captured in the source
 * notes (only the request format, reverse-engineered from search_elasticsearch.js).
 * We try several common shapes an Elasticsearch-backed search endpoint might
 * return. If none of them fit, we don't silently report "0 results" — that
 * would be indistinguishable from a genuine empty search and hide a real
 * parsing gap. Instead we throw with a slice of the actual payload, which
 * surfaces directly in the UI (SourceResult.error) so the real shape can be
 * read off the screen and used to fix findCandidateArrays/normalizeShopierItem
 * below, without needing server logs.
 */
function parseShopierSearchPayload(text: string): RawShopierItem[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(`Arama cevabı JSON olarak ayrıştırılamadı — ham gövde: ${text.slice(0, PAYLOAD_PREVIEW_LENGTH)}`);
  }

  const candidates = findCandidateArrays(data);

  for (const arr of candidates) {
    const items = arr.map(normalizeShopierItem).filter((x): x is RawShopierItem => x !== null);
    if (items.length > 0) return items;
  }

  // All candidate arrays we found were empty -> genuinely no results for this query.
  if (candidates.length > 0 && candidates.every((arr) => arr.length === 0)) {
    return [];
  }

  // Either no recognizable array field at all, or one had entries but none of
  // them normalized (a field-name mismatch in normalizeShopierItem) — surface
  // the real shape instead of quietly returning an empty result set.
  const preview = JSON.stringify(data).slice(0, PAYLOAD_PREVIEW_LENGTH);
  throw new HttpError(`Arama cevabı tanınmayan bir şekilde geldi, ürün çıkarılamadı. Ham cevap: ${preview}`);
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
