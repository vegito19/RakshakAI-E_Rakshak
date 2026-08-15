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
    // Localtunnel fixed public URL: https://rakshak-surat-police.loca.lt
    const rawBackendUrl = process.env.NEXT_PUBLIC_API_URL || 'https://rakshak-surat-police.loca.lt';
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
