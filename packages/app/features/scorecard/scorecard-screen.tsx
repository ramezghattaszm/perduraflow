'use client'

import { useEffect, useState } from 'react'
import type { AtRiskOrderDto } from '@perduraflow/contracts'
import {
  DataTable,
  FormField,
  KpiTile,
  KpiTileRow,
  MetricBars,
  P,
  PageHeader,
  AppSelect,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import { useScheduleVersions } from '../../hooks/useScheduling'
import { useScorecard } from '../../hooks/useLearning'
import { AdminShell } from '../shell/admin-shell'

const pct = (x: number) => `${Math.round(x * 100)}%`

/**
 * View 2 · Service–Cost Scorecard (plant manager). Per-version metrics (its own
 * actuals): OTIF, Tier-B cost/unit, OEE A·P·Q, at-risk orders — all computed from
 * seeded rows through the real endpoint (no literals). The baseline-comparison arm
 * is a named Phase-5 seam (not faked). Shell-agnostic body in {@link ScorecardContent}.
 */
export function ScorecardContent() {
  const { t } = useTranslation(['scorecard', 'scheduling'])
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)
  const [versionId, setVersionId] = useState<string | null>(null)

  const { data: versions = [] } = useScheduleVersions(plantId ?? undefined)
  useEffect(() => {
    if (versions.length === 0) {
      setVersionId(null)
      return
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      setVersionId((versions.find((v) => v.status === 'committed') ?? versions[0]!).id)
    }
  }, [versions, versionId])

  const { data: sc } = useScorecard(plantId ?? undefined, versionId ?? undefined)
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const versionOptions = versions.map((v) => ({
    value: v.id,
    label: `${t(`scheduling:status.${v.status}`)} · ${new Date(v.createdAt).toLocaleString()}`,
  }))

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <XStack gap="$4" flexWrap="wrap">
        <YStack width={240}>
          <FormField label={t('plant')}>
            <AppSelect options={plantOptions} value={plantId} onChange={setPlant} placeholder={t('plant')} />
          </FormField>
        </YStack>
        <YStack width={360}>
          <FormField label={t('version')}>
            <AppSelect options={versionOptions} value={versionId} onChange={setVersionId} placeholder={t('version')} />
          </FormField>
        </YStack>
      </XStack>

      {!sc || sc.scheduleVersionId === null ? (
        <P size={4} color="$textSecondary">
          {t('empty')}
        </P>
      ) : (
        <>
          <KpiTileRow>
            <KpiTile value={pct(sc.otif)} label={t('kpi.otif')} caption={t('kpi.otifCaption')} />
            <KpiTile
              value={sc.costPerUnit != null ? `$${sc.costPerUnit.toFixed(2)}` : '—'}
              label={t('kpi.costPerUnit')}
              caption={sc.costPerUnit != null ? t('kpi.costCaption') : t('noActuals')}
            />
            <KpiTile
              value={sc.oee != null ? pct(sc.oee.oee) : '—'}
              label={t('kpi.oee')}
              caption={sc.oee != null ? t('kpi.oeeCaption') : t('noActuals')}
            />
          </KpiTileRow>

          <XStack gap="$4" flexWrap="wrap">
            {/* OEE breakdown — in a card to match the other sections (4b) */}
            <YStack flexGrow={1} flexBasis={360} minWidth={300} backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" overflow="hidden">
              <YStack padding="$3" borderBottomWidth={1} borderBottomColor="$borderColor">
                <P size={8} weight="b" color="$textSecondary">
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
                  <P size={5} color="$textSecondary">
                    {t('oee.empty')}
                  </P>
                )}
                {/* Phase-5 seam — manual-baseline comparison; named, never faked. */}
                <YStack marginTop="$1" borderWidth={1} borderColor="$borderColor" borderStyle="dashed" borderRadius="$4" padding="$3">
                  <P size={6} color="$textSecondary">
                    {t('baseline.title')} — {t('baseline.seam')}
                  </P>
                </YStack>
              </YStack>
            </YStack>

            {/* At-risk orders — order + computed detail sub-line + reason badge (4d) */}
            <YStack flexGrow={1} flexBasis={360} minWidth={300} backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" overflow="hidden">
              <YStack padding="$3" borderBottomWidth={1} borderBottomColor="$borderColor">
                <P size={8} weight="b" color="$textSecondary">
                  {t('atRisk.title').toUpperCase()}
                </P>
              </YStack>
              <DataTable<AtRiskOrderDto & { id: string }>
                rows={sc.atRisk.map((a) => ({ ...a, id: a.demandLineId }))}
                emptyTitle={t('atRisk.empty')}
                columns={[
                  {
                    key: 'label',
                    label: t('atRisk.orderCol'),
                    flex: 2,
                    render: (a) => (
                      <YStack>
                        <P size={4} color="$textPrimary">
                          {a.label}
                        </P>
                        <P size={6} color="$textSecondary">
                          {a.detail}
                        </P>
                      </YStack>
                    ),
                  },
                  {
                    key: 'reason',
                    label: t('atRisk.reasonCol'),
                    render: (a) => (
                      <XStack alignSelf="flex-start" backgroundColor="$dangerSoft" borderRadius="$2" paddingHorizontal="$2" paddingVertical="$0.5">
                        <P size={7} weight="b" color="$danger">
                          {a.reason}
                        </P>
                      </XStack>
                    ),
                  },
                ]}
              />
            </YStack>
          </XStack>
        </>
      )}
    </>
  )
}

/** Web Scorecard screen — body inside the desktop `AdminShell` chrome. */
export function ScorecardScreen() {
  return (
    <AdminShell activeId="scorecard">
      <ScorecardContent />
    </AdminShell>
  )
}
