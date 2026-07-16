export type SourceId = "esans" | "felicita" | "shopier";

export type Unit = "gr" | "kg" | "ml";

export interface ProductVariant {
  /** Human label as shown by the source, e.g. "100 gr" or "50 ml" */
  label: string;
  amount: number;
  unit: Unit;
  quality?: string;
  price: number;
  currency: "TRY";
  /** Only comparable across variants that share the same unit family (gr/kg vs ml). */
  pricePerGram: number | null;
  pricePerMl: number | null;
  inStock?: boolean;
  sku?: string;
}

export interface ProductResult {
  id: string;
  source: SourceId;
  name: string;
  url: string;
  imageUrl?: string;
  variants: ProductVariant[];
}

export interface SourceResult {
  source: SourceId;
  label: string;
  ok: boolean;
  error?: string;
  /** true when the source returned partial data (e.g. list succeeded but per-variant detail fetch failed) */
  degraded?: boolean;
  products: ProductResult[];
  tookMs: number;
  /** ISO timestamp of the underlying data snapshot, when results came from a
   * synced cache rather than a live request (currently Shopier only — see
   * lib/shopierCache.ts / scripts/sync-shopier.mjs). */
  cachedAt?: string;
}

export interface CompareResponse {
  query: string;
  fetchedAt: string;
  sources: SourceResult[];
}

export const SOURCE_LABELS: Record<SourceId, string> = {
  esans: "esans.com.tr",
  felicita: "Felicita Fragrances",
  shopier: "John Lucas (Shopier)",
};
