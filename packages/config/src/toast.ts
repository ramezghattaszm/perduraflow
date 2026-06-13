/**
 * Toast configuration (UI-ARCHITECTURE.md §13). All defaults live here so they
 * can be changed once and apply everywhere. Colors are semantic tokens, never
 * hex. Screens never call @tamagui/toast directly — they use `useToast()`.
 */

import type { ColorTokens } from 'tamagui'

export type ToastType = 'info' | 'warning' | 'success' | 'error'

// Positions are web-only; native always shows top-center.
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface ToastOptions {
  type?: ToastType
  position?: ToastPosition
  /** ms; 0 = persistent (only clearToasts() removes it). */
  duration?: number
  dismissible?: boolean
  title?: string
}

export interface ToastColorSet {
  background: ColorTokens
  text: ColorTokens
  icon: string
}

export const toastConfig = {
  defaultDuration: 4000,
  defaultPosition: 'top-center' as ToastPosition,
  defaultType: 'info' as ToastType,
  defaultDismissible: true,
  maxQueueLength: 3,
  nativePosition: 'top-center' as ToastPosition,
  colors: {
    info: { background: '$primary', text: '$surface', icon: 'ℹ️' },
    warning: { background: '$warning', text: '$textPrimary', icon: '⚠️' },
    error: { background: '$danger', text: '$surface', icon: '✕' },
    success: { background: '$success', text: '$surface', icon: '✓' },
  } satisfies Record<ToastType, ToastColorSet>,
} as const
