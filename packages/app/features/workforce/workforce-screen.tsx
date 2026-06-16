'use client'

import { useMemo, useState } from 'react'
import type { ColorTokens, MatrixCell } from '@perduraflow/ui'
import {
  ContextSelectors,
  CoverageProposal,
  H,
  P,
  PageHeader,
  QualificationMatrix,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useConfirmCoverageProposal, useCoverage } from '../../hooks/useLearning'
import { AdminShell } from '../shell/admin-shell'

const CELL: Record<string, MatrixCell> = { qualified: 'on', not_qualified: 'off', gap: 'gap' }

/**
 * View 3 · Workforce coverage (supervisor). The operator×station coverage grid
 * (reuses {@link QualificationMatrix}, coverage skin), next-shift readiness, and the
 * cert-gap → named-operator OT **confirmed proposal** (D54; labor-aware, not
 * rostering). All from seeded master-data rows. Shell-agnostic body for native.
 */
export function WorkforceContent() {
  const { t } = useTranslation('workforce')
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)

  const { data: cov } = useCoverage(plantId ?? undefined)
  const confirmProposal = useConfirmCoverageProposal(plantId ?? undefined)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())

  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const opIndex = useMemo(() => new Map((cov?.operators ?? []).map((o, i) => [o.id, i])), [cov])
  const stIndex = useMemo(() => new Map((cov?.stations ?? []).map((s, i) => [s.id, i])), [cov])

  const onConfirm = (id: string) =>
    confirmProposal.mutate(id, { onSuccess: () => setConfirmed((s) => new Set(s).add(id)) })

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ContextSelectors selectors={[{ label: t('plant'), value: plantId, options: plantOptions, onChange: setPlant, width: 240 }]} />

      {!cov ? null : (
        <XStack gap="$4" flexWrap="wrap" alignItems="flex-start">
          <YStack flexGrow={2} flexBasis={420} minWidth={320} gap="$3">
            <P size={3} weight="b">
              {t('matrix.title')}
            </P>
            <QualificationMatrix
              rows={cov.operators.map((o) => ({ id: o.id, label: o.label, out: o.out }))}
              cols={cov.stations.map((s) => ({ id: s.id, label: s.label, marked: s.certRequired }))}
              rowHeader={t('operator')}
              emptyText={t('empty')}
              isOn={() => false}
              onToggle={() => {}}
              cellState={(rowId, colId) => {
                const r = opIndex.get(rowId)
                const c = stIndex.get(colId)
                if (r == null || c == null) return 'off'
                return CELL[cov.cells[r]?.[c] ?? 'not_qualified'] ?? 'off'
              }}
            />
            <XStack gap="$4" flexWrap="wrap">
              <Legend tone="$primary" label={t('legend.qualified')} />
              <Legend tone="$borderColor" label={t('legend.notQualified')} outline />
              <Legend tone="$dangerSoft" label={t('legend.gap')} />
              <P size={5} color="$textSecondary">
                {t('legend.certRequired')}
              </P>
            </XStack>
          </YStack>

          <YStack flexGrow={1} flexBasis={300} minWidth={260} gap="$3">
            <YStack>
              <P size={5} weight="b" color="$textSecondary">
                {t('readiness.title').toUpperCase()}
              </P>
              <H level={1} color={cov.certGapCount > 0 ? '$warning' : '$success'}>
                {Math.round(cov.readinessPct * 100)}%
              </H>
              <P size={4} color="$textSecondary">
                {t('readiness.effective')} · {t('readiness.gaps', { count: cov.certGapCount })}
              </P>
            </YStack>
            {cov.proposals.length === 0 ? (
              <P size={4} color="$textSecondary">
                {t('proposal.none')}
              </P>
            ) : (
              cov.proposals.map((p) => (
                <CoverageProposal
                  key={p.id}
                  heading={t('proposal.heading')}
                  gapText={t('proposal.gap', { station: p.station })}
                  actionText={t('proposal.action', { operator: p.operatorName })}
                  detailText={t('proposal.detail')}
                  confirmLabel={t('proposal.confirm')}
                  confirmedLabel={t('proposal.confirmed')}
                  confirmed={confirmed.has(p.id)}
                  loading={confirmProposal.isPending}
                  onConfirm={() => onConfirm(p.id)}
                />
              ))
            )}
          </YStack>
        </XStack>
      )}
    </>
  )
}

/** A small coverage legend swatch. */
function Legend({ tone, label, outline }: { tone: ColorTokens; label: string; outline?: boolean }) {
  return (
    <XStack alignItems="center" gap="$2">
      <YStack
        width={14}
        height={14}
        borderRadius="$2"
        backgroundColor={outline ? 'transparent' : tone}
        borderWidth={outline ? 1 : 0}
        borderColor="$borderColor"
      />
      <P size={5} color="$textSecondary">
        {label}
      </P>
    </XStack>
  )
}

/** Web Workforce screen — body inside the desktop `AdminShell` chrome. */
export function WorkforceScreen() {
  const { t } = useTranslation('workforce')
  return (
    <AdminShell activeId="workforce" title={t('title')}>
      <WorkforceContent />
    </AdminShell>
  )
}
