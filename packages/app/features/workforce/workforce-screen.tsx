'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ColorTokens, MatrixCell } from '@perduraflow/ui'
import {
  AppSelect,
  CoverageProposal,
  H,
  P,
  PageHeader,
  Panel,
  QualificationMatrix,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useConfirmCoverageProposal, useCoverage } from '../../hooks/useLearning'
import { useSetScreenContext } from '../../stores/screenContext.store'
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

  // Pass D (coverage): the selected operator is the deictic referent ("this operator / this
  // gap") — it resolves to selectedOperatorId, which retrieve_coverage focuses on. Published to
  // the screen-context store (cleared on unmount, reset on plant change — no cross-screen leak).
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null)
  const setScreenContext = useSetScreenContext()
  useEffect(() => setSelectedOperatorId(null), [plantId])
  useEffect(() => {
    setScreenContext({ screen: 'workforce', selectedOperatorId: selectedOperatorId ?? undefined })
    return () => setScreenContext(null)
  }, [setScreenContext, selectedOperatorId])

  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const opIndex = useMemo(() => new Map((cov?.operators ?? []).map((o, i) => [o.id, i])), [cov])
  const stIndex = useMemo(() => new Map((cov?.stations ?? []).map((s, i) => [s.id, i])), [cov])

  const onConfirm = (id: string) =>
    confirmProposal.mutate(id, { onSuccess: () => setConfirmed((s) => new Set(s).add(id)) })

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <YStack width={220}>
            <AppSelect
              options={plantOptions}
              value={plantId}
              onChange={setPlant}
              placeholder={t('plant')}
            />
          </YStack>
        }
      />

      {!cov ? null : (
        <XStack
          gap="$4"
          flexWrap="wrap"
          alignItems="flex-start"
        >
          {/* Coverage panel — ~60%. Full-bleed matrix (pinned OPERATOR column,
              cert columns scroll) + legend below, divided by a horizontal line. */}
          <Panel
            title={t('matrix.title')}
            flexGrow={3}
            flexBasis={360}
            minWidth={300}
            contentPadding="$0"
            contentGap="$0"
          >
            <QualificationMatrix
              bordered={false}
              rows={cov.operators.map((o) => ({
                id: o.id,
                label: o.label,
                out: o.out,
                // OUT pill carries the reason ("Out · Vacation") so absence type is visible at a glance.
                outLabel: o.out
                  ? `${t('out')} · ${o.outReason ? t(`absence.${o.outReason}`) : ''}`.replace(
                      / · $/,
                      ''
                    )
                  : undefined,
              }))}
              cols={cov.stations.map((s) => ({ id: s.id, label: s.label, marked: s.certRequired }))}
              rowHeader={t('operator')}
              emptyText={t('empty')}
              selectedRowId={selectedOperatorId}
              onRowSelect={(id) => setSelectedOperatorId((cur) => (cur === id ? null : id))}
              isOn={() => false}
              onToggle={() => {}}
              cellState={(rowId, colId) => {
                const r = opIndex.get(rowId)
                const c = stIndex.get(colId)
                if (r == null || c == null) return 'off'
                return CELL[cov.cells[r]?.[c] ?? 'not_qualified'] ?? 'off'
              }}
            />
            <XStack
              gap="$4"
              flexWrap="wrap"
              padding="$3"
              borderTopWidth={1}
              borderTopColor="$borderColor"
            >
              <Legend
                tone="$primary"
                label={t('legend.qualified')}
              />
              <Legend
                tone="$borderColor"
                label={t('legend.notQualified')}
                outline
              />
              <Legend
                tone="$dangerSoft"
                label={t('legend.gap')}
              />
              <P
                size={5}
                color="$textSecondary"
              >
                {t('legend.certRequired')}
              </P>
            </XStack>
          </Panel>

          {/* Readiness panel — ~40%. The "%" is the panel's one hero number. */}
          <Panel
            title={t('readiness.title')}
            flexGrow={2}
            flexBasis={240}
            minWidth={240}
          >
            <YStack gap="$1">
              <H
                level={3}
                color={cov.certGapCount > 0 ? '$warning' : '$success'}
              >
                {Math.round(cov.readinessPct * 100)}%
              </H>
              <P
                size={4}
                color="$textSecondary"
              >
                {t('readiness.effective')} · {t('readiness.gaps', { count: cov.certGapCount })}
              </P>
            </YStack>
            {cov.proposals.length === 0 ? (
              <P
                size={4}
                color="$textSecondary"
              >
                {t('proposal.none')}
              </P>
            ) : (
              cov.proposals.map((p) => (
                <CoverageProposal
                  key={p.id}
                  heading={p.tentative ? t('proposal.headingTentative') : t('proposal.heading')}
                  gapText={t('proposal.gap', { station: p.station })}
                  actionText={t('proposal.action', { operator: p.operatorName })}
                  detailText={
                    p.tentative
                      ? t('proposal.tentativeDetail', { operator: p.operatorName })
                      : t('proposal.detail')
                  }
                  confirmLabel={t('proposal.confirm')}
                  confirmedLabel={t('proposal.confirmed')}
                  confirmed={confirmed.has(p.id)}
                  loading={confirmProposal.isPending}
                  onConfirm={() => onConfirm(p.id)}
                />
              ))
            )}
          </Panel>
        </XStack>
      )}
    </>
  )
}

/** A small coverage legend swatch. */
function Legend({ tone, label, outline }: { tone: ColorTokens; label: string; outline?: boolean }) {
  return (
    <XStack
      alignItems="center"
      gap="$2"
    >
      <YStack
        width={14}
        height={14}
        borderRadius="$2"
        backgroundColor={outline ? 'transparent' : tone}
        borderWidth={outline ? 1 : 0}
        borderColor="$borderColor"
      />
      <P
        size={5}
        color="$textSecondary"
      >
        {label}
      </P>
    </XStack>
  )
}

/** Web Workforce screen — body inside the desktop `AdminShell` chrome. */
export function WorkforceScreen() {
  const { t } = useTranslation('workforce')
  return (
    <AdminShell
      activeId="workforce"
      title={t('title')}
    >
      <WorkforceContent />
    </AdminShell>
  )
}
