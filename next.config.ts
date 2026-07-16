import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's output file tracing (used to build the Vercel serverless function
  // bundle) misses files that playwright-core/@sparticuz/chromium load via
  // dynamic/internal paths rather than static imports — notably
  // playwright-core/browsers.json, which crashed the Shopier headless-browser
  // fallback in production with "Cannot find module .../browsers.json" even
  // though the package itself was present. Force-include what's needed.
  outputFileTracingIncludes: {
    "/*": ["node_modules/playwright-core/**", "node_modules/@sparticuz/chromium/**"],
  },
};

export default nextConfig;
