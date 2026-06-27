import { useEffect, useState } from 'react'
import type { WhatIfResultDto } from '@perduraflow/contracts'
import { P, Spinner, XStack, YStack } from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useWhatIf } from '../../hooks/useWhatIf'
import { WhatIfOptionSet } from './whatif-option-set'

/** A firm at-risk order the two doors act on. `label` = release reference (falls back to the line id). */
export interface AtRiskOrderRef {
  demandLineId: string
  label: string
}

/**
 * "See options" body — the engine's BOUNDED, root-matched remediation set for ONE at-risk order,
 * rendered as the SAME costed option-set card the line-down flow uses ({@link WhatIfOptionSet}). It runs
 * the deterministic `at_risk_remediation` what-if on mount (the engine reads the order's causal-chain
 * root — no conversational layer to grab the wrong signal), then renders selectable tiles + the demoted
 * line + the honest-unachievable verdict. Shown in the global popup by `useSeeOptions`.
 */
export function AtRiskOptionsCard({
  plantId,
  order,
  onApplied,
}: {
  plantId: string
  order: AtRiskOrderRef
  onApplied?: (versionId: string) => void
}) {
  const { t } = useTranslation()
  const whatIf = useWhatIf()
  const [result, setResult] = useState<WhatIfResultDto | null>(null)

  useEffect(() => {
    let live = true
    whatIf.mutate(
      { plantId, changeSet: { origin: { type: 'manual' }, changes: [{ kind: 'at_risk_remediation', demandLineId: order.demandLineId }] } },
      { onSuccess: (r) => { if (live) setResult(r) } },
    )
    return () => {
      live = false
    }
    // Run once per (order, plant) — the deterministic result is cache-stable; whatIf identity is unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantId, order.demandLineId])

  if (result) return <WhatIfOptionSet result={result} onApplied={onApplied} />
  if (whatIf.isError)
    return (
      <P size={4} color="$danger">
        {t('whatif:evaluateError')}
      </P>
    )
  return (
    <XStack gap="$2" alignItems="center" padding="$3">
      <Spinner />
      <P size={4} color="$textSecondary">
        {t('whatif:evaluating')}
      </P>
    </XStack>
  )
}
