'use client'

import { AppButton, Popup } from '@perduraflow/ui'
import { useActivePopup, usePopup } from '../stores/popup.store'

/**
 * Renders the single active popup (from the popup store) as a responsive `Popup`
 * — dialog on larger screens, bottom sheet on small. Mounted once in the app
 * Provider so `usePopup().show(...)` works from anywhere. A button's `onPress`
 * returning `false` keeps the popup open; otherwise it closes after the press.
 */
export function PopupHost() {
  const popup = useActivePopup()
  const { hide } = usePopup()

  return (
    <Popup
      open={!!popup}
      onClose={hide}
      title={popup?.title}
      description={popup?.message}
      size={popup?.size}
      dismissable={popup?.dismissable ?? true}
      footer={
        popup?.buttons?.length
          ? popup.buttons.map((b, i) => (
              <AppButton
                key={`${b.text}-${i}`}
                variant={b.tone ?? 'primary'}
                size="$3"
                disabled={b.disabled}
                loading={b.loading}
                onPress={() => {
                  // onPress returning false keeps it open (e.g. async/validation).
                  if (b.onPress?.() !== false) hide()
                }}
              >
                {b.text}
              </AppButton>
            ))
          : undefined
      }
    >
      {popup?.content}
    </Popup>
  )
}
