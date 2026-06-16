'use client'

import { useEffect, useState } from 'react'
import type { AtRiskOrderDto } from '@perduraflow/contracts'
import {
  ContextSelectors,
  DataTable,
  KpiTile,
  KpiTileRow,
  MetricBars,
  P,
  PageHeader,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useScheduleResources, useScheduleVersions } from '../../hooks/useScheduling'
import { useScorecard } from '../../hooks/useLearning'
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

  const { data: sc } = useScorecard(
    plantId ?? undefined,
    versionId ?? undefined,
    resourceId ?? undefined
  )
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

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ContextSelectors
        selectors={[
          {
            label: t('plant'),
            value: plantId,
            options: plantOptions,
            onChange: setPlant,
            width: 240,
          },
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
        <XStack gap="$2" flexWrap="wrap" alignItems="center">
          <P size={5} color="$textSecondary">
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
        <P size={3} color="$textSecondary">
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
              caption={moneyCaption(
                sc.costPerUnit,
                prev?.costPerUnit,
                sc.costPerUnit != null ? t('kpi.costCaption') : t('noActuals')
              )}
              trend={
                prev && sc.costPerUnit != null && prev.costPerUnit != null
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
          </KpiTileRow>

          <XStack gap="$4" flexWrap="wrap">
            {/* OEE breakdown — in a card (4b); per-line when drilled */}
            <YStack
              flexGrow={1}
              flexBasis={360}
              minWidth={300}
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$borderColor"
              borderRadius="$5"
              overflow="hidden"
            >
              <YStack padding="$3" borderBottomWidth={1} borderBottomColor="$borderColor">
                <P size={5} weight="b" color="$textSecondary">
                  {t('oee.title').toUpperCase()}
                </P>
              </YStack>
              <YStack padding="$4" gap="$3">
                {sc.oee != null ? (
                  <MetricBars
                    items={[
                      { label: t('oee.availability'), value: sc.oee.availability },
                      { label: t('oee.performance'), value: sc.oee.performance },
                      { label: t('oee.quality'), value: sc.oee.quality },
                    ]}
                  />
                ) : (
                  <P size={4} color="$textSecondary">
                    {t('oee.empty')}
                  </P>
                )}
                {/* Phase-5 seam — manual-baseline comparison; named, never faked. */}
                <YStack
                  marginTop="$1"
                  borderWidth={1}
                  borderColor="$borderColor"
                  borderStyle="dashed"
                  borderRadius="$4"
                  padding="$3"
                >
                  <P size={4} color="$textSecondary">
                    {t('baseline.title')} — {t('baseline.seam')}
                  </P>
                </YStack>
              </YStack>
            </YStack>

            {/* At-risk orders — order + computed detail + reason badge (4d); click → drill to that line */}
            <YStack
              flexGrow={1}
              flexBasis={360}
              minWidth={300}
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$borderColor"
              borderRadius="$5"
              overflow="hidden"
            >
              <YStack padding="$3" borderBottomWidth={1} borderBottomColor="$borderColor">
                <P size={5} weight="b" color="$textSecondary">
                  {t('atRisk.title').toUpperCase()}
                </P>
              </YStack>
              <YStack padding="$2">
                <DataTable<AtRiskOrderDto & { id: string }>
                  rows={sc.atRisk.map((a) => ({ ...a, id: a.demandLineId }))}
                  emptyTitle={t('atRisk.empty')}
                  stackOnSmall
                  onRowPress={(a) => setResourceId(a.resourceId)}
                  columns={[
                    {
                      key: 'label',
                      label: t('atRisk.orderCol'),
                      flex: 2,
                      render: (a) => (
                        <YStack>
                          <P size={3} color="$textPrimary">
                            {a.label}
                          </P>
                          <P size={4} color="$textSecondary">
                            {a.detail}
                          </P>
                        </YStack>
                      ),
                    },
                    {
                      key: 'reason',
                      label: t('atRisk.reasonCol'),
                      render: (a) => (
                        <XStack
                          alignSelf="flex-start"
                          backgroundColor="$dangerSoft"
                          borderRadius="$2"
                          paddingHorizontal="$2"
                          paddingVertical="$0.5"
                        >
                          <P size={5} weight="b" color="$danger">
                            {a.reason}
                          </P>
                        </XStack>
                      ),
                    },
                  ]}
                />
              </YStack>
            </YStack>
          </XStack>
        </>
      )}
    </>
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
      <P size={4} weight={active ? 'b' : 'r'} color={active ? '$primary' : '$textSecondary'}>
        {label}
      </P>
    </XStack>
  )
}

/** Web Scorecard screen — body inside the desktop `AdminShell` chrome. */
export function ScorecardScreen() {
  const { t } = useTranslation('scorecard')
  return (
    <AdminShell activeId="scorecard" title={t('title')}>
      <ScorecardContent />
    </AdminShell>
  )
}
