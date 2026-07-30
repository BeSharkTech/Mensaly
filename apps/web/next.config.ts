import type { NextConfig } from "next";

const apiOrigin = process.env.MENSALY_API_URL ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"],
  env: {
    NEXT_PUBLIC_MENSALY_API_URL: apiOrigin,
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
