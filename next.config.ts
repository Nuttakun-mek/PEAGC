import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      // Default is 1 MB, which rejects most phone photos. Payment slips allow 8 MB and
      // scorecard photos 10 MB; leave headroom for multipart overhead.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
