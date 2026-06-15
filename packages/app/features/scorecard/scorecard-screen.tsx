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
  const [plantId, setPlantId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  useEffect(() => {
    if (!plantId && plants.length > 0) setPlantId(plants[0]!.id)
  }, [plants, plantId])

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
            <AppSelect options={plantOptions} value={plantId} onChange={setPlantId} placeholder={t('plant')} />
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
              value={sc.costPerUnit != null ? `$${sc.costPerUnit.toFixed(2)}` : t('costNa')}
              label={t('kpi.costPerUnit')}
              caption={t('kpi.costCaption')}
            />
            <KpiTile value={pct(sc.oee.oee)} label={t('kpi.oee')} caption={t('kpi.oeeCaption')} />
          </KpiTileRow>

          <XStack gap="$4" flexWrap="wrap">
            <YStack flexGrow={1} flexBasis={360} minWidth={300} gap="$3">
              <P size={3} weight="b">
                {t('oee.title')}
              </P>
              <MetricBars
                items={[
                  { label: t('oee.availability'), value: sc.oee.availability },
                  { label: t('oee.performance'), value: sc.oee.performance },
                  { label: t('oee.quality'), value: sc.oee.quality },
                ]}
              />
              <YStack
                marginTop="$2"
                borderWidth={1}
                borderColor="$borderColor"
                borderStyle="dashed"
                borderRadius="$4"
                padding="$3"
              >
                <P size={6} color="$textSecondary">
                  {t('baseline.title')} — {t('baseline.seam')}
                </P>
              </YStack>
            </YStack>

            <YStack flexGrow={1} flexBasis={360} minWidth={300} gap="$3">
              <P size={3} weight="b">
                {t('atRisk.title')}
              </P>
              <DataTable<AtRiskOrderDto & { id: string }>
                rows={sc.atRisk.map((a) => ({ ...a, id: a.demandLineId }))}
                emptyTitle={t('atRisk.empty')}
                columns={[
                  { key: 'label', label: t('atRisk.title'), flex: 2 },
                  { key: 'reason', label: 'reason', flex: 2 },
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
