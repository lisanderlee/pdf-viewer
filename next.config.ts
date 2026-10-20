import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/index": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/upload": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
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
