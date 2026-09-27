import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsers that rely on Node APIs / optional native deps stay out of the bundle.
  serverExternalPackages: ["unpdf", "mammoth", "linkedom", "docx"],
};

export default nextConfig;
