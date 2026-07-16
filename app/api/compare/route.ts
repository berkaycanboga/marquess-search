import { NextRequest, NextResponse } from "next/server";
import { searchAllSources } from "@/lib/sources";
import { TtlCache } from "@/lib/cache";
import type { CompareResponse } from "@/lib/types";

// The Shopier client can fall back to a headless-browser launch (see
// lib/browser.ts) when plain HTTP gets blocked — that's slower than a normal
// fetch, so give this route more headroom than the platform default. Vercel
// clamps this to whatever your plan/compute mode actually allows — check
// Settings → Functions if the Shopier fallback keeps timing out; see README.
export const maxDuration = 60;

// Keeps repeat/duplicate searches from re-hitting the source sites — also
// acts as a light shield against the bot-detection concerns in the project
// notes (esans rate limits, Shopier's search endpoint is picky).
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new TtlCache<CompareResponse>(CACHE_TTL_MS);

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ error: "q parametresi gerekli" }, { status: 400 });
  }
  if (query.length > 100) {
    return NextResponse.json({ error: "Arama terimi çok uzun" }, { status: 400 });
  }

  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const sources = await searchAllSources(query);
  const response: CompareResponse = {
    query,
    fetchedAt: new Date().toISOString(),
    sources,
  };
  cache.set(cacheKey, response);

  return NextResponse.json(response);
}
