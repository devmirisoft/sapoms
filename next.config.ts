import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: path.resolve(__dirname) },
  // The AWS box runs out of memory type-checking; it builds with SKIP_TYPECHECK=1. Types are still checked everywhere else.
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },
};


export default nextConfig;
