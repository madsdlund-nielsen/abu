/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bcryptjs"],
  // Optagelser uploades direkte til lageret / som stream (H-5); server actions behøver kun små bodies
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        // Basis for alle svar (også API og statiske filer). Sider får desuden CSP, HSTS og en rutespecifik
        // Permissions-Policy fra src/proxy.ts (med nonce pr. request).
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), display-capture=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default nextConfig;
