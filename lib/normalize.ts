import type { ProductVariant, SourceId, SourceResult } from "./types";

export interface FlatVariant extends ProductVariant {
  source: SourceId;
  sourceLabel: string;
  productId: string;
  productName: string;
  productUrl: string;
}

export function flattenVariants(sources: SourceResult[]): FlatVariant[] {
  const out: FlatVariant[] = [];
  for (const source of sources) {
    for (const product of source.products) {
      for (const variant of product.variants) {
        out.push({
          ...variant,
          source: source.source,
          sourceLabel: source.label,
          productId: product.id,
          productName: product.name,
          productUrl: product.url,
        });
      }
    }
  }
  return out;
}

/** Gram/kg-normalized variants (raw esans), cheapest ₺/gram first. */
export function gramComparableVariants(flat: FlatVariant[]): FlatVariant[] {
  return flat.filter((v) => v.pricePerGram != null).sort((a, b) => a.pricePerGram! - b.pricePerGram!);
}

/** ml-normalized variants (finished perfume), cheapest ₺/ml first. */
export function mlComparableVariants(flat: FlatVariant[]): FlatVariant[] {
  return flat.filter((v) => v.pricePerMl != null).sort((a, b) => a.pricePerMl! - b.pricePerMl!);
}

export type UnitLabel = "gr" | "ml";

export function unitPriceOf(variant: FlatVariant, unit: UnitLabel): number | null {
  return unit === "gr" ? variant.pricePerGram : variant.pricePerMl;
}

export interface ProductGroup {
  productId: string;
  productName: string;
  productUrl: string;
  sourceLabel: string;
  /** All of this product's comparable variants, cheapest-for-`unit` first. */
  variants: FlatVariant[];
}

/**
 * Collapses one row per variant into one row per product, so a product with
 * 8 gram/quality combinations (e.g. Felicita's Top/Exclusive × 25/50/100/250gr)
 * shows as a single row with a picker instead of 8 near-duplicate rows.
 * Groups are ordered by each product's own cheapest variant for `unit`.
 */
export function groupByProduct(variants: FlatVariant[], unit: UnitLabel): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const v of variants) {
    let group = map.get(v.productId);
    if (!group) {
      group = {
        productId: v.productId,
        productName: v.productName,
        productUrl: v.productUrl,
        sourceLabel: v.sourceLabel,
        variants: [],
      };
      map.set(v.productId, group);
    }
    group.variants.push(v);
  }

  const groups = Array.from(map.values());
  for (const group of groups) {
    group.variants.sort((a, b) => unitPriceOf(a, unit)! - unitPriceOf(b, unit)!);
  }
  groups.sort((a, b) => unitPriceOf(a.variants[0], unit)! - unitPriceOf(b.variants[0], unit)!);
  return groups;
}
