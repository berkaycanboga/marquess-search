import * as cheerio from "cheerio";
import type { Page } from "patchright-core";
import { fetchWithTimeout, sleep, withTimeout, CookieJar, HttpError } from "../http";
import { launchBrowser, newStealthContext } from "../browser";
import { parseTurkishPrice } from "../format";
import { buildVariant, variantsFromDataAttributes, variantsFromLabeledElements } from "../htmlVariants";
import { readShopierCache, isCacheStale, filterCachedProducts } from "../shopierCache";
import { SOURCE_LABELS, type ProductResult, type ProductVariant, type SourceResult } from "../types";

// John Lucas Fragrances' Shopier store slug, from the notes.
const STORE_SLUG = "jlfragrances";
const STORE_URL = `https://www.shopier.com/${STORE_SLUG}`;
const SEARCH_URL = `https://www.shopier.com/s/api/v1/search_product/${STORE_SLUG}`;

const MAX_DETAIL_FETCHES = 5;
const DETAIL_FETCH_DELAY_MS = 700;
const BROWSER_FALLBACK_TIMEOUT_MS = 45_000;

interface RawShopierItem {
  id: string;
  name: string;
  url?: string;
  imageUrl?: string;
  price?: number;
  inStock?: boolean;
}

/**
 * Cache-first: Shopier's Cloudflare Turnstile protection has repeatedly
 * beaten every automated bypass tried here (plain fetch, headless Playwright,
 * JS-property stealth patches, a CDP-leak-patched fork — see lib/browser.ts
 * notes), so live-scraping it on every user search isn't a reliable strategy.
 * `data/shopier-products.json` is synced separately, locally, by a human via
 * `npm run shopier:sync:headed` (see scripts/sync-shopier.mjs) — a real,
 * visible Chrome where you solve the Cloudflare challenge by hand once.
 *
 * A fresh cache is served directly, without attempting a live request at
 * all — the whole point is to stop hitting Shopier's WAF on every search. A
 * missing/stale cache tries a live fetch as a fallback; if that also fails
 * but an old cache still exists, its (stale) results are still served with
 * `degraded: true` rather than showing nothing.
 */
export async function searchShopier(query: string): Promise<SourceResult> {
  const start = Date.now();
  const label = SOURCE_LABELS.shopier;

  const cache = await readShopierCache();
  const cacheIsFresh = cache != null && !isCacheStale(cache.updatedAt);

  if (cache && cacheIsFresh) {
    return {
      source: "shopier",
      label,
      ok: true,
      degraded: false,
      products: filterCachedProducts(cache, query),
      tookMs: Date.now() - start,
      cachedAt: cache.updatedAt,
    };
  }

  try {
    const { products, degraded } = await fetchShopierLive(query);
    return { source: "shopier", label, ok: true, degraded, products, tookMs: Date.now() - start };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Bilinmeyen hata";

    if (cache) {
      // Live fetch failed, but a (stale) synced snapshot still exists —
      // degrade to that instead of showing nothing for this source.
      return {
        source: "shopier",
        label,
        ok: true,
        degraded: true,
        error: `Canlı sorgu başarısız oldu (${errorMsg}); ${cache.updatedAt} tarihli önbellek gösteriliyor.`,
        products: filterCachedProducts(cache, query),
        tookMs: Date.now() - start,
        cachedAt: cache.updatedAt,
      };
    }

    return { source: "shopier", label, ok: false, error: errorMsg, products: [], tookMs: Date.now() - start };
  }
}

async function fetchShopierLive(query: string): Promise<{ products: ProductResult[]; degraded: boolean }> {
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

  return { products, degraded };
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
    // locale/timezoneId matched to the tr-TR Accept-Language DEFAULT_HEADERS
    // already sends — a real Turkish visitor wouldn't have these mismatched,
    // and WAFs do check for that kind of inconsistency. Deliberately no
    // `userAgent` override: forcing a fixed UA string (previously a Chrome
    // 124/Windows string) while the actual binary is @sparticuz/chromium's
    // Chromium 149 is itself a fingerprint mismatch — let the real browser
    // report its own real identity instead.
    const context = await newStealthContext(browser, {
      locale: "tr-TR",
      timezoneId: "Europe/Istanbul",
    });
    const page = await context.newPage();
    await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForRealShopierPage(page);
    await dismissPopup(page);
    return await searchViaDirectFetch(page, query);
  } finally {
    await cleanup();
  }
}

const REAL_PAGE_WAIT_TIMEOUT_MS = 15_000;
const CSRF_META_SELECTOR = 'meta[name="csrf-token"]';

/**
 * Confirmed live (see notes): the store is behind Cloudflare Turnstile, and a
 * plain page.goto can land on its "Just a moment..." interstitial instead of
 * the real page. A page-title check alone is too weak a signal (a redesign
 * could rename/remove that title) — instead wait for the one thing the real
 * page actually needs for search to work at all: the csrf-token meta tag
 * searchViaDirectFetch reads below. If it never appears, surface exactly what
 * we did land on (title/url/body preview) instead of a generic timeout, so
 * the real cause — still-challenged vs. a genuinely changed page — is visible
 * without needing server logs.
 */
