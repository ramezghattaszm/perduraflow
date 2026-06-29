'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DemandExceptionDto, ParameterPredictionDto, WorkListRowDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppSelect,
  ExceptionRow,
  KpiTile,
  KpiTileRow,
  P,
  PageHeader,
  Panel,
  StatusPill,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { latenessSummary } from '../../utils/lateness'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useDemandExceptions, useScheduleResources, useWorkList } from '../../hooks/useScheduling'
import { useApprovePrediction, useDismissPrediction, usePredictions } from '../../hooks/useLearning'
import { useCanConfigure } from '../../stores/auth.store'
import { useDiscussOptions, useSeeOptions } from '../../hooks/useAtRiskRemediation'
import { useSetScreenContext } from '../../stores/screenContext.store'
import { AdminShell } from '../shell/admin-shell'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
/** Day + time, e.g. "Jun 25 06:00" — for the due-vs-earliest-start gap on a due_before_start row. */
const fmtDayTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${fmtTime(iso)}`
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
  const { data: demandExceptions = [] } = useDemandExceptions(plantId ?? undefined)
  const approve = useApprovePrediction()
  const dismiss = useDismissPrediction()

  const resName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))

  const auto = predictions.filter(
    (p) => p.disposition === 'auto_committed' || p.disposition === 'approved'
  )
  // Demand-side auto-handled: a post-commit demand change the current plan absorbs (zero NEW at-risk).
  // The same bounded/reversible/no-mutation posture as a Tier-1 wear auto-commit, so it joins the
  // Handled bucket. An `at_risk` demand change is NOT shown here — it surfaces as a normal at-risk order.
  const absorbedDemand = demandExceptions.filter((d) => d.status === 'absorbed')
  const autoCount = auto.length + absorbedDemand.length
  const queued = predictions.filter((p) => p.disposition === 'queued')
  // At-risk = the Work List filtered to at-risk (order grain, single source). "Needs you" is FIRM
  // only — a firm late order is a real human exception; forecast (speculative) at-risk is shown
  // separately as advisory, so it doesn't read as a required action or inflate the count.
  const atRisk = (workList?.rows ?? []).filter((r) => r.status === 'at_risk')
  const firmAtRisk = atRisk.filter((r) => r.firmness === 'firm')
  const forecastAtRisk = atRisk.filter((r) => r.firmness === 'forecast')
  const needYou = queued.length + firmAtRisk.length

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
  const demandTitle = (d: DemandExceptionDto) => t('demand.title', { order: d.orderRef ?? d.demandLineId })
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

  const tl = (k: string, o?: Record<string, unknown>) => t(`scheduling:${k}`, o ?? {})
  // At-risk statement = the binding op/line + the cause & lever. `due_before_start` is uniquely
  // unfixable by scheduling, so it shows the due-vs-earliest-start gap (times from the order row).
  const atRiskStatement = (a: WorkListRowDto) => {
    const detail = a.atRiskDetail ?? ''
    const cause =
      a.chain?.root === 'due_before_start'
        ? t('scheduling:lateness.dueTimed', {
            due: fmtDayTime(a.requiredDate),
            start: fmtDayTime(a.plannedStart),
          })
        : a.chain
          ? latenessSummary(a.chain, tl)
          : t(`scheduling:riskReason.${a.atRiskReason}`, { defaultValue: a.atRiskReason ?? '' })
    return detail ? `${detail} · ${cause}` : cause
  }

  // "Evaluate options" → opens the Copilot pre-seeded with the lever that matches the root cause, so
  // the planner gets the right what-if (expedite/move-date for material & due_before_start; overtime
  // for capacity/window) in one click instead of selecting the row and knowing what to ask.
  const runSeeOptions = useSeeOptions()
  const runDiscussOptions = useDiscussOptions()
  const orderRef = (a: WorkListRowDto) => ({ demandLineId: a.demandLineId, label: a.releaseReference ?? a.demandLineId })

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
          value={String(autoCount)}
          label={t('adopted')}
          caption={t('adoptedCaption')}
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
            {firmAtRisk.map((a, i) => (
              // Order grain (one row per demand line) — the Work List consolidates an order's
              // at-risk ops into a single binding row, so demandLineId is a stable key.
              <ExceptionRow
                key={a.demandLineId}
                divided={queued.length > 0 || i > 0}
                title={a.label}
                statement={atRiskStatement(a)}
                badge={{ label: t('tier.t3'), tone: 'danger' }}
                selected={selectedOrderId === a.demandLineId}
                onPress={() =>
                  setSelectedOrderId((cur) => (cur === a.demandLineId ? null : a.demandLineId))
                }
                actions={
                  <XStack gap="$2">
                    <AppButton variant="light" size="$3" onPress={() => runDiscussOptions(orderRef(a))}>
                      {t('evaluateOptions')}
                    </AppButton>
                    <AppButton variant="primary" size="$3" onPress={() => runSeeOptions(orderRef(a))}>
                      {t('seeOptions')}
                    </AppButton>
                  </XStack>
                }
              />
            ))}
          </>
        )}
      </Panel>

      {/* Forecast at-risk — speculative (non-firm) demand that's late. Advisory only: shown so it's
          visible, but no Tier-3 action (not a firm commitment). Quiet badge, no Approve/Dismiss. */}
      {forecastAtRisk.length > 0 ? (
        <Panel
          title={t('forecastAtRisk')}
          headerRight={
            <P
              size={5}
              color="$textTertiary"
            >
              {t('forecastAtRiskCaption')}
            </P>
          }
          contentPadding="$0"
          contentGap="$0"
        >
          {forecastAtRisk.map((a, i) => (
            <ExceptionRow
              key={a.demandLineId}
              divided={i > 0}
              title={a.label}
              statement={atRiskStatement(a)}
              badge={{ label: t('forecastBadge'), tone: 'inactive' }}
              selected={selectedOrderId === a.demandLineId}
              onPress={() =>
                setSelectedOrderId((cur) => (cur === a.demandLineId ? null : a.demandLineId))
              }
            />
          ))}
        </Panel>
      ) : null}

      {/* Handled / Adopted — the predicted value was adopted (pre-applied + logged). Both system
          auto-commits and your approvals live here, but each row is badged with WHO decided —
          "Auto" (system, ≥ threshold) vs "Approved" (you) — the graduated-autonomy split made visible. */}
      <Panel
        title={t('adoptedTitle')}
        contentPadding="$0"
        contentGap="$0"
      >
        {autoCount === 0 ? (
          <YStack padding="$4">
            <P
              size={3}
              color="$textSecondary"
            >
              {t('adoptedEmpty')}
            </P>
          </YStack>
        ) : (
          <>
            {auto.map((p, i) => {
              const byHuman = p.disposition === 'approved'
              return (
                <ExceptionRow
                  key={p.id}
                  divided={i > 0}
                  title={title(p)}
                  statement={t(byHuman ? 'pred.approvedStatement' : 'pred.autoStatement', {
                    crossing: fmtTime(p.crossingAt),
                    conf: Math.round(p.confidence * 100),
                    horizon: fmtHorizon(p.horizonMinutes),
                  })}
                  badge={
                    byHuman
                      ? { label: t('approvedBadge'), tone: 'neutral' }
                      : { label: t('autoBadge'), tone: 'active' }
                  }
                />
              )
            })}
            {absorbedDemand.map((d, i) => (
              <ExceptionRow
                key={`demand:${d.demandLineId}`}
                divided={auto.length > 0 || i > 0}
                title={demandTitle(d)}
                statement={t('demand.absorbedStatement', {
                  from: d.from,
                  to: d.to,
                  delta: d.delta > 0 ? `+${d.delta}` : String(d.delta),
                })}
                badge={{ label: t('demand.badge'), tone: 'active' }}
              />
            ))}
          </>
        )}
      </Panel>

      {/* Legend — what the tags mean (the tier names are kept; this explains them). */}
      <YStack
        gap="$1.5"
        paddingTop="$1"
      >
        <P
          size={5}
          weight="b"
          caps
          color="$textTertiary"
        >
          {t('legend.title')}
        </P>
        <XStack
          gap="$2"
          alignItems="center"
          flexWrap="wrap"
        >
          <StatusPill tone="warning">{t('tier.t1')}</StatusPill>
          <P
            size={4}
            color="$textSecondary"
          >
            {t('legend.t1')}
          </P>
        </XStack>
        <XStack
          gap="$2"
          alignItems="center"
          flexWrap="wrap"
        >
          <StatusPill tone="danger">{t('tier.t3')}</StatusPill>
          <P
            size={4}
            color="$textSecondary"
          >
            {t('legend.t3')}
          </P>
        </XStack>
        <XStack
          gap="$2"
          alignItems="center"
          flexWrap="wrap"
        >
          <StatusPill tone="neutral">{t('approvedBadge')}</StatusPill>
          <P
            size={4}
            color="$textSecondary"
          >
            {t('legend.approved')}
          </P>
        </XStack>
        <XStack
          gap="$2"
          alignItems="center"
          flexWrap="wrap"
        >
          <StatusPill tone="active">{t('autoBadge')}</StatusPill>
          <P
            size={4}
            color="$textSecondary"
          >
            {t('legend.auto')}
          </P>
        </XStack>
      </YStack>
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
