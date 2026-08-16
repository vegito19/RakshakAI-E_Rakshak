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
    // Live Cloud Render Backend: https://rakshak-backend-fhyt.onrender.com
    const rawBackendUrl = process.env.NEXT_PUBLIC_API_URL || 'https://rakshak-backend-fhyt.onrender.com';
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
