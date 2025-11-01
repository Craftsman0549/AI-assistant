/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  assetPrefix: process.env.BASE_PATH || '',
  basePath: process.env.BASE_PATH || '',
  trailingSlash: true,
  publicRuntimeConfig: {
    root: process.env.BASE_PATH || '',
  },
  optimizeFonts: false,
  // Cloudflare Pages のビルドで ESLint エラー（prettier 含む）を原因に失敗しないようにする
  // 本番ビルドを優先し、Lint はCI/ローカルで実行してください
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
