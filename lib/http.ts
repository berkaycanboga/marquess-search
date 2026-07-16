/**
 * Shared HTTP helpers for the source clients. We deliberately avoid a headless
 * browser (see project notes) and instead mimic a real Chrome session closely
 * enough for esans.com.tr and Felicita, which don't need it. Shopier's search
 * endpoint appears to gate on session cookies + Referer/Origin (see shopier.ts).
 */

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_USER_AGENT,
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};

export class HttpError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { ...DEFAULT_HEADERS, ...init.headers },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError(`İstek zaman aşımına uğradı (${timeoutMs}ms): ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads all Set-Cookie values from a fetch Response, across runtimes. */
function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

/** Minimal cookie jar: enough to carry a Shopier session across two requests. */
export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of readSetCookies(response)) {
      const pair = raw.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  get size(): number {
    return this.cookies.size;
  }
}
