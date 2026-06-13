import { ToastViewport } from '@tamagui/toast'

/**
 * AppToastViewport (UI-ARCHITECTURE.md §13). Single top-center viewport — native
 * always shows top-center; on web this is the default. (Per-position viewports
 * are a web-only enhancement layered on later if an app needs them.) Rendered
 * once at the app root alongside <AppToast />.
 */
export function AppToastViewport() {
  return (
    <ToastViewport
      multipleToasts
      top="$8"
      left={0}
      right={0}
      justifyContent="center"
      alignItems="center"
    />
  )
}
