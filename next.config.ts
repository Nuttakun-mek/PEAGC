import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // The per-event share image reads the Sarabun fonts and the crest from disk at request time;
  // make sure Vercel bundles them with that function.
  outputFileTracingIncludes: {
    "/events/**": ["./src/app/fonts/Sarabun-Regular.ttf", "./src/app/fonts/Sarabun-SemiBold.ttf", "./public/brand/peagc-crest-256.png"],
  },
  experimental: {
    serverActions: {
      // Default is 1 MB, which rejects most phone photos. Payment slips allow 8 MB and
      // scorecard photos 10 MB; leave headroom for multipart overhead.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
