import productImageHosts from "./lib/product-image-hosts.json" with { type: "json" };

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  images: {
    minimumCacheTTL: 86_400,
    remotePatterns: productImageHosts.map((hostname) => ({
      protocol: "https",
      hostname,
      port: "",
      pathname: "/**"
    }))
  }
};

export default nextConfig;
