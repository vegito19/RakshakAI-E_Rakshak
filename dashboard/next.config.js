/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    // Cloudflare Quick Tunnel URL: https://reveals-teeth-between-contributing.trycloudflare.com
    const rawBackendUrl = process.env.NEXT_PUBLIC_API_URL || 'https://reveals-teeth-between-contributing.trycloudflare.com';
    const backendUrl = rawBackendUrl.replace(/\/$/, '');

    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/',
        destination: '/index.html',
      },
      {
        source: '/dashboard',
        destination: '/index.html',
      },
    ];
  },
};

module.exports = nextConfig;
