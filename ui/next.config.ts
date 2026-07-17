import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Allow importing engine modules from parent directory.
  // turbopack.root must be the factory/ parent so @engine/* imports (via tsconfig paths)
  // resolve to ../engine/*.ts correctly. The tsconfig.json already maps @engine/* → ../engine/*.
  output: "standalone",
  serverExternalPackages: [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
  ],
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
};

export default nextConfig;
