'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'solito/navigation'
import type { BaselineSource, CostedKpis } from '@perduraflow/contracts'
import {
  AppSelect,
  BaselineDeltaStrip,
  ContextSelectors,
  KpiTile,
  KpiTileRow,
  MetricBars,
  P,
  PageHeader,
  Panel,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { resolveKey, useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useScheduleResources, useScheduleVersions } from '../../hooks/useScheduling'
import { useScorecard } from '../../hooks/useLearning'
import { useBaseline } from '../../hooks/useWhatIf'
import { useSetScreenContext } from '../../stores/screenContext.store'
import { AdminShell } from '../shell/admin-shell'

const pct = (x: number) => `${Math.round(x * 100)}%`
type Trend = 'up' | 'down' | undefined
const trendOf = (cur: number, prev: number): Trend =>
  Math.abs(cur - prev) < 1e-9 ? undefined : cur > prev ? 'up' : 'down'

/**
 * View 2 · Service–Cost Scorecard (plant manager). Per-version, **drill-downable**
 * to one line (resourceId); KPI ↑/↓ are **version-over-version** vs the prior
 * committed version (never the manual baseline — Phase-5 stub). When a previous
 * metric is null (no actuals), the delta reads "—", never a delta-from-null. All
 * computed from rows. Shell-agnostic body in {@link ScorecardContent}.
 */
export function ScorecardContent() {
  const { t } = useTranslation(['scorecard', 'scheduling'])
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [resourceId, setResourceId] = useState<string | null>(null) // null = plant-level
  // Baseline arm lifted here (from BaselinePanel) so it's part of the screen-context referent.
  const [source, setSource] = useState<BaselineSource>('frozen_engine_snapshot')

  const { data: versions = [] } = useScheduleVersions(plantId ?? undefined)
  const { data: resources = [] } = useScheduleResources(plantId ?? undefined)
  useEffect(() => {
    if (versions.length === 0) {
      setVersionId(null)
      return
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      setVersionId((versions.find((v) => v.status === 'committed') ?? versions[0]!).id)
    }
  }, [versions, versionId])
  // Reset the line scope when the plant changes (a line belongs to one plant).
  useEffect(() => setResourceId(null), [plantId])

  // Pass C (publish-only): the scorecard's deictic referent — "this lift / comparison" = the
  // active baseline arm + the scope (a line, or the whole plant). Published for the Copilot to
  // resolve "this"; acting on it awaits a baseline-retrieve tool (content-grounding, deferred), so
  // the Copilot resolves the referent but is honest it can't pull baseline figures yet.
  const setScreenContext = useSetScreenContext()
  useEffect(() => {
    setScreenContext({
      screen: 'scorecard',
      versionId: versionId ?? undefined,
      selectedResourceId: resourceId ?? undefined,
      view: source,
    })
    return () => setScreenContext(null)
  }, [setScreenContext, versionId, resourceId, source])

  const { data: sc } = useScorecard(
    plantId ?? undefined,
    versionId ?? undefined,
    resourceId ?? undefined
  )
  const router = useRouter()
  // Baseline comparison lifted here too (same query key as the panel below → deduped) so the cost
  // tile can show the delta vs baseline — a context-free $/unit is weak; "▲$0.03 vs baseline" is not.
  const { data: comparison } = useBaseline(plantId ?? undefined, source, resourceId ?? undefined)
  const baseCost =
    comparison && !comparison.emptyState ? (comparison.baseline?.costPerUnit ?? null) : null
  const liveCost = comparison && !comparison.emptyState ? (comparison.live?.costPerUnit ?? null) : null
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const versionOptions = versions.map((v) => ({
    value: v.id,
    label: `${t(`scheduling:status.${v.status}`)} · ${new Date(v.createdAt).toLocaleString()}`,
  }))
  const prev = sc?.previous ?? null
  // Delta caption: base when no prior version; "—" when the prior metric is null (no
  // actuals — never a delta-from-null); else "±Δ vs prev".
  const ppCaption = (cur: number | null | undefined, p: number | null | undefined, base: string) =>
    !prev
      ? base
      : cur == null || p == null
        ? '—'
        : `${cur - p >= 0 ? '+' : ''}${Math.round((cur - p) * 100)}pp ${t('vsPrev')}`
  const moneyCaption = (
    cur: number | null | undefined,
    p: number | null | undefined,
    base: string
  ) =>
    !prev
      ? base
      : cur == null || p == null
        ? '—'
        : `${cur - p >= 0 ? '+' : ''}$${(cur - p).toFixed(2)} ${t('vsPrev')}`
  // Cost tile caption: prefer the delta vs the selected baseline arm (meaningful context); fall back
  // to the version-over-version delta (or the no-actuals note) when no baseline is available.
  const costCaption =
    baseCost != null && liveCost != null
      ? `${liveCost - baseCost >= 0 ? '▲' : '▼'}$${Math.abs(liveCost - baseCost).toFixed(2)} ${t('vsBaseline')}`
      : moneyCaption(
          sc?.costPerUnit,
          prev?.costPerUnit,
          sc?.costPerUnit != null ? t('kpi.costCaption') : t('noActuals')
        )

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
      <ContextSelectors
        selectors={[
          {
            label: t('version'),
            value: versionId,
            options: versionOptions,
            onChange: setVersionId,
            width: 360,
          },
        ]}
      />

      {/* Drill-down scope: Plant (default) or a single line; chips + clickable at-risk rows */}
      {resources.length > 0 ? (
        <XStack
          gap="$2"
          flexWrap="wrap"
          alignItems="center"
        >
          <P
            size={5}
            weight="b"
            caps
            color="$textTertiary"
          >
            {t('scope.label')}
          </P>
          <ScopeChip
            active={!resourceId}
            label={t('scope.plant')}
            onPress={() => setResourceId(null)}
          />
          {resources.map((r) => (
            <ScopeChip
              key={r.id}
              active={resourceId === r.id}
              label={r.name}
              onPress={() => setResourceId(r.id)}
            />
          ))}
        </XStack>
      ) : null}

      {!sc || sc.scheduleVersionId === null ? (
        <P
          size={3}
          color="$textSecondary"
        >
          {t('empty')}
        </P>
      ) : (
        <>
          <KpiTileRow>
            <KpiTile
              value={pct(sc.otif)}
              label={t('kpi.otif')}
              caption={ppCaption(sc.otif, prev?.otif, t('kpi.otifCaption'))}
              trend={prev && prev.otif != null ? trendOf(sc.otif, prev.otif) : undefined}
            />
            <KpiTile
              value={sc.costPerUnit != null ? `$${sc.costPerUnit.toFixed(2)}` : '—'}
              label={t('kpi.costPerUnit')}
              caption={costCaption}
              trend={
                baseCost != null && liveCost != null
                  ? trendOf(liveCost, baseCost)
                  : prev && sc.costPerUnit != null && prev.costPerUnit != null
                    ? trendOf(sc.costPerUnit, prev.costPerUnit)
                    : undefined
              }
              upIsGood={false}
            />
            <KpiTile
              value={sc.oee != null ? pct(sc.oee.oee) : '—'}
              label={t('kpi.oee')}
              caption={ppCaption(
                sc.oee?.oee,
                prev?.oee?.oee,
                sc.oee != null ? t('kpi.oeeCaption') : t('noActuals')
              )}
              trend={
                prev && sc.oee != null && prev.oee != null
                  ? trendOf(sc.oee.oee, prev.oee.oee)
                  : undefined
              }
            />
            {/* Schedule Adherence — execution discipline (ops started within tolerance of planned start).
                A distinct axis from OTIF (delivery outcome): a plan can be followed yet still miss due
                dates, or be reshuffled yet deliver. Throughput-attainment dropped from the scorecard tiles
                (redundant with OTIF/OEE); the continuous throughput number stays on the cockpit KPI strip. */}
            <KpiTile
              value={sc.scheduleAdherence != null ? pct(sc.scheduleAdherence) : '—'}
              label={t('kpi.adherence')}
              caption={ppCaption(
                sc.scheduleAdherence,
                prev?.scheduleAdherence,
                sc.scheduleAdherence != null ? t('kpi.adherenceCaption') : t('noActuals')
              )}
              trend={
                prev && sc.scheduleAdherence != null && prev.scheduleAdherence != null
                  ? trendOf(sc.scheduleAdherence, prev.scheduleAdherence)
                  : undefined
              }
            />
          </KpiTileRow>

          <XStack
            gap="$4"
            flexWrap="wrap"
          >
            {/* OEE breakdown panel (4b); per-line when drilled */}
            <Panel
              title={t('oee.title')}
              flexGrow={1}
              flexBasis={360}
              minWidth={300}
            >
              {sc.oee != null ? (
                <MetricBars
                  items={[
                    { label: t('oee.availability'), value: sc.oee.availability },
                    { label: t('oee.performance'), value: sc.oee.performance },
                    { label: t('oee.quality'), value: sc.oee.quality },
                  ]}
                />
              ) : (
                <P
                  size={4}
                  color="$textSecondary"
                >
                  {t('oee.empty')}
                </P>
              )}
            </Panel>

            {/* Service exposure — a glanceable COUNT, consistent with the KPI tiles. The per-order
                detail (which orders, why) lives in the work list / exception queue; tapping drills to
                the work list filtered to at-risk, so the detail is one tap away, not on the scorecard. */}
            <KpiTile
              value={String(sc.committedAtRisk)}
              label={t('atRisk.count')}
              caption={t('atRisk.countCaption')}
              valueTone={sc.committedAtRisk > 0 ? 'bad' : 'ok'}
              onPress={() => router.push('/scheduling/work-list?status=at_risk')}
            />
          </XStack>

          {/* Plan-comparison / baseline (D57) — both arms, honest empty-state. */}
          <Panel title={t('baseline:title', { defaultValue: 'Vs baseline' })}>
            <BaselinePanel
              plantId={plantId ?? undefined}
              resourceId={resourceId ?? undefined}
              source={source}
              onSourceChange={setSource}
            />
          </Panel>
        </>
      )}
    </>
  )
}

