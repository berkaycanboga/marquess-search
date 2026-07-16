import { fetchWithTimeout, HttpError } from "../http";
import { parseAmountUnit, pricePerGram, pricePerMl } from "../format";
import { SOURCE_LABELS, type ProductResult, type ProductVariant, type SourceResult } from "../types";

const API_BASE = "https://api.felicitafragrances.com/api";
// "Esanslar" category id, confirmed against the site's own `category=` query param (see notes).
const ESANS_CATEGORY_ID = "adc17f7c-68a3-40f6-8a2c-2559a91c6b46";

// How many search hits to fetch full variant tables for. Each one is a
// separate detail request, run in parallel since this API has no observed
// rate limiting (open CORS, no auth).
const MAX_PRODUCTS = 8;

interface FelicitaChildProduct {
  sku: string;
  price: number;
  name?: string;
  variantAttributes?: { Volume?: string; Quality?: string };
  stockQuantity?: number;
}

interface FelicitaProductDetail {
  id: string;
  name?: string;
  nameTr?: string;
  childProducts?: FelicitaChildProduct[];
}

interface FelicitaSearchResponse {
  content?: Array<{ id: string; name?: string }>;
}

export async function searchFelicita(query: string): Promise<SourceResult> {
  const start = Date.now();
  const label = SOURCE_LABELS.felicita;

  try {
    const searchUrl =
      `${API_BASE}/products/category/${ESANS_CATEGORY_ID}` +
      `?page=0&size=20&sort=nameTr,asc&search=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(searchUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new HttpError(`Arama isteği ${res.status} döndü`, res.status);
    }
    const data = (await res.json()) as FelicitaSearchResponse;
    const items = (data.content ?? []).slice(0, MAX_PRODUCTS);

    const settled = await Promise.allSettled(items.map((item) => fetchFelicitaProduct(item.id)));
    const products: ProductResult[] = [];
    let degraded = false;

    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        products.push(result.value);
      } else {
        degraded = true;
      }
    }

    return { source: "felicita", label, ok: true, degraded, products, tookMs: Date.now() - start };
  } catch (err) {
    return {
      source: "felicita",
      label,
      ok: false,
      error: err instanceof Error ? err.message : "Bilinmeyen hata",
      products: [],
      tookMs: Date.now() - start,
    };
  }
}

async function fetchFelicitaProduct(id: string): Promise<ProductResult | null> {
  const res = await fetchWithTimeout(`${API_BASE}/products/${id}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new HttpError(`Ürün isteği ${res.status} döndü`, res.status);
  }
  const data = (await res.json()) as FelicitaProductDetail;
  const children = data.childProducts ?? [];
  if (children.length === 0) return null;

  const variants: ProductVariant[] = children.map((child) => {
    const volumeLabel = child.variantAttributes?.Volume ?? "";
    const amountUnit = parseAmountUnit(volumeLabel) ?? { amount: 0, unit: "gr" as const };
    return {
      label: volumeLabel || child.sku,
      amount: amountUnit.amount,
      unit: amountUnit.unit,
      // Uppercased to match esans.com.tr's quality labels (TOP/DELUX/...) so
      // the UI's quality filter doesn't show "Top" and "TOP" as separate chips.
      quality: child.variantAttributes?.Quality?.toUpperCase(),
      price: child.price,
      currency: "TRY",
      pricePerGram: pricePerGram(child.price, amountUnit.amount, amountUnit.unit),
      pricePerMl: pricePerMl(child.price, amountUnit.amount, amountUnit.unit),
      inStock: typeof child.stockQuantity === "number" ? child.stockQuantity > 0 : undefined,
      sku: child.sku,
    };
  });

  return {
    id,
    source: "felicita",
    name: data.nameTr ?? data.name ?? children[0]?.name ?? "İsimsiz ürün",
    url: `https://www.felicitafragrances.com/products/${id}`,
    variants,
  };
}
