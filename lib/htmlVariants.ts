import type { CheerioAPI } from "cheerio";
import { parseTurkishPrice, parseRawNumber, parseAmountUnit, pricePerGram, pricePerMl } from "./format";
import type { ProductVariant, Unit } from "./types";

export const QUALITY_PATTERN = /\b(TOP|DELUX|DEL[ÜU]KS|EG[- ]?EKONOM[İI]K|EKONOM[İI]K)\b/i;
export const PRICE_PATTERN = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(TL|₺)/i;

export function buildVariant(
  label: string,
  amount: number,
  unit: Unit,
  price: number,
  quality?: string,
  inStock?: boolean,
): ProductVariant {
  return {
    label: label.trim(),
    amount,
    unit,
    quality,
    price,
    currency: "TRY",
    pricePerGram: pricePerGram(price, amount, unit),
    pricePerMl: pricePerMl(price, amount, unit),
    inStock,
  };
}

export function extractQuality(text: string): string | undefined {
  const match = text.match(QUALITY_PATTERN);
  return match ? match[1].toUpperCase() : undefined;
}

export function dedupeVariants(variants: ProductVariant[]): ProductVariant[] {
  const seen = new Set<string>();
  const out: ProductVariant[] = [];
  for (const v of variants) {
    const key = `${v.amount}-${v.unit}-${v.quality ?? ""}-${v.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Elements carrying data-price/data-fiyat plus a gram/ml label in a sibling
 * attribute. `data-type` (confirmed against esans.com.tr's real markup —
 * their gram/quantity picker is `<a data-price="543.79" data-type="15 GRAM"
 * data-instock="1" ...>`) is checked first; the rest are generic guesses for
 * other sites. Deliberately does NOT fall back to `data-weight`: on
 * esans.com.tr that attribute holds a plain kg decimal ("0.05") with no unit
 * word, which used to be picked up ahead of the real label and silently fail
 * to parse, making every variant fall through to the single-price fallback.
 */
export function variantsFromDataAttributes($: CheerioAPI): ProductVariant[] | null {
  const candidates = $("[data-price], [data-fiyat]");
  if (candidates.length === 0) return null;

  const variants: ProductVariant[] = [];
  candidates.each((_, el) => {
    const $el = $(el);
    // data-price/data-fiyat are machine-written floats (parseRawNumber); the
    // .text() fallback is genuine human-formatted display text (parseTurkishPrice).
    const priceAttr = $el.attr("data-price") ?? $el.attr("data-fiyat");
    const price = priceAttr != null ? parseRawNumber(priceAttr) : parseTurkishPrice($el.text());
    if (price == null) return;

    const labelRaw =
      $el.attr("data-type") ||
      $el.attr("data-gram") ||
      $el.attr("data-variant") ||
      $el.attr("data-option") ||
      $el.attr("title") ||
      $el.attr("data-ml") ||
      $el.text();
    const amountUnit = parseAmountUnit(String(labelRaw));
    if (!amountUnit) return;

    const quality =
      $el.attr("data-quality") ||
      $el.closest("[data-quality]").attr("data-quality") ||
      extractQuality($el.text()) ||
      extractQuality(String(labelRaw));

    const stockRaw = $el.attr("data-instock");
    const inStock = stockRaw != null ? stockRaw === "1" : undefined;

    variants.push(
      buildVariant(
        String(labelRaw).trim() || `${amountUnit.amount} ${amountUnit.unit}`,
        amountUnit.amount,
        amountUnit.unit,
        price,
        quality,
        inStock,
      ),
    );
  });

  return variants.length > 0 ? dedupeVariants(variants) : null;
}

/**
 * schema.org microdata (`itemtype="...Offer"` with `itemprop="price"`), the
 * HTML-attribute sibling of JSON-LD — common on older e-ticaret platforms
 * (predating/alongside JSON-LD) that plain-object JSON-LD parsing won't see.
 */
export function variantsFromMicrodataOffers($: CheerioAPI): ProductVariant[] | null {
  const offers = $('[itemtype*="Offer" i]');
  if (offers.length === 0) return null;

  const variants: ProductVariant[] = [];
  offers.each((_, el) => {
    const $el = $(el);
    const priceRaw =
      $el.find('[itemprop="price"]').first().attr("content") ??
      $el.find('[itemprop="price"]').first().text() ??
      $el.attr("content");
    const price = priceRaw ? parseTurkishPrice(String(priceRaw)) : null;
    if (price == null) return;

    const labelSource =
      $el.find('[itemprop="name"]').first().text() ||
      $el.find('[itemprop="sku"]').first().text() ||
      $el.text();
    const amountUnit = parseAmountUnit(labelSource);
    if (!amountUnit) return;

    const quality = extractQuality(labelSource);
    variants.push(
      buildVariant(labelSource.trim() || `${amountUnit.amount} ${amountUnit.unit}`, amountUnit.amount, amountUnit.unit, price, quality),
    );
  });

  return variants.length > 0 ? dedupeVariants(variants) : null;
}

/**
 * Last-resort, site-agnostic fallback: scans common option/list containers for
 * elements whose text contains both an amount+unit ("100 GRAM" / "50 ML") and a
 * price ("450,00 TL"). We couldn't verify live markup from this environment
 * (no outbound network access here) — use scripts/inspect.mjs against a real
 * product page to see the actual DOM/scripts and tighten these selectors if a
 * source keeps coming back empty.
 */
export function variantsFromLabeledElements($: CheerioAPI): ProductVariant[] | null {
  const variants: ProductVariant[] = [];

  $("li, option, label, .variant, .secenek, .quantity-option, .urun-secenek").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    const amountUnit = parseAmountUnit(text);
    const priceMatch = text.match(PRICE_PATTERN);
    if (!amountUnit || !priceMatch) return;
    const price = parseTurkishPrice(priceMatch[0]);
    if (price == null) return;

    variants.push(buildVariant(text, amountUnit.amount, amountUnit.unit, price, extractQuality(text)));
  });

  return variants.length > 0 ? dedupeVariants(variants) : null;
}
