import type { NextConfig } from 'next';



const nextConfig: NextConfig = {
  serverExternalPackages: ['sql.js'],
  output: 'standalone',
  trailingSlash: true,
  distDir: '.next',
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'picsum.photos', port: '', pathname: '/**' },
    ],
  },
  compress: true,
};

export default nextConfig;
