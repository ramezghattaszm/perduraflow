import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { NextTamaguiProvider } from '@perduraflow/app/provider/NextTamaguiProvider'
import {
  THEME_COOKIE,
  isResolvedTheme,
  themeClassName,
  type ResolvedTheme,
} from '@perduraflow/app/provider/theme-cookie'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Perdura',
  description: 'Built with the Perdura template.',
  icons: '/favicon.ico',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the theme cookie so SSR renders the theme the client will resolve
  // (UI-ARCHITECTURE.md §3 "SSR theme determinism"). First visit (no cookie):
  // render neutral and let next-theme's pre-hydration script set the class.
  const cookieValue = (await cookies()).get(THEME_COOKIE)?.value
  const theme: ResolvedTheme | undefined = isResolvedTheme(cookieValue) ? cookieValue : undefined

  return (
    <html
      lang="en"
      className={themeClassName(theme)}
      style={theme ? { colorScheme: theme } : undefined}
      suppressHydrationWarning
    >
      <body>
        <NextTamaguiProvider initialTheme={theme}>
          <Providers>{children}</Providers>
        </NextTamaguiProvider>
      </body>
    </html>
  )
}
