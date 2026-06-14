import type { ReactNode } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

/**
 * Global popup state (UI §6). There is exactly **one** popup at any time:
 * `show` replaces whatever is open. `PopupHost` (rendered once in the app
 * provider) renders the active popup as a responsive `Popup` — a dialog on
 * larger screens, a bottom sheet on small ones.
 */
export interface PopupButton {
  text: string
  /** Return `false` to keep the popup open after the press; otherwise it closes. */
  onPress?: () => void | boolean
  tone?: 'primary' | 'danger' | 'light'
  disabled?: boolean
  loading?: boolean
}

export interface PopupOptions {
  title?: string
  message?: string
  /** Arbitrary body content (forms, custom layouts). */
  content?: ReactNode
  buttons?: PopupButton[]
  size?: 'small' | 'medium' | 'large'
  /** Allow overlay-press / drag / escape to dismiss. Default true. */
  dismissable?: boolean
}

interface PopupState {
  popup: PopupOptions | null
  show: (options: PopupOptions) => void
  hide: () => void
}

const usePopupStore = create<PopupState>((set) => ({
  popup: null,
  show: (popup) => set({ popup }),
  hide: () => set({ popup: null }),
}))

export { usePopupStore } // raw — for getState() / multi-value reads

/** The currently open popup options, or null. */
export const useActivePopup = () => usePopupStore((s) => s.popup)

/**
 * Imperative popup control: `show(options)` opens (replacing any open popup —
 * only one at a time), `hide()` closes.
 *
 * @example
 * const { show, hide } = usePopup()
 * show({ title: 'Delete?', message: 'This cannot be undone.', buttons: [
 *   { text: 'Cancel', tone: 'light' },
 *   { text: 'Delete', tone: 'danger', onPress: () => { remove() } },
 * ]})
 */
export const usePopup = () =>
  usePopupStore(useShallow((s) => ({ show: s.show, hide: s.hide })))
