import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow importing engine modules from parent directory
  serverExternalPackages: ['better-sqlite3'],
  output: 'standalone',
  // Lock turbopack root to this directory to avoid picking up files from parent dirs
  turbopack: {
    root: __dirname,
  },
  // PWA: enable static file serving from /public
  experimental: {
    // Allow service worker registration
  },
};

export default nextConfig;
