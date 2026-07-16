import type { Browser, BrowserContextOptions } from "patchright-core";

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Chromium's own flag for the most direct automation tell: with this unset,
// `navigator.webdriver` is true and CDP-based WAFs (Cloudflare included, per
// lib/sources/shopier.ts's notes) can detect it before any page JS even runs.
const STEALTH_LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];

/**
 * Launches a short-lived headless Chromium for sites whose bot protection
 * blocks plain HTTP requests outright — a real browser carries a genuine
 * TLS/JS fingerprint that a bare `fetch()` can't replicate (see
 * lib/sources/shopier.ts, which is the only current caller).
 *
 * Uses `patchright-core` (a drop-in playwright-core fork, pinned to the exact
 * same 1.61.1 protocol version) instead of plain `playwright-core`: vanilla
 * Playwright/Puppeteer leak automation through the CDP protocol itself (a
 * `Runtime.Enable` timing signature), which is a far more fundamental and
 * commonly-checked WAF signal than any JS-property override below can hide.
 * Note per its own docs: patchright's "fully undetected" configuration wants
 * a headed real Chrome with a persistent profile — neither of which a
 * serverless function can do. This still closes the CDP-level leak, which is
 * a real improvement, but isn't guaranteed to be enough on its own.
 *
 * On Vercel/Lambda, uses @sparticuz/chromium's serverless-sized build. Locally
 * it expects a Chromium installed via Playwright's own CLI:
 *   npx playwright install chromium
 *
 * Both `patchright-core` and `@sparticuz/chromium` are imported dynamically,
 * *inside* this function rather than at module scope: this is the only piece
 * of the app that touches a headless browser, and it's a "best effort, may
 * not be available" fallback by design. A packaging/runtime issue with either
 * package (e.g. a serverless environment where the Chromium binary can't be
 * found) must only fail this one function — not throw at module-evaluation
 * time and take down every route that imports lib/sources/shopier.ts, which
 * is what a top-level `import ... from "patchright-core"` would risk.
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
  const { chromium: playwrightChromium } = await import("patchright-core");

  if (!IS_SERVERLESS) {
    const browser = await playwrightChromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    return { browser, cleanup: () => browser.close() };
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  const browser = await playwrightChromium.launch({
    args: [...chromium.args, ...STEALTH_LAUNCH_ARGS],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  return { browser, cleanup: () => browser.close() };
}

/**
 * Beyond the launch flag, headless Chromium still differs from a real,
 * human-driven Chrome in ways WAFs commonly probe from page JS: empty
 * `navigator.plugins`, a `permissions.query("notifications")` mismatch, no
 * `window.chrome` object, and a software-rendered WebGL vendor string. These
 * are the standard, widely-documented evasions (the same ones
 * puppeteer-extra-plugin-stealth ships); patched here as a page-context init
 * script rather than pulling in a whole stealth-plugin dependency for a
 * handful of property overrides. No guarantee against a WAF that scores on
 * network-level signals (e.g. the hosting provider's IP reputation) rather
 * than browser fingerprint — see lib/sources/shopier.ts's notes.
 */
export async function newStealthContext(browser: Browser, options?: BrowserContextOptions) {
  const context = await browser.newContext(options);
  await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
  return context;
}

const STEALTH_INIT_SCRIPT = `
(() => {
  Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });

  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }

  const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (parameters) =>
    parameters && parameters.name === "notifications"
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);

  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "languages", { get: () => ["tr-TR", "tr", "en-US", "en"] });

  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (parameter) {
    if (parameter === 37445) return "Intel Inc.";
    if (parameter === 37446) return "Intel Iris OpenGL Engine";
    return getParameter.call(this, parameter);
  };
})();
`;
