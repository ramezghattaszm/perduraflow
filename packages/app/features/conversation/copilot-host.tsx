'use client'

import { MessagesSquare } from '@tamagui/lucide-icons'
import { Button, Portal, YStack, useMedia } from '@perduraflow/ui'
import { useIsAuthenticated } from '../../stores/auth.store'
import { useCloseCopilot, useCopilotOpen, useOpenCopilot } from '../../stores/copilot.store'
import { CopilotPanel } from './copilot-panel'

/**
 * Copilot host (phase 6) — mounts the **slide-over** once, above the per-screen shell
 * and inside QueryClient, so the Copilot **travels with the user** across screens and
 * keeps its conversation on navigate-away. A floating trigger opens a right-side panel
 * over the current content (board/scorecard/…) — the conversation is adjacent to what
 * it's about. Authenticated-only; the panel is plant-scoped via the shared plant store.
 */
export function CopilotHost() {
  const authed = useIsAuthenticated()
  const open = useCopilotOpen()
  const openCopilot = useOpenCopilot()
  const close = useCloseCopilot()
  const media = useMedia()
  if (!authed) return null

  return (
    <>
      {!open ? (
        <YStack position="fixed" bottom={24} right={24} zIndex={200000}>
          <Button circular size="$5" backgroundColor="$primary" icon={<MessagesSquare size={22} color="$surface" />} onPress={openCopilot} aria-label="Open Copilot" />
        </YStack>
      ) : null}

      {open ? (
        <Portal>
          {/* scrim */}
          <YStack position="fixed" top={0} left={0} right={0} bottom={0} backgroundColor="rgba(0,0,0,0.35)" zIndex={200000} pointerEvents="auto" onPress={close} />
          {/* right-side slide-over (full-width on small) */}
          <YStack
            position="fixed"
            top={0}
            right={0}
            bottom={0}
            width={media['max-md'] ? '100%' : '40%'}
            minWidth={media['max-md'] ? undefined : 460}
            zIndex={200001}
            pointerEvents="auto"
            borderLeftWidth={1}
            borderLeftColor="$borderColor"
            elevation="$4"
          >
            <CopilotPanel onClose={close} />
          </YStack>
        </Portal>
      ) : null}
    </>
  )
}
