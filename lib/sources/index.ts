import { searchEsans } from "./esans";
import { searchFelicita } from "./felicita";
import { searchShopier } from "./shopier";
import { SOURCE_LABELS, type SourceId, type SourceResult } from "../types";

const SOURCES: Record<SourceId, (query: string) => Promise<SourceResult>> = {
  esans: searchEsans,
  felicita: searchFelicita,
  shopier: searchShopier,
};

/** Fans out to all three sources in parallel; each client already catches its
 * own errors into an `ok:false` SourceResult, allSettled here is just a safety
 * net against an unexpected throw slipping through. */
export async function searchAllSources(query: string): Promise<SourceResult[]> {
  const entries = Object.entries(SOURCES) as [SourceId, (q: string) => Promise<SourceResult>][];
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn(query)));

  return settled.map((result, i) => {
    const [source] = entries[i];
    if (result.status === "fulfilled") return result.value;
    return {
      source,
      label: SOURCE_LABELS[source],
      ok: false,
      error: result.reason instanceof Error ? result.reason.message : "Beklenmeyen hata",
      products: [],
      tookMs: 0,
    };
  });
}
