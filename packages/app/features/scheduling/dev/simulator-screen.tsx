'use client'

import { useState } from 'react'
import {
  AppButton,
  AppInput,
  AppSelect,
  FormField,
  P,
  PageHeader,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../../i18n'
import { usePlants } from '../../../hooks/useOrg'
import { usePlantSelection } from '../../../hooks/usePlantSelection'
import { useScheduleResources, useScheduleVersions } from '../../../hooks/useScheduling'
import { useSimulateActuals } from '../../../hooks/useLearning'
import { AdminShell } from '../../shell/admin-shell'

/**
 * **Demo/dev-only** execution-actuals simulator + drift trigger (SKIP-51). NOT in
 * the operational/admin nav — staging scaffolding for the closed-loop demo. Emits
 * seeded 4.3 actuals (optionally with a tool-wear drift) into the EventBus; the
 * learning module consumes them. The loop it drives is the real mechanism.
 */
export function SimulatorContent() {
  const { t } = useTranslation('scheduling')
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)

  const { data: versions = [] } = useScheduleVersions(plantId ?? undefined)
  const { data: resources = [] } = useScheduleResources(plantId ?? undefined)
  const committed = versions.filter((v) => v.status === 'committed')
  const [versionId, setVersionId] = useState<string | null>(null)
  const [cycles, setCycles] = useState('14')
  const [driftOn, setDriftOn] = useState(false)
  const [driftResource, setDriftResource] = useState<string | null>(null)
  const [magnitude, setMagnitude] = useState('0.08')
  const simulate = useSimulateActuals()

  const versionOptions = committed.map((v) => ({ value: v.id, label: `committed · ${new Date(v.createdAt).toLocaleString()}` }))
  const resourceOptions = resources.map((r) => ({ value: r.id, label: r.name }))

  const run = () => {
    if (!versionId) return
    simulate.mutate({
      scheduleVersionId: versionId,
      cyclesPerOp: Math.max(1, Number(cycles) || 12),
      ...(driftOn && driftResource
        ? { drift: { resourceId: driftResource, param: 'cycle' as const, magnitude: Number(magnitude) || 0.08, rampOverEvents: 6 } }
        : {}),
    })
  }

  return (
    <>
      <PageHeader title={t('simulator.title')} subtitle={t('simulator.subtitle')} />
      <YStack gap="$4" maxWidth={520}>
        <FormField label={t('board.plant')}>
          <AppSelect options={plants.map((p) => ({ value: p.id, label: p.name }))} value={plantId} onChange={setPlant} placeholder={t('board.plant')} />
        </FormField>
        <FormField label={t('simulator.version')}>
          <AppSelect options={versionOptions} value={versionId} onChange={setVersionId} placeholder={t('simulator.needCommitted')} />
        </FormField>
        <FormField label={t('simulator.cycles')}>
          <AppInput value={cycles} onChangeText={setCycles} keyboardType="numeric" />
        </FormField>

        <XStack alignItems="center" gap="$3">
          <AppButton variant={driftOn ? 'primary' : 'light'} size="$3" onPress={() => setDriftOn((d) => !d)}>
            {t('simulator.drift')}
          </AppButton>
          <P size={6} color="$textSecondary">
            {driftOn ? '' : 'off'}
          </P>
        </XStack>
        {driftOn ? (
          <>
            <FormField label={t('simulator.driftResource')}>
              <AppSelect options={resourceOptions} value={driftResource} onChange={setDriftResource} placeholder={t('simulator.driftResource')} />
            </FormField>
            <FormField label={t('simulator.magnitude')}>
              <AppInput value={magnitude} onChangeText={setMagnitude} keyboardType="numeric" />
            </FormField>
          </>
        ) : null}

        <XStack>
          <AppButton variant="primary" size="$3" loading={simulate.isPending} onPress={run}>
            {t('simulator.run')}
          </AppButton>
        </XStack>
        {simulate.data ? (
          <P size={5} color="$success">
            {t('simulator.emitted', { count: simulate.data.emitted })}
          </P>
        ) : null}
      </YStack>
    </>
  )
}

/** Web dev simulator screen. */
export function SimulatorScreen() {
  return (
    <AdminShell activeId="dev-simulator">
      <SimulatorContent />
    </AdminShell>
  )
}
