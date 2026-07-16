import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProductResult } from "./types";

const CACHE_PATH = path.join(process.cwd(), "data", "shopier-products.json");

// How long a synced snapshot is trusted before searchShopier attempts a live
// fetch as a fallback. The only writer of this file is
// scripts/sync-shopier.mjs, a local/manual tool (see lib/sources/shopier.ts
// notes on why Shopier can't be live-scraped from Vercel reliably) — a full
// day is generous headroom for "re-sync whenever you remember to."
export const CACHE_STALE_MS = 24 * 60 * 60 * 1000;

export interface ShopierCache {
  updatedAt: string;
  products: ProductResult[];
}

/** Returns null on anything short of a valid cache — missing file, bad JSON,
 * unexpected shape — so callers can treat all of those as one "no cache yet"
 * case rather than needing to distinguish them. */
export async function readShopierCache(): Promise<ShopierCache | null> {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return isShopierCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isCacheStale(updatedAt: string): boolean {
  const age = Date.now() - Date.parse(updatedAt);
  return !Number.isFinite(age) || age > CACHE_STALE_MS;
}

export function filterCachedProducts(cache: ShopierCache, query: string): ProductResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return cache.products;
  return cache.products.filter((p) => p.name.toLowerCase().includes(needle));
}

function isShopierCache(value: unknown): value is ShopierCache {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.updatedAt === "string" && Array.isArray(obj.products);
}
