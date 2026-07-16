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
