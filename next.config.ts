import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  output: process.env.TRANSIT_STATIC_EXPORT === "1" ? "export" : undefined,
};

export default config;
