/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // JSON backup restore sends the file contents to a Server Action (default limit is 1MB).
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      {
        // The service worker script must never be served from a stale HTTP cache, or updates would not roll out.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
