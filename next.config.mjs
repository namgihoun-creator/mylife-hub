/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // JSON backup restore sends the file contents to a Server Action (default limit is 1MB).
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
