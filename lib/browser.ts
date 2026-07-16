import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
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
 * Caller MUST call the returned `cleanup()` when done (closes the browser and,
 * on serverless, removes its temp profile dir — warm containers reuse /tmp
 * across invocations and Playwright doesn't clean up after itself, see
 * https://github.com/Sparticuz/chromium#playwright-lambda-tmp-fills-up-after-repeated-invocations).
 */
export async function launchBrowser(): Promise<{ browser: Browser; cleanup: () => Promise<void> }> {
  const { chromium: playwrightChromium } = await import("playwright-core");

  if (!IS_SERVERLESS) {
    const browser = await playwrightChromium.launch({ headless: true });
    return { browser, cleanup: () => browser.close() };
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  const userDataDir = `/tmp/pw-${randomUUID()}`;
  const browser = await playwrightChromium.launch({
    args: [...chromium.args, `--user-data-dir=${userDataDir}`],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  return {
    browser,
    cleanup: async () => {
      await browser.close();
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