async function waitForRealShopierPage(page: Page): Promise<void> {
  try {
    await page.waitForSelector(CSRF_META_SELECTOR, { state: "attached", timeout: REAL_PAGE_WAIT_TIMEOUT_MS });
  } catch {
    const title = await page.title().catch(() => "(alınamadı)");
    const url = page.url();
    const bodyPreview = await page
      .evaluate(() => document.body?.innerText?.slice(0, 300) ?? "")
      .catch(() => "(alınamadı)");
    throw new HttpError(
      `Gerçek Shopier sayfası ${REAL_PAGE_WAIT_TIMEOUT_MS / 1000} saniye içinde yüklenmedi ` +
        `(csrf-token meta etiketi bulunamadı). title="${title}" url="${url}" body-önizleme="${bodyPreview}"`,
    );
  }
}

/**
 * Fires the exact same request the store's own search box does, from within
 * the page's own JS context — confirmed against a real captured request
 * (DevTools Network tab, see notes): POST to SEARCH_URL with an
 * `X-CSRF-Token` header the plain-HTTP path can't produce (it isn't present
 * anywhere in the response/cookies — only readable from the loaded page's
 * `<meta name="csrf-token">` tag, standard for this Laravel-style backend,
 * evidenced by the PHPSESSID cookie on the real request). Running fetch()
 * inside the page also means Cloudflare sees a real browser fingerprint and
 * automatically attaches the session's cf_clearance cookie.
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
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? "";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": csrfToken,
        },
        body: requestBody,
      });
      return { status: res.status, text: await res.text(), hadCsrfToken: csrfToken.length > 0 };
    },
    { url: SEARCH_URL, requestBody },
  );

  if (result.status < 200 || result.status >= 300) {
    // Surface enough to diagnose without needing server logs: whether the
    // csrf-token meta tag we guessed even exists on the real page, plus a
    // preview of the actual rejection body — a Cloudflare challenge page
    // reads very differently from an app-level 403 with a JSON error.
    const bodyPreview = result.text.slice(0, PAYLOAD_PREVIEW_LENGTH);
    throw new HttpError(
      `Arama isteği (headless browser) ${result.status} döndü (csrf-token meta etiketi ${result.hadCsrfToken ? "bulundu" : "bulunamadı"}) — ham gövde: ${bodyPreview}`,
      result.status,
    );
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
          [buildVariant("Liste fiyatı", 0, "ml", item.price, undefined, item.inStock)]
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
 * Confirmed against a real captured response (DevTools Network tab, see
 * notes): `{ status, products: [{ id, name, link, price: { masterpass_amount,
 * price_code_formatted, ... }, primary_image, labels: { out_of_stock: {
 * enabled } } }], image_endpoints: { mid, ... } }`. `primary_image` is a bare
 * filename that must be prefixed with `image_endpoints.mid` (or another size)
 * to form a real URL — it's not a standalone path like the other sources.
 * We don't silently report "0 results" if the shape doesn't match — that
 * would be indistinguishable from a genuine empty search and hide a real
 * parsing gap (the endpoint could change shape again). Instead we throw with
 * a slice of the actual payload, which surfaces directly in the UI
 * (SourceResult.error) so a shape change can be read off the screen.
 */
function parseShopierSearchPayload(text: string): RawShopierItem[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(`Arama cevabı JSON olarak ayrıştırılamadı — ham gövde: ${text.slice(0, PAYLOAD_PREVIEW_LENGTH)}`);
  }

  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!obj || !Array.isArray(obj.products)) {
    const preview = JSON.stringify(data).slice(0, PAYLOAD_PREVIEW_LENGTH);
    throw new HttpError(`Arama cevabı tanınmayan bir şekilde geldi, ürün çıkarılamadı. Ham cevap: ${preview}`);
  }

  const imageEndpoints = obj.image_endpoints as Record<string, unknown> | undefined;
  const imageBase = typeof imageEndpoints?.mid === "string" ? imageEndpoints.mid : undefined;

  return obj.products.map((p) => normalizeShopierItem(p, imageBase)).filter((x): x is RawShopierItem => x !== null);
}

function normalizeShopierItem(raw: unknown, imageBase: string | undefined): RawShopierItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
  if (!name) return null;

  const id = typeof obj.id === "number" || typeof obj.id === "string" ? String(obj.id) : name;
  const link = typeof obj.link === "string" ? obj.link : undefined;

  const priceObj = obj.price as Record<string, unknown> | undefined;
  let price: number | undefined;
  if (typeof priceObj?.masterpass_amount === "number") {
    // Integer kuruş (TRY cents), e.g. 24744 -> 247.44 TL — avoids re-parsing
    // a human-formatted string for the one field that's already a clean number.
    price = priceObj.masterpass_amount / 100;
  } else if (typeof priceObj?.price_code_formatted === "string") {
    price = parseTurkishPrice(priceObj.price_code_formatted) ?? undefined;
  }

  const imageFile = typeof obj.primary_image === "string" ? obj.primary_image : undefined;
  const imageUrl = imageFile && imageBase ? absolutizeShopier(`${imageBase}${imageFile}`) : undefined;

  const labels = obj.labels as Record<string, unknown> | undefined;
  const outOfStock = labels?.out_of_stock as Record<string, unknown> | undefined;
  const inStock = typeof outOfStock?.enabled === "boolean" ? !outOfStock.enabled : undefined;

  return {
    id,
    name,
    url: link ? absolutizeShopier(link) : undefined,
    imageUrl,
    price,
    inStock,
  };
}

function absolutizeShopier(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path.startsWith("/") ? path : `/${STORE_SLUG}/${path}`, "https://www.shopier.com").toString();
}