const fmtPct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const fmtMoney = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
function kpiDelta(
  live: number | null,
  base: number | null,
  kind: 'pct' | 'money' | 'count',
  lowerIsBetter: boolean
) {
  if (live == null || base == null) return { delta: '—', tone: 'neutral' as const }
  const d = live - base
  if (Math.abs(d) < 1e-9) return { delta: '0', tone: 'neutral' as const }
  const tone = (d < 0 ? lowerIsBetter : !lowerIsBetter) ? ('up' as const) : ('down' as const)
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  const txt =
    kind === 'pct'
      ? `${sign}${Math.round(mag * 100)}%`
      : kind === 'money'
        ? `${sign}$${mag.toFixed(2)}`
        : `${sign}${Math.round(mag)}`
  return { delta: txt, tone }
}
function baselineRows(live: CostedKpis, base: CostedKpis, t: (k: string) => string) {
  return (
    [
      {
        label: t('baseline:kpi.otif'),
        live: fmtPct(live.otif),
        baseline: fmtPct(base.otif),
        ...kpiDelta(live.otif, base.otif, 'pct', false),
      },
      {
        label: t('baseline:kpi.cost'),
        live: fmtMoney(live.costPerUnit),
        baseline: fmtMoney(base.costPerUnit),
        ...kpiDelta(live.costPerUnit, base.costPerUnit, 'money', true),
      },
      {
        label: t('baseline:kpi.oee'),
        live: fmtPct(live.oee?.oee ?? null),
        baseline: fmtPct(base.oee?.oee ?? null),
        ...kpiDelta(live.oee?.oee ?? null, base.oee?.oee ?? null, 'pct', false),
      },
      {
        label: t('baseline:kpi.late'),
        live: String(live.lateOrders),
        baseline: String(base.lateOrders),
        ...kpiDelta(live.lateOrders, base.lateOrders, 'count', true),
      },
    ]
      // Hide a KPI that isn't applicable to this arm (e.g. OEE — an execution metric —
      // for the plan-vs-plan engine-lift arm): a row that is "—" on BOTH sides.
      .filter((r) => !(r.live === '—' && r.baseline === '—'))
  )
}

