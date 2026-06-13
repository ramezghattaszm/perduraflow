import { toastConfig, type ToastOptions, useToastController } from '@perduraflow/ui'

/**
 * Toast hook (UI-ARCHITECTURE.md §13). The only way screens raise toasts —
 * never call @tamagui/toast directly. The type travels in customData so
 * <AppToast /> can color it from toastConfig.
 */
export function useToast() {
  const controller = useToastController()

  const showToast = (message: string, options: ToastOptions = {}) => {
    const title = options.title ?? message
    controller.show(title, {
      message: options.title ? message : undefined,
      duration: options.duration ?? toastConfig.defaultDuration,
      customData: { type: options.type ?? toastConfig.defaultType },
    })
  }

  const clearToasts = () => controller.hide()

  return { showToast, clearToasts }
}
