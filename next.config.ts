import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's output file tracing (used to build the Vercel serverless function
  // bundle) misses files that playwright-core/@sparticuz/chromium load via
  // dynamic/internal paths rather than static imports — notably
  // playwright-core/browsers.json, which crashed the Shopier headless-browser
  // fallback in production with "Cannot find module .../browsers.json" even
  // though the package itself was present. Force-include what's needed.
  // patchright-core (playwright-core's anti-detection fork, see lib/browser.ts)
  // ships the same browsers.json and needs the same treatment.
  outputFileTracingIncludes: {
    "/*": ["node_modules/playwright-core/**", "node_modules/patchright-core/**", "node_modules/@sparticuz/chromium/**"],
  },
  // playwright-core is on Next's built-in auto-external list (native `require`,
  // never bundled) but patchright-core isn't — without this, Turbopack tries to
  // statically bundle it and fails on an optional `chromium-bidi` require it
  // pulls in for a BiDi automation path we don't use (classic CDP only).
  serverExternalPackages: ["patchright-core"],
};

export default nextConfig;
