import { Toast, useToastState } from '@tamagui/toast'
import { Text, XStack, YStack } from 'tamagui'
import { toastConfig, type ToastType } from '@perduraflow/config'

/**
 * AppToast (UI-ARCHITECTURE.md §13). Renders the current toast styled by type
 * from the shared toastConfig. Screens never render this — they call useToast().
 * Skips toasts handled natively (e.g. burnt on iOS) so they aren't double-shown.
 */
export function AppToast() {
  const current = useToastState()
  if (!current || current.isHandledNatively) return null

  const data = (current.customData ?? {}) as { type?: ToastType }
  const type = data.type ?? toastConfig.defaultType
  const c = toastConfig.colors[type]

  return (
    <Toast
      key={current.id}
      duration={current.duration}
      enterStyle={{ opacity: 0, scale: 0.95, y: -12 }}
      exitStyle={{ opacity: 0, scale: 0.95, y: -8 }}
      opacity={1}
      scale={1}
      y={0}
      backgroundColor={c.background}
      borderRadius="$4"
      paddingHorizontal="$4"
      paddingVertical="$3"
    >
      <XStack gap="$3" alignItems="center">
        <Text fontSize={16}>{c.icon}</Text>
        <YStack flex={1}>
          {current.title ? (
            <Toast.Title fontFamily="$heading" fontWeight="600" fontSize={15} color={c.text}>
              {current.title}
            </Toast.Title>
          ) : null}
          {current.message ? (
            <Toast.Description fontFamily="$body" fontSize={14} color={c.text}>
              {current.message}
            </Toast.Description>
          ) : null}
        </YStack>
      </XStack>
    </Toast>
  )
}
