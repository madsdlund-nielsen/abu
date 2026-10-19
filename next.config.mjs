/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bcryptjs"],
  // Filer går aldrig gennem server actions: optagelser uploades direkte til lageret / som stream (H-5) og rådgiverfotos via
  // PUT /api/avatar/<id> (D-2). Server actions får kun formulardata, så loftet (der læses før auth) holdes på 1 MB.
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
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
