import type { Browser } from "playwright-core";

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Launches a short-lived headless Chromium for sites whose bot protection
 * blocks plain HTTP requests outright — a real browser carries a genuine
 * TLS/JS fingerprint that a bare `fetch()` can't replicate (see
 * lib/sources/shopier.ts, which is the only current caller).
 *
 * On Vercel/Lambda, uses @sparticuz/chromium's serverless-sized build. Locally
 * it expects a Chromium installed via Playwright's own CLI:
 *   npx playwright install chromium
 *
 * Both `playwright-core` and `@sparticuz/chromium` are imported dynamically,
 * *inside* this function rather than at module scope: this is the only piece
 * of the app that touches a headless browser, and it's a "best effort, may
 * not be available" fallback by design. A packaging/runtime issue with either
 * package (e.g. a serverless environment where the Chromium binary can't be
 * found) must only fail this one function — not throw at module-evaluation
 * time and take down every route that imports lib/sources/shopier.ts, which
 * is what a top-level `import ... from "playwright-core"` would risk.
 *
 * We deliberately do NOT pass a custom `--user-data-dir` here: newer
 * playwright-core versions reject it on `launch()` ("Pass userDataDir
 * parameter to browserType.launchPersistentContext(...) instead"), which
 * crashed every invocation in production. That means a long-running warm
 * Lambda/Vercel container could in theory accumulate Playwright's own default
 * temp profile dirs under /tmp over many invocations — acceptable for now
 * (each is small and `browser.close()` normally cleans its own up); revisit
 * with `launchPersistentContext` if that's ever actually observed.
 */
export async function launchBrowser(): Promise<{ browser: Browser; cleanup: () => Promise<void> }> {
  const { chromium: playwrightChromium } = await import("playwright-core");

  if (!IS_SERVERLESS) {
    const browser = await playwrightChromium.launch({ headless: true });
    return { browser, cleanup: () => browser.close() };
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  return { browser, cleanup: () => browser.close() };
}
