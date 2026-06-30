'use client'

import type { KpiStatusDto, KpiTileDto } from '@perduraflow/contracts'
import {
  AppSelect,
  EmptyState,
  KpiTile,
  type KpiTone,
  KpiTileRow,
  LineChart,
  P,
  PageHeader,
  Panel,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useKpiDashboard } from '../../hooks/useScheduling'
import { AdminShell } from '../shell/admin-shell'

const MS_PER_DAY = 86_400_000
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const shortDate = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ms))

/** Threshold status → KpiTile value tone (green = good, amber = watch, red = bad, none = neutral). */
const TONE: Record<KpiStatusDto, KpiTone> = { green: 'ok', amber: 'warn', red: 'bad', none: 'neutral' }

const ORDER = ['onTime', 'throughput', 'oee', 'scrap', 'adherence'] as const

/**
 * 902 · Performance dashboard (manager/exec). Plant-scoped KPI tiles — each a current value with a
 * cascade-resolved **threshold status** (green/amber/red) — plus per-KPI **trend charts** over the
 * reporting window. OEE is current-value-only (A·P·Q legs, no trend — the locked seeded snapshot).
 * Measure definitions (e.g. the On-Time tolerance) and threshold bands come from the KPI / Metric
 * Policy cascade, so the screen reflects whatever a tenant/plant has configured.
 */
export function DashboardScreen() {
  const { t } = useTranslation('admin')
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)
  const { data, isLoading } = useKpiDashboard(plantId ?? undefined)

  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const days = data ? Math.round((data.windowEndMs - data.windowStartMs) / MS_PER_DAY) : 0
  const tileByKey = new Map((data?.tiles ?? []).map((tile) => [tile.key, tile]))
  const tiles = ORDER.map((k) => tileByKey.get(k)).filter((x): x is KpiTileDto => x != null)
  const hasData = tiles.some((tile) => tile.value != null)

  return (
    <AdminShell activeId="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={data ? t('dashboard.window', { days }) : t('dashboard.subtitle')}
        actions={
          <YStack width={220}>
            <AppSelect options={plantOptions} value={plantId} onChange={setPlant} placeholder={t('dashboard.plant')} />
          </YStack>
        }
      />

      {!plantId ? (
        <EmptyState icon="📊" title={t('dashboard.selectPlant')} />
      ) : !data && isLoading ? (
        <YStack flex={1} minHeight={240} />
      ) : !hasData ? (
        <EmptyState icon="📊" title={t('dashboard.noData')} />
      ) : (
        <YStack gap="$4">
          {/* Headline tiles — current value + threshold-colored status */}
          <KpiTileRow>
            {tiles.map((tile) => (
              <KpiTile
                key={tile.key}
                value={pct(tile.value)}
                label={t(`dashboard.kpi.${tile.key}`)}
                caption={t(`dashboard.caption.${tile.key}`)}
                valueTone={TONE[tile.status]}
              />
            ))}
          </KpiTileRow>

          {/* Per-KPI cards: a trend chart for the actuals KPIs; OEE shows its A·P·Q legs (no trend) */}
          <XStack gap="$4" flexWrap="wrap">
            {tiles.map((tile) =>
              tile.key === 'oee' ? (
                <Panel key={tile.key} title={t('dashboard.kpi.oee')} flexBasis={320} flexGrow={1}>
                  <P size={5} color="$textTertiary">
                    {t('dashboard.noTrend')}
                  </P>
                  <YStack gap="$2" paddingTop="$2">
                    {tile.oee
                      ? (['availability', 'performance', 'quality'] as const).map((leg) => (
                          <XStack key={leg} justifyContent="space-between">
                            <P size={3} color="$textSecondary">
                              {t(`dashboard.oeeLeg.${leg}`)}
                            </P>
                            <P size={3} weight="b" color="$textPrimary">
                              {pct1(tile.oee![leg])}
                            </P>
                          </XStack>
                        ))
                      : null}
                  </YStack>
                </Panel>
              ) : (
                <Panel
                  key={tile.key}
                  title={t('dashboard.trendTitle', { kpi: t(`dashboard.kpi.${tile.key}`) })}
                  flexBasis={320}
                  flexGrow={1}
                >
                  <KpiTrend points={tile.trend} />
                </Panel>
              ),
            )}
          </XStack>
        </YStack>
      )}
    </AdminShell>
  )
}

/** A KPI trend line — drops null buckets (gaps) so the line connects executed periods only. */
function KpiTrend({ points }: { points: KpiTileDto['trend'] }) {
  const { t } = useTranslation('admin')
  const data = (points ?? []).filter((p): p is { x: number; y: number } => p.y != null)
  if (data.length < 2) {
    return (
      <YStack height={160} alignItems="center" justifyContent="center">
        <P size={4} color="$textTertiary">
          {t('dashboard.noData')}
        </P>
      </YStack>
    )
  }
  return <LineChart data={data} height={160} formatY={(v) => `${Math.round(v * 100)}%`} formatX={shortDate} dots={false} />
}
