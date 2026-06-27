import { useMedia } from 'tamagui'
import { AtRiskOptionsCard, type AtRiskOrderRef } from '../features/whatif/at-risk-options-card'
import { useTranslation } from '../i18n'
import { useOpenCopilotWith } from '../stores/copilot.store'
import { useSelectedPlantId } from '../stores/plant.store'
import { usePopup } from '../stores/popup.store'
import { useWhatIf } from './useWhatIf'

export type { AtRiskOrderRef }

/**
 * "See options" (PRIMARY door) — open the BOUNDED, root-matched costed option-set for an at-risk order
 * in the global popup. Deterministic: the engine reads the order's chain root; the card ({@link
 * AtRiskOptionsCard} → {@link WhatIfOptionSet}) renders selectable tiles / demoted line / unremediable.
 *
 * @returns `(order, onApplied?) => void` — `onApplied(versionId)` lets the caller refresh to the new
 *   draft (the popup auto-closes on apply).
 */
export function useSeeOptions(): (order: AtRiskOrderRef, onApplied?: (versionId: string) => void) => void {
  const { show, hide } = usePopup()
  const plantId = useSelectedPlantId()
  const { t } = useTranslation()
  return (order, onApplied) => {
    if (!plantId) return
    show({
      title: t('whatif:optionsFor', { order: order.label }),
      size: 'xlarge',
      content: (
        <AtRiskOptionsCard
          plantId={plantId}
          order={order}
          onApplied={(v) => {
            onApplied?.(v)
            hide()
          }}
        />
      ),
    })
  }
}

/**
 * "Evaluate options" (SECONDARY door) — open the Copilot for OPEN exploration, anchored to the SAME
 * engine result. Pre-runs the deterministic `at_risk_remediation` so the conversation starts from the
 * correct root-matched set (this is what fixes the wear-misroute — the Copilot no longer re-derives the
 * root from a prompt + on-screen wear signal). The planner then explores beyond the bounded set
 * (combine levers, a different operator, move the date, do nothing, "why is reroute a non-option?").
 *
 * @returns `(order) => void` to wire to the secondary button.
 */
export function useDiscussOptions(): (order: AtRiskOrderRef) => void {
  const whatIf = useWhatIf()
  const plantId = useSelectedPlantId()
  const openCopilotWith = useOpenCopilotWith()
  const { hide } = usePopup()
  const media = useMedia()
  const { t } = useTranslation()
  return (order) => {
    if (!plantId) return
    if (media['max-md']) hide() // dismiss the sheet before the Copilot slide-over (they'd stack on small)
    const prompt = t('exceptions:discussPrompt', { order: order.label })
    whatIf
      .mutateAsync({
        plantId,
        changeSet: { origin: { type: 'manual' }, changes: [{ kind: 'at_risk_remediation', demandLineId: order.demandLineId }] },
      })
      .then((r) => openCopilotWith(prompt, r.id)) // anchor the conversation to the deterministic result
      .catch(() => openCopilotWith(prompt)) // engine hiccup → still open; the LLM falls back to the prompt
  }
}
