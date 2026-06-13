import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'

/**
 * Storybook for @perduraflow/ui, built on Vite. Components render through the
 * real Tamagui config (see .storybook/preview.tsx) so stories reflect production
 * tokens/themes. Tamagui runs in runtime mode here (no optimizing compiler) —
 * styles are injected at runtime, which is all Storybook needs.
 *
 * react-native is aliased to react-native-web and `.web.tsx` resolves first, so
 * platform-specific files (Screen.web, GradientScreen.web) are used and
 * native-only modules (expo-linear-gradient) are never bundled.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (cfg) =>
    mergeConfig(cfg, {
      define: {
        'process.env.TAMAGUI_TARGET': JSON.stringify('web'),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
      },
      resolve: {
        alias: { 'react-native': 'react-native-web' },
        extensions: [
          '.web.tsx',
          '.web.ts',
          '.web.jsx',
          '.web.js',
          '.tsx',
          '.ts',
          '.jsx',
          '.js',
          '.mjs',
          '.json',
        ],
      },
      optimizeDeps: {
        include: ['react-native-web'],
        esbuildOptions: { resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js'] },
      },
    }),
}

export default config
