'use client'

import '@tamagui/core/reset.css'
import '@tamagui/font-inter/css/400.css'
import '@tamagui/font-inter/css/700.css'
import '@tamagui/polyfill-dev'

import { type ReactNode, useEffect } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { NextThemeProvider, useRootTheme, useThemeSetting } from '@tamagui/next-theme'
import { config } from '@perduraflow/ui'
import { Provider } from '@perduraflow/app/provider'
import { StyleSheet } from 'react-native'
import { THEME_COOKIE, isResolvedTheme, type ResolvedTheme } from './theme-cookie'

/**
 * Web root provider with SSR-deterministic theming (UI-ARCHITECTURE.md §3).
 *
 * - Defaults to **system** preference (`enableSystem`), with the user override
 *   handled by @tamagui/next-theme (toggle persists to localStorage + flips the
 *   `t_light`/`t_dark` class before hydration).
 * - `initialTheme` comes from the theme cookie read in the server `layout.tsx`,
 *   so the first server paint already carries the right theme.
 * - The resolved theme is written back to the cookie so the next load is
 *   deterministic. `<html suppressHydrationWarning>` + CSS-var inline styles
 *   (GradientScreen.web) prevent any hydration mismatch.
 */
export const NextTamaguiProvider = ({
  children,
  initialTheme,
}: {
  children: ReactNode
  initialTheme?: ResolvedTheme
}) => {
  const [rootTheme, setRootTheme] = useRootTheme()

  useServerInsertedHTML(() => {
    // @ts-ignore
    const rnwStyle = StyleSheet.getSheet()
    return (
      <>
        <link rel="stylesheet" href="/tamagui.css" />
        {/* color-scheme per theme so native controls/scrollbars match (UI §3) */}
        <style
          dangerouslySetInnerHTML={{
            __html: ':root.t_light{color-scheme:light}:root.t_dark{color-scheme:dark}',
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: rnwStyle.textContent }} id={rnwStyle.id} />
        <style dangerouslySetInnerHTML={{ __html: config.getNewCSS() }} />
        <style
          dangerouslySetInnerHTML={{
            __html: config.getCSS({
              exclude: process.env.NODE_ENV === 'production' ? 'design-system' : null,
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('t_unmounted')`,
          }}
        />
      </>
    )
  })

  return (
    <NextThemeProvider
      skipNextHead
      enableSystem
      defaultTheme={initialTheme ?? 'system'}
      onChangeTheme={(next) => setRootTheme(next as ResolvedTheme)}
    >
      <Provider disableRootThemeClass defaultTheme={rootTheme || initialTheme || 'light'}>
        <ThemeCookieSync />
        {children}
      </Provider>
    </NextThemeProvider>
  )
}

/** Persists the resolved theme to the cookie for the next server render. */
function ThemeCookieSync() {
  const { resolvedTheme } = useThemeSetting()
  useEffect(() => {
    if (isResolvedTheme(resolvedTheme)) {
      document.cookie = `${THEME_COOKIE}=${resolvedTheme}; path=/; max-age=31536000; samesite=lax`
    }
  }, [resolvedTheme])
  return null
}
