'use client'

import { useEffect, useState } from 'react'
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
import { useMaterialAvailability, useScheduleDemand, useScheduleResources, useScheduleVersions, useSetMaterialAvailability, useUpdateDemandQty } from '../../../hooks/useScheduling'
import { useResourceMutations } from '../../../hooks/useMasterData'
import { useSimulateActuals } from '../../../hooks/useLearning'
import { queryClient } from '../../../lib/query-client'
import { QUERY_KEYS } from '../../../lib/query-keys'
import { AdminShell } from '../../shell/admin-shell'

type Scenario = 'wear' | 'demand' | 'lineDown' | 'material'

const MS_PER_DAY = 86_400_000
/** Build an ISO datetime for `HH:MM` on today's UTC day (the schedule day). */
const todayAt = (hhmm: string): string => {
  const [h, m] = hhmm.split(':')
  const day = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
  return new Date(day + (Number(h) || 0) * 3_600_000 + (Number(m) || 0) * 60_000).toISOString()
}
const hhmmOf = (iso: string): string => new Date(iso).toISOString().slice(11, 16)

/**
 * **Demo/dev-only scenario launcher** (SKIP-51). NOT in the operational/admin nav —
 * staging scaffolding reachable by URL. It **sets a condition in the data** (it does
 * not re-solve): a tool-wear drift (emits seeded actuals into the closed loop), a
 * demand change (new order qty), or a line down (resource offline). The **Board**
 * then detects the condition, lets a planner review the costed options, and applies
 * one (the real Apply→draft→commit guardrail lives on the board, not here).
 */
