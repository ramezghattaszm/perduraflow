import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'

// react-native-web has no `Libraries/Utilities/codegenNativeComponent`, but native-only transitive
// deps (react-native-safe-area-context) import it; without a shim the `react-native`→`react-native-web`
// alias rewrites that deep path to a nonexistent file and the build fails. See the shim for detail.
const codegenShim = fileURLToPath(new URL('./codegenNativeComponent.shim.js', import.meta.url))

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
        // Array form so order is deterministic: the specific deep-path shim must be tried BEFORE the
        // general `react-native`→`react-native-web` prefix alias (which would otherwise capture it).
        alias: [
          { find: 'react-native/Libraries/Utilities/codegenNativeComponent', replacement: codegenShim },
          { find: 'react-native', replacement: 'react-native-web' },
        ],
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
        // `.web.js`/`.web.jsx` MUST be listed (and first): react-native-svg ships web variants as
        // `.web.js`; without them esbuild's pre-bundle resolves its native Fabric modules instead, which
        // import `TurboModuleRegistry` (absent from react-native-web) and the build fails.
        esbuildOptions: {
          resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js'],
        },
      },
    }),
}

export default config
