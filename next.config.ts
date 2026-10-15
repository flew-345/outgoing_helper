import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  output: process.env.TRANSIT_STATIC_EXPORT === "1" ? "export" : undefined,
  // Server-only routes are omitted from the portable static preview package.
  pageExtensions:
    process.env.TRANSIT_STATIC_EXPORT === "1"
      ? ["ts", "tsx", "js", "jsx"]
      : ["live.ts", "ts", "tsx", "js", "jsx"],
  env: {
    NEXT_PUBLIC_TRANSIT_STATIC_EXPORT:
      process.env.TRANSIT_STATIC_EXPORT === "1" ? "1" : "0",
  },
};

export default config;
