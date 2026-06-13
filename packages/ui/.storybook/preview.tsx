import { config } from '@perduraflow/config'
import { withThemeFromJSXProvider } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react'
import type { ReactNode } from 'react'
import { TamaguiProvider, Theme, YStack } from 'tamagui'

/**
 * Global decorator: every story renders inside the real TamaguiProvider with the
 * app's config, wrapped in a `<Theme>` so the @storybook/addon-themes toolbar
 * toggle (light/dark) swaps the active Tamagui theme. The background fills with
 * the semantic `$background` token so contrast reads correctly in both themes.
 */
function ThemeProvider({ theme, children }: { theme: 'light' | 'dark'; children: ReactNode }) {
  return (
    <TamaguiProvider config={config} defaultTheme={theme}>
      <Theme name={theme}>
        <YStack flex={1} backgroundColor="$background" padding="$4" gap="$4">
          {children}
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [
    withThemeFromJSXProvider({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      Provider: ThemeProvider,
    }),
  ],
}

export default preview
