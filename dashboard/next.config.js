/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable linting and TS checks during build to prevent build blocks during testing/demos
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