/** Baseline comparison (D57) — frozen-engine / measured-historical arms + empty-state. Controlled
 *  arm (`source`/`onSourceChange`) so the screen can publish it as the deictic referent (Pass C). */
function BaselinePanel({
  plantId,
  resourceId,
  source,
  onSourceChange,
}: {
  plantId?: string
  resourceId?: string
  source: BaselineSource
  onSourceChange: (s: BaselineSource) => void
}) {
  const { t } = useTranslation(['baseline'])
  const { data } = useBaseline(plantId, source, resourceId)
  const arms = [
    {
      id: 'frozen_engine_snapshot',
      label: t('arm.frozen'),
      active: source === 'frozen_engine_snapshot',
      onPress: () => onSourceChange('frozen_engine_snapshot'),
    },
    {
      id: 'measured_historical',
      label: t('arm.historical'),
      active: source === 'measured_historical',
      onPress: () => onSourceChange('measured_historical'),
    },
  ]
  const empty = !data || data.emptyState || !data.live || !data.baseline
  return (
    <BaselineDeltaStrip
      arms={arms}
      liveHeader={t('live')}
      baselineHeader={t('baseline')}
      deltaHeader={t('delta')}
      empty={empty}
      emptyTitle={t('emptyState')}
      emptyHint={t('emptyHint')}
      caption={data ? resolveKey(data.labelKey) : ''}
      rows={!empty && data?.live && data?.baseline ? baselineRows(data.live, data.baseline, t) : []}
    />
  )
}

/** A scope chip (Plant / a line) for the Scorecard drill-down. */
function ScopeChip({
  active,
  label,
  onPress,
}: {
  active: boolean
  label: string
  onPress: () => void
}) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      backgroundColor={active ? '$primarySoft' : '$surface'}
      borderWidth={1}
      borderColor={active ? '$primary' : '$borderColor'}
      borderRadius="$10"
      paddingHorizontal="$3"
      paddingVertical="$1.5"
      hoverStyle={{ borderColor: '$primary' }}
      role="button"
      aria-label={label}
    >
      <P
        size={4}
        weight={active ? 'b' : 'r'}
        color={active ? '$primary' : '$textSecondary'}
      >
        {label}
      </P>
    </XStack>
  )
}

/** Web Scorecard screen — body inside the desktop `AdminShell` chrome. */
export function ScorecardScreen() {
  const { t } = useTranslation('scorecard')
  return (
    <AdminShell
      activeId="scorecard"
      title={t('title')}
    >
      <ScorecardContent />
    </AdminShell>
  )
}
