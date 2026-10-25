/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export (apps/web/out) for Cloudflare Pages; NEXT_PUBLIC_API_URL is inlined at build time.
  output: "export",
};

export default nextConfig;
