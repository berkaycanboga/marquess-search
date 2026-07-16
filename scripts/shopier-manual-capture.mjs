#!/usr/bin/env node
/**
 * Manual, local-only capture tool for shopier.com/jlfragrances.
 *
 * This CANNOT run as part of the deployed app (lib/sources/shopier.ts /
 * /api/compare on Vercel): it opens a real, visible Google Chrome
 * (channel: "chrome", headless: false) and — the first time Cloudflare
 * shows a challenge — waits for a human to solve it by hand in that window.
 * Vercel's serverless functions have no display, no installed Chrome (only
 * the bundled Chromium @sparticuz/chromium ships), and no human present
 * mid-request. Run this on your own machine instead:
 *
 *   node scripts/shopier-manual-capture.mjs
 *
 * First run: a real Chrome window opens against a dedicated, persistent
 * profile (./shopier-browser-profile — gitignored, never your normal Chrome
 * profile). If Cloudflare shows "Just a moment...", solve it by hand in
 * that window; the script polls and waits, it does not time out quickly.
 * Once past it, the real page HTML is saved to shopier-page.html at the
 * repo root — inspect that file for the actual product-card markup, then
 * fill real selectors into extractProducts() below (name/price/link/
 * image/stock). Re-running the script reuses the same profile dir, so a
 * still-valid Cloudflare clearance carries over instead of re-challenging
 * every time.
 *
 * Deliberately does NOT use a spoofed user-agent, a stealth patch, a proxy,
 * or any other bypass trick — just a real, human-driven Chrome session.
 */
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_URL = "https://www.shopier.com/jlfragrances";
const PROFILE_DIR = path.resolve(process.cwd(), "shopier-browser-profile");
const HTML_OUTPUT_PATH = path.resolve(process.cwd(), "shopier-page.html");
const NAVIGATION_TIMEOUT_MS = 30_000;
const CHALLENGE_POLL_INTERVAL_MS = 2000;
const CHALLENGE_WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to solve by hand

async function isOnChallenge(page) {
  const title = await page.title().catch(() => "");
  return title.includes("Just a moment");
}

async function main() {
  console.log(`Kalıcı profil: ${PROFILE_DIR}`);
  console.log("Gerçek Chrome açılıyor (headless: false, channel: chrome)...\n");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    let response;
    try {
      response = await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      console.error(`\nHATA (timeout): Mağaza sayfası ${NAVIGATION_TIMEOUT_MS}ms içinde yüklenemedi.`);
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }

    const cfMitigated = response?.headers()["cf-mitigated"];
    console.log(`cf-mitigated başlığı: ${cfMitigated ?? "(yok)"}`);

    // While on the challenge screen there is nothing real to read yet —
    // don't touch csrf-token/product selectors/store data until it clears.
    let onChallenge = cfMitigated === "challenge" || (await isOnChallenge(page));

    if (onChallenge) {
      console.log("\nCloudflare doğrulaması (\"Just a moment...\") tespit edildi.");
      console.log("Açık Chrome penceresinde doğrulamayı ELLE tamamlayın.");
      console.log(`Bu betik en fazla ${CHALLENGE_WAIT_TIMEOUT_MS / 1000} saniye bekleyecek.\n`);

      const deadline = Date.now() + CHALLENGE_WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await page.waitForTimeout(CHALLENGE_POLL_INTERVAL_MS);
        onChallenge = await isOnChallenge(page);
        if (!onChallenge) break;
      }

      if (onChallenge) {
        console.error("\nHATA (challenge): Zaman aşımına rağmen Cloudflare doğrulaması hâlâ ekranda.");
        console.error("Pencereyi kapatmadım — elle tamamlayıp betiği tekrar çalıştırabilirsiniz.");
        process.exitCode = 1;
        return;
      }

      console.log("Doğrulama tamamlandı, gerçek sayfa okunuyor...\n");
    }

    // Past the challenge (or never saw one) — this is real store HTML now.
    const html = await page.content();
    await writeFile(HTML_OUTPUT_PATH, html, "utf-8");
    console.log(`Gerçek HTML kaydedildi: ${HTML_OUTPUT_PATH} (${html.length} karakter)`);

    const products = await extractProducts(page);
    if (products.length === 0) {
      console.log(
        "\nHATA (selector bulunamadı / boş ürün sonucu): extractProducts() henüz gerçek selectorlarla " +
          "doldurulmadı, bu yüzden 0 ürün döndü. shopier-page.html içindeki gerçek ürün kartı markup'ını " +
          "inceleyip bu fonksiyonu doldurun.",
      );
    } else {
      console.log(`\n${products.length} ürün çıkarıldı:`);
      console.log(JSON.stringify(products, null, 2));
    }
  } finally {
    await context.close();
  }
}

/**
 * Deliberately empty — do not guess Shopier's selectors. Inspect the saved
 * shopier-page.html for the real product-card markup (name, price, product
 * link, image link, stock status), then replace this with real
 * page.$$eval(...)/page.locator(...) calls matching what's actually there.
 */
async function extractProducts() {
  return [];
}

main().catch((err) => {
  console.error("\nHATA (beklenmeyen):", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
