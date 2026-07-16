import type { Unit } from "./types";

const GRAMS_PER_KG = 1000;

export function toGrams(amount: number, unit: Unit): number | null {
  if (unit === "gr") return amount;
  if (unit === "kg") return amount * GRAMS_PER_KG;
  return null;
}

export function pricePerGram(price: number, amount: number, unit: Unit): number | null {
  const grams = toGrams(amount, unit);
  if (grams === null || grams <= 0) return null;
  return price / grams;
}

export function pricePerMl(price: number, amount: number, unit: Unit): number | null {
  if (unit !== "ml" || amount <= 0) return null;
  return price / amount;
}

export function formatTRY(amount: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(amount: number, maxDigits = 2): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: maxDigits }).format(amount);
}

/**
 * Turkish sites format prices as "1.004,64 TL" (dot = thousands, comma = decimal).
 * Strips currency words/symbols and parses to a JS number. Returns null if unparseable.
 */
export function parseTurkishPrice(raw: string): number | null {
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

/**
 * For prices sourced from machine-written attributes (e.g. `data-price="1413.666"`)
 * rather than human-formatted display text — always a plain JS float string,
 * '.' is always the decimal point, never a thousands separator. Using
 * parseTurkishPrice on these is wrong: e.g. "1413.666" has exactly 3 digits
 * after the dot and gets misread as 1.413.666 by the thousands-grouping
 * heuristic, when it actually means 1413.666.
 */
export function parseRawNumber(raw: string): number | null {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses variant labels like "100 GRAM", "1 KİLO", "50 ML" into amount+unit.
 */
export function parseAmountUnit(raw: string): { amount: number; unit: Unit } | null {
  const text = raw.trim().toUpperCase().replace(",", ".");
  // "KİLO" (Turkish dotted İ, as esans.com.tr writes it) is a different code
  // point from plain ASCII "KILO" — .toUpperCase() does not convert between
  // them, so both must be matched explicitly.
  const match = text.match(/([\d.]+)\s*(GRAM|GR|K[İI]LO|KG|ML|MİLİLİTRE|MILILITRE)/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unitToken = match[2];
  let unit: Unit;
  if (unitToken === "KİLO" || unitToken === "KILO" || unitToken === "KG") unit = "kg";
  else if (unitToken === "ML" || unitToken === "MİLİLİTRE" || unitToken === "MILILITRE") unit = "ml";
  else unit = "gr";
  return { amount, unit };
}
