/** @type {import('next').NextConfig} */
module.exports = {
  // Build/dist dir — env-overridable so the build/dev smoke tests can run in an ISOLATED dir
  // (e.g. `.next-smoke`) and never collide with a running dev server's `.next/dev/lock`. Lets the
  // test suite run green in parallel with `bun web`, no process-killing needed (orphan-prevention).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    '@perduraflow/ui',
    '@perduraflow/app',
    '@perduraflow/config',
    'solito',
    'react-native-web',
    '@tamagui/react-native-svg',
    '@tamagui/next-theme',
    '@tamagui/lucide-icons',
    'expo-linking',
    'expo-constants',
    'expo-modules-core',
  ],
  experimental: {
    scrollRestoration: true,
  },
  turbopack: {
    resolveAlias: {
      'react-native': 'react-native-web',
      'react-native-svg': '@tamagui/react-native-svg',
      'react-native-safe-area-context': './shims/react-native-safe-area-context.js',
    },
    resolveExtensions: [
      '.web.tsx',
      '.web.ts',
      '.web.js',
      '.web.jsx',
      '.tsx',
      '.ts',
      '.js',
      '.jsx',
      '.json',
    ],
  },
}
