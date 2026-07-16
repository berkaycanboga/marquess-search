import type { CheerioAPI } from "cheerio";
import { parseTurkishPrice, parseAmountUnit, pricePerGram, pricePerMl } from "./format";
import type { ProductVariant, Unit } from "./types";

export const QUALITY_PATTERN = /\b(TOP|DELUX|DEL[ÜU]KS|EG[- ]?EKONOM[İI]K|EKONOM[İI]K)\b/i;
export const PRICE_PATTERN = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(TL|₺)/i;

export function buildVariant(label: string, amount: number, unit: Unit, price: number, quality?: string): ProductVariant {
  return {
    label: label.trim(),
    amount,
    unit,
    quality,
    price,
    currency: "TRY",
    pricePerGram: pricePerGram(price, amount, unit),
    pricePerMl: pricePerMl(price, amount, unit),
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

/** Elements carrying data-price/data-fiyat plus a gram/ml label in a sibling attribute. */
export function variantsFromDataAttributes($: CheerioAPI): ProductVariant[] | null {
  const candidates = $("[data-price], [data-fiyat]");
  if (candidates.length === 0) return null;

  const variants: ProductVariant[] = [];
  candidates.each((_, el) => {
    const $el = $(el);
    const priceRaw = $el.attr("data-price") || $el.attr("data-fiyat") || $el.text();
    const price = parseTurkishPrice(String(priceRaw));
    if (price == null) return;

    const labelRaw =
      $el.attr("data-gram") ||
      $el.attr("data-weight") ||
      $el.attr("data-ml") ||
      $el.attr("data-variant") ||
      $el.attr("data-option") ||
      $el.attr("title") ||
      $el.text();
    const amountUnit = parseAmountUnit(String(labelRaw));
    if (!amountUnit) return;

    const quality =
      $el.attr("data-quality") ||
      $el.closest("[data-quality]").attr("data-quality") ||
      extractQuality($el.text()) ||
      extractQuality(String(labelRaw));

    variants.push(
      buildVariant(String(labelRaw).trim() || `${amountUnit.amount} ${amountUnit.unit}`, amountUnit.amount, amountUnit.unit, price, quality),
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
