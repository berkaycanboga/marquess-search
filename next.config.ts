import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's output file tracing (used to build the Vercel serverless function
  // bundle) misses files that playwright-core/@sparticuz/chromium load via
  // dynamic/internal paths rather than static imports — notably
  // playwright-core/browsers.json, which crashed the Shopier headless-browser
  // fallback in production with "Cannot find module .../browsers.json" even
  // though the package itself was present. Force-include what's needed.
  // patchright-core (playwright-core's anti-detection fork, see lib/browser.ts)
  // ships the same browsers.json and needs the same treatment. Same problem,
  // different cause, for data/shopier-products.json: lib/shopierCache.ts reads
  // it via a runtime-built fs path (not a static import), which file tracing
  // can't see either — without this it's missing from the deployed function
  // and every request falls through to "no cache" instead of using the synced
  // data (see scripts/sync-shopier.mjs).
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/playwright-core/**",
      "node_modules/patchright-core/**",
      "node_modules/@sparticuz/chromium/**",
      "data/shopier-products.json",
    ],
  },
  // playwright-core is on Next's built-in auto-external list (native `require`,
  // never bundled) but patchright-core isn't — without this, Turbopack tries to
  // statically bundle it and fails on an optional `chromium-bidi` require it
  // pulls in for a BiDi automation path we don't use (classic CDP only).
  serverExternalPackages: ["patchright-core"],
};

export default nextConfig;