export function SimulatorContent() {
  const { t } = useTranslation('scheduling')
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)

  const { data: versions = [] } = useScheduleVersions(plantId ?? undefined)
  const { data: resources = [] } = useScheduleResources(plantId ?? undefined)
  const { data: demand = [] } = useScheduleDemand(plantId ?? undefined)
  const committed = versions.filter((v) => v.status === 'committed')

  const [scenario, setScenario] = useState<Scenario>('wear')
  // Tool-wear (inject) controls
  const [versionId, setVersionId] = useState<string | null>(null)
  const [cycles, setCycles] = useState('14')
  const [driftOn, setDriftOn] = useState(false)
  const [driftResource, setDriftResource] = useState<string | null>(null)
  const [magnitude, setMagnitude] = useState('0.08')
  // Demand-change controls
  const [orderId, setOrderId] = useState<string | null>(null)
  const [newQty, setNewQty] = useState('200')
  // Line-down controls
  const [downLine, setDownLine] = useState<string | null>(null)
  // Material-arrival controls
  const { data: materials = [] } = useMaterialAvailability(plantId ?? undefined)
  const [matComponent, setMatComponent] = useState<string | null>(null)
  const [matTime, setMatTime] = useState('16:00')

  const simulate = useSimulateActuals()
  const updateDemandQty = useUpdateDemandQty()
  const setMaterial = useSetMaterialAvailability(plantId ?? undefined)
  const { update: updateResource } = useResourceMutations()
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)

  useEffect(() => {
    setApplied(null)
  }, [scenario, plantId])
  // Prefill the new-qty with the selected order's current quantity.
  useEffect(() => {
    const o = demand.find((d) => d.demandLineId === orderId)
    if (o) setNewQty(String(o.requiredQty))
  }, [orderId, demand])
  // Default the component to the first available; prefill the time with its current arrival.
  useEffect(() => {
    if (!matComponent && materials.length > 0) setMatComponent(materials[0]!.componentPartId)
  }, [materials, matComponent])
  useEffect(() => {
    const m = materials.find((x) => x.componentPartId === matComponent)
    if (m) setMatTime(hhmmOf(m.availableAt))
  }, [matComponent, materials])

  const versionOptions = committed.map((v) => ({ value: v.id, label: `committed · ${new Date(v.createdAt).toLocaleString()}` }))
  const resourceOptions = resources.map((r) => ({ value: r.id, label: r.name }))
  const orderOptions = demand.map((d) => ({ value: d.demandLineId, label: `${d.demandLineId} · qty ${d.requiredQty}` }))
  const materialOptions = materials.map((m) => ({ value: m.componentPartId, label: `${m.componentPartNo} · now ${hhmmOf(m.availableAt)}` }))
  const scenarioOptions: { value: Scenario; label: string }[] = [
    { value: 'wear', label: t('simulator.scenarioWear') },
    { value: 'demand', label: t('simulator.scenarioDemand') },
    { value: 'lineDown', label: t('simulator.scenarioLineDown') },
    { value: 'material', label: t('simulator.scenarioMaterial') },
  ]

  const runWear = () => {
    if (!versionId) return
    simulate.mutate({
      scheduleVersionId: versionId,
      cyclesPerOp: Math.max(1, Number(cycles) || 12),
      ...(driftOn && driftResource
        ? { drift: { resourceId: driftResource, param: 'cycle' as const, magnitude: Number(magnitude) || 0.08, rampOverEvents: 6 } }
        : {}),
    })
  }

  // --- Set condition: mutate the underlying data ONLY (no solve/commit). The board
  // detects the condition and is where it's reviewed + applied.
  const setDemandCondition = async () => {
    if (!orderId) return
    setApplying(true)
    setApplied(null)
    try {
      await updateDemandQty.mutateAsync({ demandLineId: orderId, requiredQty: Math.max(1, Number(newQty) || 1) })
      setApplied(t('simulator.conditionDemand'))
    } finally {
      setApplying(false)
    }
  }
  const setLineCondition = async (status: 'inactive' | 'active') => {
    if (!downLine || !plantId) return
    setApplying(true)
    setApplied(null)
    try {
      await updateResource.mutateAsync({ id: downLine, body: { status } })
      // The board reads resources via the scheduling query (a different key than the
      // master-data mutation invalidates) — invalidate it so the board reflects the
      // condition without a manual refresh.
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.resources(plantId) })
      setApplied(status === 'inactive' ? t('simulator.conditionDown') : t('simulator.conditionUp'))
    } finally {
      setApplying(false)
    }
  }
  const setMaterialCondition = async (hhmm: string, reset = false) => {
    if (!matComponent) return
    setApplying(true)
    setApplied(null)
    try {
      await setMaterial.mutateAsync({ componentPartId: matComponent, availableAt: todayAt(hhmm) })
      setApplied(reset ? t('simulator.conditionMaterialReset') : t('simulator.conditionMaterial'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <PageHeader title={t('simulator.title')} subtitle={t('simulator.subtitle')} />
      <YStack gap="$4" maxWidth={560}>
        <FormField label={t('board.plant')}>
          <AppSelect options={plants.map((p) => ({ value: p.id, label: p.name }))} value={plantId} onChange={setPlant} placeholder={t('board.plant')} />
        </FormField>
        <FormField label={t('simulator.scenario')}>
          <AppSelect options={scenarioOptions} value={scenario} onChange={(v) => setScenario(v as Scenario)} placeholder={t('simulator.scenario')} />
        </FormField>

        {scenario === 'wear' ? (
          <>
            <P size={4} color="$textSecondary">
              {t('simulator.wearHint')}
            </P>
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
              <P size={4} color="$textSecondary">
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
              <AppButton variant="primary" size="$3" loading={simulate.isPending} onPress={runWear}>
                {t('simulator.run')}
              </AppButton>
            </XStack>
            {simulate.data ? (
              <P size={4} color="$success">
                {t('simulator.emitted', { count: simulate.data.emitted })}
              </P>
            ) : null}
          </>
        ) : null}

        {scenario === 'demand' ? (
          <>
            <P size={4} color="$textSecondary">
              {t('simulator.conditionHint')}
            </P>
            <FormField label={t('simulator.order')}>
              <AppSelect options={orderOptions} value={orderId} onChange={setOrderId} placeholder={t('simulator.needOrder')} />
            </FormField>
            <FormField label={t('simulator.newQty')}>
              <AppInput value={newQty} onChangeText={setNewQty} keyboardType="numeric" />
            </FormField>
            <XStack>
              <AppButton variant="primary" size="$3" loading={applying} onPress={setDemandCondition}>
                {t('simulator.setCondition')}
              </AppButton>
            </XStack>
          </>
        ) : null}

        {scenario === 'lineDown' ? (
          <>
            <P size={4} color="$textSecondary">
              {t('simulator.conditionHint')}
            </P>
            <FormField label={t('simulator.line')}>
              <AppSelect options={resourceOptions} value={downLine} onChange={setDownLine} placeholder={t('simulator.needLine')} />
            </FormField>
            <XStack gap="$2" flexWrap="wrap">
              <AppButton variant="primary" size="$3" loading={applying} onPress={() => setLineCondition('inactive')}>
                {t('simulator.setCondition')}
              </AppButton>
              <AppButton variant="ghost" size="$3" loading={applying} onPress={() => setLineCondition('active')}>
                {t('simulator.bringBackUp')}
              </AppButton>
            </XStack>
          </>
        ) : null}

        {scenario === 'material' ? (
          <>
            <P size={4} color="$textSecondary">
              {t('simulator.conditionHint')}
            </P>
            <FormField label={t('simulator.component')}>
              <AppSelect options={materialOptions} value={matComponent} onChange={setMatComponent} placeholder={t('simulator.needComponent')} />
            </FormField>
            <FormField label={t('simulator.arrivalTime')}>
              <AppInput value={matTime} onChangeText={setMatTime} placeholder="HH:MM" />
            </FormField>
            <XStack gap="$2" flexWrap="wrap">
              <AppButton variant="primary" size="$3" loading={applying} onPress={() => setMaterialCondition(matTime)}>
                {t('simulator.setCondition')}
              </AppButton>
              <AppButton variant="ghost" size="$3" loading={applying} onPress={() => setMaterialCondition('06:00', true)}>
                {t('simulator.materialOnHand')}
              </AppButton>
            </XStack>
          </>
        ) : null}

        {applied ? (
          <YStack gap="$1" backgroundColor="$successSoft" borderRadius="$4" padding="$3">
            <P size={3} weight="m" color="$success">
              {applied}
            </P>
            <P size={4} color="$textSecondary">
              {t('simulator.goToBoard')}
            </P>
          </YStack>
        ) : null}
      </YStack>
    </>
  )
}

/** Web dev scenario-launcher screen. */
export function SimulatorScreen() {
  const { t } = useTranslation('scheduling')
  return (
    <AdminShell activeId="dev-simulator" title={t('simulator.title')}>
      <SimulatorContent />
    </AdminShell>
  )
}
