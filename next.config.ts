import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/pdf.worker.min.mjs",
        headers: [{ key: "Content-Type", value: "text/javascript" }],
      },
    ];
  },
};

export default nextConfig;
