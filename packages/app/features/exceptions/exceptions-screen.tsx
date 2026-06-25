'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ParameterPredictionDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppSelect,
  ExceptionRow,
  KpiTile,
  KpiTileRow,
  P,
  PageHeader,
  Panel,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { latenessSummary } from '../../utils/lateness'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useScheduleResources, useWorkList } from '../../hooks/useScheduling'
import { useApprovePrediction, useDismissPrediction, usePredictions } from '../../hooks/useLearning'
import { useCanConfigure } from '../../stores/auth.store'
import { useSetScreenContext } from '../../stores/screenContext.store'
import { AdminShell } from '../shell/admin-shell'

const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
const fmtHorizon = (min: number) =>
  min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${Math.round(min)}m`

/**
 * View 4 · Exception Queue (planner) — **autonomy demonstrated, not named**. The
 * "N need you · M auto-handled" header carries the beat (the auto-handled count is
 * graduated autonomy made visible). Predictive rows from `learning.read 1.1`:
 * auto-handled (Tier-1 ≥ threshold, pre-applied + logged) and needs-you (queued /
 * higher tier). At-risk orders compose as Tier-3 needs-you rows (always human —
 * the A18 floor). Everything is a **settled statement**, never a live ticker.
 */
export function ExceptionsContent() {
  const { t } = useTranslation(['exceptions', 'scheduling'])
  const canConfigure = useCanConfigure()
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)
  const { data: resources = [] } = useScheduleResources(plantId ?? undefined)
  const { data: predictions = [] } = usePredictions(plantId ?? undefined)
  const { data: workList } = useWorkList(plantId ?? undefined)
  const approve = useApprovePrediction()
  const dismiss = useDismissPrediction()

  const resName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))

  const auto = predictions.filter(
    (p) => p.disposition === 'auto_committed' || p.disposition === 'approved'
  )
  const queued = predictions.filter((p) => p.disposition === 'queued')
  // The at-risk queue IS the Work List filtered to at-risk (order grain) — single source, so the
  // count here equals the Work List's at-risk chip (counts.atRisk) by construction.
  const atRisk = (workList?.rows ?? []).filter((r) => r.status === 'at_risk')
  const needYou = queued.length + atRisk.length

  // Pass C: the selected at-risk row is the deictic referent ("this order / why is this at-risk").
  // It resolves to selectedOrderId, which the Copilot's evaluate_what_if can act on. Published to
  // the screen-context store (cleared on unmount, reset on plant change — no cross-screen leak).
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const setScreenContext = useSetScreenContext()
  useEffect(() => setSelectedOrderId(null), [plantId])
  useEffect(() => {
    setScreenContext({ screen: 'exception', selectedOrderId: selectedOrderId ?? undefined })
    return () => setScreenContext(null)
  }, [setScreenContext, selectedOrderId])

  const title = (p: ParameterPredictionDto) =>
    `${resName.get(p.resourceId) ?? p.resourceId.slice(-5)} · ${t(`param.${p.param}`)}`
  // A re-surfaced (previously snoozed) prediction leads with the breadcrumb — WHY it's back (it got
  // more certain or imminent, exactly what the snooze promised); otherwise the plain forecast line.
  const statement = (p: ParameterPredictionDto) =>
    p.dismissedAtConfidence != null
      ? t('pred.resurfaced', {
          wasConf: Math.round(p.dismissedAtConfidence * 100),
          wasHorizon: fmtHorizon(p.dismissedAtHorizonMinutes ?? 0),
          conf: Math.round(p.confidence * 100),
          horizon: fmtHorizon(p.horizonMinutes),
          crossing: fmtTime(p.crossingAt),
        })
      : t('pred.statement', {
          crossing: fmtTime(p.crossingAt),
          conf: Math.round(p.confidence * 100),
          horizon: fmtHorizon(p.horizonMinutes),
        })

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

      <KpiTileRow>
        <KpiTile
          value={String(needYou)}
          label={t('needYou')}
          caption={t('needYouCaption')}
        />
        <KpiTile
          value={String(auto.length)}
          label={t('autoHandled')}
          caption={t('autoHandledCaption')}
        />
      </KpiTileRow>

      {/* Needs you — queued predictions (Approve/Dismiss) + at-risk (Tier-3, human). */}
      <Panel
        title={t('needYou')}
        contentPadding="$0"
        contentGap="$0"
      >
        {needYou === 0 ? (
          <YStack padding="$4">
            <P
              size={3}
              color="$textSecondary"
            >
              {t('needYouEmpty')}
            </P>
          </YStack>
        ) : (
          <>
            {queued.map((p, i) => (
              <ExceptionRow
                key={p.id}
                divided={i > 0}
                title={title(p)}
                statement={statement(p)}
                note={t('pred.action')}
                badge={{ label: t('tier.t1'), tone: 'warning' }}
                actions={
                  canConfigure ? (
                    <>
                      <AppButton
                        variant="primary"
                        size="$3"
                        loading={approve.isPending}
                        onPress={() => approve.mutate(p.id)}
                      >
                        {t('preAdjust')}
                      </AppButton>
                      <AppButton
                        variant="ghost"
                        size="$3"
                        onPress={() => dismiss.mutate(p.id)}
                      >
                        {t('dismiss')}
                      </AppButton>
                    </>
                  ) : undefined
                }
              />
            ))}
            {atRisk.map((a, i) => (
              // Order grain (one row per demand line) — the Work List consolidates an order's
              // at-risk ops into a single binding row, so demandLineId is a stable key.
              <ExceptionRow
                key={a.demandLineId}
                divided={queued.length > 0 || i > 0}
                title={a.label}
                statement={`${a.atRiskDetail ?? ''} · ${a.chain ? latenessSummary(a.chain, (k, o) => t(`scheduling:${k}`, o ?? {})) : t(`scheduling:riskReason.${a.atRiskReason}`, { defaultValue: a.atRiskReason ?? '' })}`}
                badge={{ label: t('tier.t3'), tone: 'danger' }}
                selected={selectedOrderId === a.demandLineId}
                onPress={() =>
                  setSelectedOrderId((cur) => (cur === a.demandLineId ? null : a.demandLineId))
                }
              />
            ))}
          </>
        )}
      </Panel>

      {/* Auto-handled — Tier-1 ≥ threshold, pre-applied + logged (transparent). */}
      <Panel
        title={t('autoHandled')}
        contentPadding="$0"
        contentGap="$0"
      >
        {auto.length === 0 ? (
          <YStack padding="$4">
            <P
              size={3}
              color="$textSecondary"
            >
              {t('autoHandledEmpty')}
            </P>
          </YStack>
        ) : (
          auto.map((p, i) => (
            <ExceptionRow
              key={p.id}
              divided={i > 0}
              title={title(p)}
              statement={t('pred.autoStatement', {
                crossing: fmtTime(p.crossingAt),
                conf: Math.round(p.confidence * 100),
                horizon: fmtHorizon(p.horizonMinutes),
              })}
              badge={{ label: t('autoBadge'), tone: 'active' }}
            />
          ))
        )}
      </Panel>
    </>
  )
}

/** Web Exception Queue screen — body inside the desktop `AdminShell` chrome. */
export function ExceptionsScreen() {
  const { t } = useTranslation('exceptions')
  return (
    <AdminShell
      activeId="exceptions"
      title={t('title')}
    >
      <ExceptionsContent />
    </AdminShell>
  )
}
