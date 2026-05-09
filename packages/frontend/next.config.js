/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Permite hot-reload con volumes mount en Docker
  webpack: (config) => {
    config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
    return config;
  },
};

module.exports = nextConfig;
