/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone: a self-contained server bundle (node_modules
  // pruned to only what's traced as required) that the multi-stage Dockerfile
  // copies into the runner stage instead of shipping the full node_modules tree.
  output: 'standalone',
};
export default nextConfig;
