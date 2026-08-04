import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: https://*.blob.vercel-storage.com",
  "connect-src 'self' https://blob.vercel-storage.com https://*.blob.vercel-storage.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    typedEnv: true,
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000" },
        { key: "X-DNS-Prefetch-Control", value: "off" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), geolocation=(), microphone=(self)",
        },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    },
  ],
};

export default withWorkflow(nextConfig);
