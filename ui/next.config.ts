import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Allow importing engine modules from parent directory

  output: 'standalone',
  // Lock turbopack root to the project root to allow picking up engine files from parent dir
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  // PWA: enable static file serving from /public
  experimental: {
    // Allow service worker registration
  },
};

export default nextConfig;

