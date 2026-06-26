import 'intl-pluralrules'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { useFonts } from 'expo-font'
import { SplashScreen, Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { Provider } from '@perduraflow/app/provider'
import { queryClient } from '@perduraflow/app/lib/query-client'
import { restoreSession } from '@perduraflow/app/lib/session'
import { useThemePreference } from '@perduraflow/app/stores/ui.store'
import { initI18n } from '@perduraflow/app/i18n'
import { CopilotHost } from '@perduraflow/app/features/conversation/copilot-host'
import { PopupHost } from '@perduraflow/app/provider/PopupHost'

initI18n()
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [interLoaded, interError] = useFonts({
    Inter: require('@tamagui/font-inter/otf/Inter-Medium.otf'),
    InterBold: require('@tamagui/font-inter/otf/Inter-Bold.otf'),
  })

  // Native theme = OS preference (Appearance) by default, overridable via the
  // ui store (SettingsScreen) — the native counterpart to web's next-theme
  // override (UI-ARCHITECTURE.md §3).
  const colorScheme = useColorScheme()
  const preference = useThemePreference()
  const theme = preference === 'system' ? (colorScheme === 'dark' ? 'dark' : 'light') : preference

  useEffect(() => {
    void restoreSession()
  }, [])

  useEffect(() => {
    if (interLoaded || interError) SplashScreen.hideAsync()
  }, [interLoaded, interError])

  if (!interLoaded && !interError) return null

  return (
    // GestureHandlerRootView must wrap the whole app — Tamagui's Sheet uses
    // react-native-gesture-handler for drag/scroll handoff; without this root the
    // sheet gestures are inconsistent (and non-functional on Android).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <Provider defaultTheme={theme}>
            <Stack screenOptions={{ headerShown: false }} />
            <CopilotHost />
            <PopupHost />
          </Provider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
