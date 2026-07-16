#!/usr/bin/env node
/**
 * Diagnostic helper — NOT part of the app itself.
 *
 * The parsers in lib/sources/*.ts were written from a written spec (see the
 * project notes) without live network access to verify actual HTML/JSON
 * shapes. Run this against a real URL (from a machine with normal internet
 * access) to see what a source actually returns, then adjust the selectors
 * in lib/htmlVariants.ts / lib/sources/*.ts to match.
 *
 * Usage:
 *   node scripts/inspect.mjs <url>
 *   node scripts/inspect.mjs <url> --post "search_query=imagination&username=jlfragrances&search_as_you_type=true&highlight=" --referer "https://www.shopier.com/jlfragrances"
 */
import * as cheerio from "cheerio";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const [, , url, ...rest] = process.argv;

if (!url) {
  console.error('Kullanım: node scripts/inspect.mjs <url> [--post "body"] [--referer <url>]');
  process.exit(1);
}

let postBody;
let referer;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--post") postBody = rest[++i];
  if (rest[i] === "--referer") referer = rest[++i];
}

const headers = {
  "User-Agent": BROWSER_UA,
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};
if (referer) {
  headers.Referer = referer;
  headers.Origin = new URL(referer).origin;
}
if (postBody) headers["Content-Type"] = "application/x-www-form-urlencoded";

const res = await fetch(url, { method: postBody ? "POST" : "GET", headers, body: postBody });

console.log(`HTTP ${res.status} ${res.statusText}`);
console.log("Content-Type:", res.headers.get("content-type"));
console.log("Set-Cookie:", res.headers.getSetCookie?.() ?? res.headers.get("set-cookie"));
console.log("---");

const text = await res.text();
const contentType = res.headers.get("content-type") || "";

if (contentType.includes("json")) {
  try {
    const json = JSON.parse(text);
    console.log("JSON üst-seviye anahtarlar:", Object.keys(json));
    console.log(JSON.stringify(json, null, 2).slice(0, 4000));
  } catch {
    console.log("JSON parse edilemedi, ham gövde (ilk 4000 karakter):");
    console.log(text.slice(0, 4000));
  }
  process.exit(0);
}

const $ = cheerio.load(text);

console.log(`\n== JSON-LD blokları (${$('script[type="application/ld+json"]').length}) ==`);
$('script[type="application/ld+json"]').each((i, el) => {
  console.log(`--- blok ${i} ---`);
  console.log($(el).contents().text().slice(0, 1500));
});

const dataPriceEls = $("[data-price], [data-fiyat]");
console.log(`\n== data-price / data-fiyat elemanları (${dataPriceEls.length}) ==`);
dataPriceEls.slice(0, 20).each((i, el) => {
  console.log(i, $(el).prop("tagName"), JSON.stringify($(el).attr()));
});

console.log("\n== 'gram'/'kilo' + 'fiyat'/'price' geçen <script> blokları ==");
$("script:not([src])").each((i, el) => {
  const content = $(el).contents().text();
  if (/gram|kilo/i.test(content) && /fiyat|price/i.test(content)) {
    console.log(`--- script ${i} (${content.length} karakter) ---`);
    console.log(content.slice(0, 1500));
  }
});

console.log("\n== TL/₺ fiyat geçen li/option/label elemanları (ilk 20) ==");
let shown = 0;
$("li, option, label").each((_, el) => {
  if (shown >= 20) return;
  const t = $(el).text().replace(/\s+/g, " ").trim();
  if (/(TL|₺)/i.test(t) && t.length < 200) {
    console.log(`- ${t}`);
    shown++;
  }
});
