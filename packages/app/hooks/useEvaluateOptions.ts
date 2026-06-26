import { useMedia } from 'tamagui'
import { useOpenCopilotWith } from '../stores/copilot.store'
import { usePopup } from '../stores/popup.store'

/**
 * Open the Copilot for a remediation prompt (the "Evaluate options" action on an at-risk order).
 *
 * On **small** screens the at-risk card lives in a bottom **sheet** (the global popup); the Copilot is
 * also a bottom slide-over, so the two would stack and fight. Dismiss the sheet first, then open the
 * Copilot. On larger screens the popup is a centered dialog and the Copilot panel sits above it
 * (higher z-index), so no dismissal is needed — the prompt just opens the Copilot.
 *
 * @returns a stable callback `(prompt) => void` to wire to the "Evaluate options" press.
 * @example
 * const evaluateOptions = useEvaluateOptions()
 * <AppButton onPress={() => evaluateOptions(t(remediationPromptKey(root), { order }))}>…</AppButton>
 */
export function useEvaluateOptions(): (prompt: string) => void {
  const openCopilotWith = useOpenCopilotWith()
  const { hide } = usePopup()
  const media = useMedia()
  return (prompt: string) => {
    if (media['max-md']) hide()
    openCopilotWith(prompt)
  }
}
