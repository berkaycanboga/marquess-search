#!/usr/bin/env node
/**
 * Local-only sync tool for shopier.com/jlfragrances (John Lucas Fragrances).
 *
 * Every automated bypass of Shopier's Cloudflare Turnstile protection tried
 * from the deployed app failed (plain fetch, headless Playwright, JS-property
 * stealth patches, a CDP-leak-patched Playwright fork — see
 * lib/browser.ts / lib/sources/shopier.ts notes). This script takes the one
 * approach that actually works: a real, human-driven Chrome session. It
 * writes its results to data/shopier-products.json, which the deployed app
 * reads as a cache (see lib/shopierCache.ts) instead of live-scraping on
 * every search — see lib/sources/shopier.ts's searchShopier for the
 * cache-first / live-fallback / stale-cache-degrade logic.
 *
 * Usage:
 *   npm run shopier:sync           # headless — only works if a still-valid
 *                                   # Cloudflare clearance already exists in
 *                                   # the persistent profile below.
 *   npm run shopier:sync:headed    # opens a real, visible Chrome window —
 *                                   # use this the first time, or whenever
 *                                   # Cloudflare challenges again. Solve the
 *                                   # challenge by hand in that window; the
 *                                   # script waits for you, it does not time
 *                                   # out quickly.
 *
 * Uses channel: "chrome" (a real, locally-installed Google Chrome — not a
 * bundled/downloaded Chromium) against a dedicated persistent profile at
 * ./.shopier-profile (gitignored, separate from your normal Chrome profile),
 * so a Cloudflare clearance obtained by hand carries over to later runs.
 * Deliberately does NOT use a spoofed user-agent, a stealth patch, a proxy,
 * or a CAPTCHA-solving service — just a real browser and, when needed, you.
 *
 * Product-listing selectors are still unconfirmed (Shopier's search-
 * suggestions API is confirmed and already used by the live path in
 * lib/sources/shopier.ts, but that API takes a search query — it can't
 * enumerate the whole catalog). This script instead reads whatever
 * structured data the real listing page itself provides, in order of
 * decreasing reliability: JSON-LD Product/ItemList data, then schema.org
 * microdata, then a generic heuristic scan (link + nearby price text) as a
 * last resort — the same three-tier strategy lib/sources/esans.ts already
 * uses for the same reason (unconfirmed live markup). If it comes back
 * empty, shopier-sync-debug.html (the real saved page) is there to inspect.
 */
