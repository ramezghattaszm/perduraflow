import type { ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import {
  AppToast,
  AppToastViewport,
  type TamaguiProviderProps,
  TamaguiProvider,
  ToastProvider,
  config,
} from '@perduraflow/ui'
import { PopupHost } from './PopupHost'
import { SafeArea } from './safe-area'

/**
 * App root provider: Tamagui theme + Toast + global Popup host. Mounted once at
 * the top of each app (expo _layout, next NextTamaguiProvider). Renders the
 * shared <AppToast /> + <AppToastViewport /> so useToast() works everywhere
 * (UI §13), and <PopupHost /> so usePopup() works everywhere (one popup at a time).
 */
export function Provider({
  children,
  defaultTheme,
  ...rest
}: { children: ReactNode; defaultTheme?: string } & Omit<
  TamaguiProviderProps,
  'config' | 'children'
>) {
  const colorScheme = useColorScheme()
  const theme = defaultTheme ?? (colorScheme === 'dark' ? 'dark' : 'light')

  return (
    <TamaguiProvider config={config} defaultTheme={theme} {...rest}>
      <SafeArea>
        <ToastProvider swipeDirection="up" duration={4000}>
          {children}
          <AppToast />
          <AppToastViewport />
          <PopupHost />
        </ToastProvider>
      </SafeArea>
    </TamaguiProvider>
  )
}