import { chromium } from "playwright-core";
import * as cheerio from "cheerio";
import { writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

const STORE_SLUG = "jlfragrances";
const STORE_URL = `https://www.shopier.com/${STORE_SLUG}`;

const PROFILE_DIR = path.resolve(process.cwd(), ".shopier-profile");
const CACHE_PATH = path.resolve(process.cwd(), "data", "shopier-products.json");
const DEBUG_HTML_PATH = path.resolve(process.cwd(), "shopier-sync-debug.html");

const NAVIGATION_TIMEOUT_MS = 30_000;
const CHALLENGE_POLL_INTERVAL_MS = 2000;
const CHALLENGE_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes to solve by hand
const SCROLL_SETTLE_MS = 1200;
const MAX_SCROLL_ROUNDS = 80;
const MAX_STAGNANT_ROUNDS = 5;

const PRICE_PATTERN = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(TL|₺)/i;

class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

async function main() {
  const headed = process.argv.includes("--headed");

  console.log(`Kalıcı profil: ${PROFILE_DIR}`);
  console.log(`Gerçek Chrome açılıyor (channel: chrome, headless: ${!headed})...\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: !headed,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    let response;
    try {
      response = await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      throw new SyncError("timeout", `Mağaza sayfası ${NAVIGATION_TIMEOUT_MS}ms içinde yüklenemedi: ${err.message}`);
    }

    const cfMitigated = response?.headers()["cf-mitigated"];
    console.log(`cf-mitigated başlığı: ${cfMitigated ?? "(yok)"}`);

    let onChallenge = cfMitigated === "challenge" || (await isOnChallengeScreen(page));

    if (onChallenge) {
      if (!headed) {
        throw new SyncError(
          "challenge",
          "Cloudflare doğrulaması gerekiyor ama headless modda çalışıyorsunuz. " +
            "`npm run shopier:sync:headed` ile tekrar deneyin ve açılan pencerede doğrulamayı elle tamamlayın.",
        );
      }

      console.log('\nCloudflare doğrulaması ("Just a moment...") tespit edildi.');
      console.log("Açık Chrome penceresinde doğrulamayı ELLE tamamlayın.");
      console.log(`Bu betik en fazla ${CHALLENGE_WAIT_TIMEOUT_MS / 60_000} dakika bekleyecek.\n`);

      const deadline = Date.now() + CHALLENGE_WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await page.waitForTimeout(CHALLENGE_POLL_INTERVAL_MS);
        onChallenge = await isOnChallengeScreen(page);
        if (!onChallenge) break;
      }

      if (onChallenge) {
        throw new SyncError(
          "challenge",
          "Zaman aşımına rağmen Cloudflare doğrulaması hâlâ ekranda. Pencereyi kapatmadım — " +
            "elle tamamlayıp betiği tekrar çalıştırabilirsiniz.",
        );
      }

      console.log("Doğrulama tamamlandı, ürünler toplanıyor...\n");
    }

    // Past the challenge (or never saw one) — save real HTML for inspection
    // regardless of what extraction below finds.
    const html = await page.content();
    await writeFile(DEBUG_HTML_PATH, html, "utf-8");
    console.log(`Gerçek HTML kaydedildi (inceleme için): ${DEBUG_HTML_PATH}`);

    console.log("\nÜrünler taranıyor (kaydırarak)...");
    const cards = await collectAllProducts(page);

    if (cards.length === 0) {
      throw new SyncError(
        "empty",
        `Hiç ürün bulunamadı — JSON-LD/microdata/heuristic taramalarının hiçbiri eşleşmedi (selector bulunamadı) ` +
          `ya da mağaza gerçekten boş döndü. ${DEBUG_HTML_PATH} incelenebilir.`,
      );
    }

    const products = cards.map(cardToProduct);
    const payload = { updatedAt: new Date().toISOString(), products };

    await mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const tmpPath = `${CACHE_PATH}.tmp`;
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmpPath, CACHE_PATH); // atomic on the same filesystem

    console.log(`\n${products.length} ürün kaydedildi: ${CACHE_PATH}`);
    console.log(`updatedAt: ${payload.updatedAt}`);
  } finally {
    await context.close();
  }
}

async function isOnChallengeScreen(page) {
  const title = await page.title().catch(() => "");
  return title.includes("Just a moment");
}

/**
 * Scrolls to the bottom repeatedly, re-extracting product cards after each
 * scroll and deduping by URL, until neither new cards nor page-height growth
 * appear for MAX_STAGNANT_ROUNDS rounds in a row (or MAX_SCROLL_ROUNDS is
 * hit). This assumes an infinite-scroll listing, which is a guess — Shopier's
 * real pagination mechanism (infinite scroll vs. numbered pages vs. a "load
 * more" button) is unconfirmed. If this undercounts against the real total
 * shown on the page, that's the first thing to fix here.
 */
async function collectAllProducts(page) {
  const seen = new Map();
  let stagnantRounds = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    const html = await page.content();
    const $ = cheerio.load(html);
    const cards = extractCards($);

    let newCount = 0;
    for (const card of cards) {
      if (!card.url || !card.name) continue;
      if (!seen.has(card.url)) {
        seen.set(card.url, card);
        newCount++;
      }
    }

    console.log(`  tur ${round + 1}: ${cards.length} kart görüldü, ${newCount} yeni, toplam ${seen.size}`);

    const beforeHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(SCROLL_SETTLE_MS);
    const afterHeight = await page.evaluate(() => document.body.scrollHeight);

    if (newCount === 0 && afterHeight === beforeHeight) {
      stagnantRounds++;
      if (stagnantRounds >= MAX_STAGNANT_ROUNDS) break;
    } else {
      stagnantRounds = 0;
    }
  }

  return Array.from(seen.values());
}

function cardToProduct(card) {
  // Shopier lists each size/quality as its own separate product page rather
  // than a variant picker (matching the live path's convention in
  // lib/sources/shopier.ts) — amount=0/ml marks it as not ₺/ml-normalized,
  // same reasoning as there.
  const variants =
    card.price != null
      ? [
          {
            label: "Liste fiyatı",
            amount: 0,
            unit: "ml",
            price: card.price,
            currency: "TRY",
            pricePerGram: null,
            pricePerMl: null,
            inStock: card.inStock,
          },
        ]
      : [];

  return {
    id: card.url,
    source: "shopier",
    name: card.name,
    url: card.url,
    imageUrl: card.imageUrl,
    variants,
  };
}

// --- card extraction (JSON-LD -> microdata -> heuristic) --------------------

function extractCards($) {
  return extractCardsFromJsonLd($) ?? extractCardsFromMicrodata($) ?? extractCardsHeuristically($);
}

function extractCardsFromJsonLd($) {
  const cards = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    collectProductNodes(parsed, cards);
  });
  return cards.length > 0 ? dedupeByUrl(cards) : null;
}

function collectProductNodes(node, out, inheritedUrl) {
  if (Array.isArray(node)) {
    for (const item of node) collectProductNodes(item, out, inheritedUrl);
    return;
  }
  if (!node || typeof node !== "object") return;

  const type = node["@type"];
  const typeStr = Array.isArray(type) ? type.join(",") : String(type ?? "");
  if (typeStr.includes("Product")) {
    const card = productNodeToCard(node, inheritedUrl);
    if (card) out.push(card);
  }

  const ownUrl = typeof node.url === "string" ? node.url : inheritedUrl;
  if (Array.isArray(node.itemListElement)) {
    for (const el of node.itemListElement) collectProductNodes(el, out, ownUrl);
  }
  if (node.item) collectProductNodes(node.item, out, ownUrl);
  if (Array.isArray(node["@graph"])) {
    for (const el of node["@graph"]) collectProductNodes(el, out, ownUrl);
  }
}

function productNodeToCard(obj, inheritedUrl) {
  const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
  const rawUrl = typeof obj.url === "string" ? obj.url : inheritedUrl;
  if (!name || !rawUrl) return null;
  const url = absolutize(rawUrl);

  const image = typeof obj.image === "string" ? obj.image : Array.isArray(obj.image) ? String(obj.image[0]) : undefined;

  let price;
  let inStock;
  const offersRaw = obj.offers;
  const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
  if (offer && typeof offer === "object") {
    const p = offer.price;
    if (typeof p === "number") price = p;
    else if (typeof p === "string") price = parseTurkishPrice(p) ?? undefined;
    const avail = offer.availability;
    if (typeof avail === "string") inStock = /instock/i.test(avail);
  }

  return { url, name, imageUrl: image ? absolutize(image) : undefined, price, inStock };
}

function extractCardsFromMicrodata($) {
  const nodes = $('[itemtype*="Product" i]');
  if (nodes.length === 0) return null;

  const cards = [];
  nodes.each((_, el) => {
    const $el = $(el);
    const name = $el.find('[itemprop="name"]').first().text().trim();
    if (!name) return;

    let href = $el.find('[itemprop="url"]').first().attr("href");
    if (!href && $el.is("a[href]")) href = $el.attr("href");
    if (!href) href = $el.find("a[href]").first().attr("href");
    if (!href) return;

    const priceEl = $el.find('[itemprop="price"]').first();
    const priceRaw = priceEl.attr("content") ?? priceEl.text();
    const price = priceRaw ? (parseTurkishPrice(priceRaw) ?? undefined) : undefined;

    const availRaw = $el.find('[itemprop="availability"]').first().attr("href") ?? "";
    const inStock = availRaw ? /instock/i.test(availRaw) : undefined;

    const imgSrc = $el.find("img").first().attr("src");

    cards.push({
      url: absolutize(href),
      name,
      imageUrl: imgSrc ? absolutize(imgSrc) : undefined,
      price,
      inStock,
    });
  });

  return cards.length > 0 ? dedupeByUrl(cards) : null;
}

function extractCardsHeuristically($) {
  const cards = new Map();

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
    const outOfStock = /stokta\s*yok|t[üu]kendi/i.test(containerText);

    cards.set(url, {
      url,
      name,
      imageUrl: imgSrc ? absolutize(imgSrc) : undefined,
      price,
      inStock: outOfStock ? false : undefined,
    });
  });

  return Array.from(cards.values());
}

function dedupeByUrl(cards) {
  const seen = new Set();
  const out = [];
  for (const card of cards) {
    if (!card.url || seen.has(card.url)) continue;
    seen.add(card.url);
    out.push(card);
  }
  return out;
}

function absolutize(url) {
  try {
    return new URL(url, STORE_URL).toString();
  } catch {
    return url;
  }
}

/** Same "1.004,64 TL"-style Turkish number parsing as lib/format.ts —
 * duplicated rather than imported since this is a standalone .mjs script
 * that can't import the app's .ts modules without a build step. */
function parseTurkishPrice(raw) {
  if (!raw) return null;
  let cleaned = raw
    .replace(/KDV[^0-9]*(DAHIL|HARIC|DAHİL|HARİÇ)?/gi, "")
    .replace(/TL|TRY|₺/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    cleaned = cleaned.replace(",", ".");
  } else if (hasDot) {
    const parts = cleaned.split(".");
    const looksLikeThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    if (looksLikeThousands) cleaned = cleaned.replace(/\./g, "");
  }

  cleaned = cleaned.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

main().catch((err) => {
  const labels = {
    challenge: "HATA (Cloudflare challenge)",
    timeout: "HATA (timeout)",
    selector: "HATA (selector bulunamadı)",
    empty: "HATA (selector bulunamadı / boş ürün sonucu)",
  };
  if (err instanceof SyncError) {
    console.error(`\n${labels[err.kind] ?? "HATA"}: ${err.message}`);
  } else {
    console.error("\nHATA (beklenmeyen):", err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
