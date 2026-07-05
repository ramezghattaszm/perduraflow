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
import {
  useMaterialAvailability,
  useResourceOperatorAssignments,
  useScheduleDemand,
  useScheduleResources,
  useScheduleVersions,
  useSetMaterialAvailability,
  useSetResourceOperatorAssignment,
  useUpdateDemandQty,
} from '../../../hooks/useScheduling'
import {
  useOperators,
  useOperatorMutations,
  useResourceDowntime,
  useResourceDowntimeMutations,
} from '../../../hooks/useMasterData'
import { useSimulateActuals } from '../../../hooks/useLearning'
import { queryClient } from '../../../lib/query-client'
import { QUERY_KEYS } from '../../../lib/query-keys'
import { broadcastConditionChange } from '../../../lib/cross-tab'
import { AdminShell } from '../../shell/admin-shell'

type Scenario = 'wear' | 'demand' | 'lineDown' | 'material' | 'operator'

const MS_PER_DAY = 86_400_000
/** Build an ISO datetime for `HH:MM` on today's UTC day (the schedule day). */
const todayAt = (hhmm: string): string => {
  const [h, m] = hhmm.split(':')
  const day = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
  return new Date(day + (Number(h) || 0) * 3_600_000 + (Number(m) || 0) * 60_000).toISOString()
}
const hhmmOf = (iso: string): string => new Date(iso).toISOString().slice(11, 16)
/** Seed shift ends (UTC): A 06:00–14:00, B 14:00–22:00. The current shift's end from now. */
const restOfShiftEnd = (): string => (new Date().getUTCHours() < 14 ? todayAt('14:00') : todayAt('22:00'))
/** ISO `to` = now + n hours (the OT-extend beat: a short outage). */
const inHours = (n: number): string => new Date(Date.now() + n * 3_600_000).toISOString()

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
  const [cycles, setCycles] = useState('4')
  const [driftOn, setDriftOn] = useState(false)
  const [driftResource, setDriftResource] = useState<string | null>(null)
  const [magnitude, setMagnitude] = useState('0.08')
  // Demand-change controls
  const [orderId, setOrderId] = useState<string | null>(null)
  const [newQty, setNewQty] = useState('200')
  // Line-down controls (duration-from-now → a resource_downtime window)
  const [downLine, setDownLine] = useState<string | null>(null)
  const [downReason, setDownReason] = useState('')
  const [downHours, setDownHours] = useState('4')
  // Material-arrival controls
  const { data: materials = [] } = useMaterialAvailability(plantId ?? undefined)
  const [matComponent, setMatComponent] = useState<string | null>(null)
  const [matTime, setMatTime] = useState('16:00')
  // Operator-performance controls
  const { data: allOperators = [] } = useOperators()
  const { data: assignments = [] } = useResourceOperatorAssignments(plantId ?? undefined)
  const [perfOperator, setPerfOperator] = useState<string | null>(null)
  const [perfPct, setPerfPct] = useState('100')
  const [pinLine, setPinLine] = useState<string | null>(null)

  const simulate = useSimulateActuals()
  const updateDemandQty = useUpdateDemandQty()
  const setMaterial = useSetMaterialAvailability(plantId ?? undefined)
  const { data: downtime = [] } = useResourceDowntime(plantId ?? undefined)
  const { open: openDowntime, close: closeDowntime } = useResourceDowntimeMutations(plantId ?? undefined)
  const { update: updateOperator } = useOperatorMutations()
  const setAssignment = useSetResourceOperatorAssignment(plantId ?? undefined)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)

  useEffect(() => {
    setApplied(null)
  }, [scenario, plantId])
  // Cross-tab: a condition set here only changes the data (no re-solve), so tell other tabs (the
  // Board) to refetch — the new condition then shows without a manual refresh. `applied` flips to a
  // value on every successful condition action; `simulate.data` on a wear emission.
  useEffect(() => {
    if (applied) broadcastConditionChange()
  }, [applied])
  useEffect(() => {
    if (simulate.data) broadcastConditionChange()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- broadcast on each new emission result
  }, [simulate.data])
  // Prefill the new-qty with the selected order's current quantity.
  useEffect(() => {
    const o = demand.find((d) => d.demandLineId === orderId)
    if (o) setNewQty(String(o.requiredQty))
  }, [orderId, demand])
  // Default the component to the first available; prefill the time with its current arrival.
  useEffect(() => {
    if (!matComponent && materials.length > 0) setMatComponent(materials[0]!.componentPartNo)
  }, [materials, matComponent])
  useEffect(() => {
    const m = materials.find((x) => x.componentPartNo === matComponent)
    if (m) setMatTime(hhmmOf(m.availableAt))
  }, [matComponent, materials])
  // Default the operator to the first at this plant; prefill the percent from its current factor.
  const plantOperators = allOperators.filter((o) => o.isActive && o.homePlantId === plantId)
  useEffect(() => {
    if (!perfOperator && plantOperators.length > 0) setPerfOperator(plantOperators[0]!.id)
  }, [plantOperators, perfOperator])
  useEffect(() => {
    const o = allOperators.find((x) => x.id === perfOperator)
    if (o) setPerfPct(String(Math.round(o.performanceFactor * 100)))
  }, [perfOperator, allOperators])

  const versionOptions = committed.map((v) => ({ value: v.id, label: `committed · ${new Date(v.createdAt).toLocaleString()}` }))
  const resourceOptions = resources.map((r) => ({ value: r.id, label: r.name }))
  const orderOptions = demand.map((d) => ({ value: d.demandLineId, label: `${d.demandLineId} · qty ${d.requiredQty}` }))
  const materialOptions = materials.map((m) => ({ value: m.componentPartNo, label: `${m.componentPartNo} · now ${hhmmOf(m.availableAt)}` }))
  const scenarioOptions: { value: Scenario; label: string }[] = [
    { value: 'wear', label: t('simulator.scenarioWear') },
    { value: 'demand', label: t('simulator.scenarioDemand') },
    { value: 'lineDown', label: t('simulator.scenarioLineDown') },
    { value: 'material', label: t('simulator.scenarioMaterial') },
    { value: 'operator', label: t('simulator.scenarioOperator') },
  ]
  const operatorOptions = plantOperators.map((o) => ({ value: o.id, label: `${o.name} · ${Math.round(o.performanceFactor * 100)}%` }))

  const runWear = () => {
    if (!versionId) return
    simulate.mutate({
      scheduleVersionId: versionId,
      cyclesPerOp: Math.max(1, Number(cycles) || 4),
      // Rolling window (matches demo:reset): only PAST ops execute → emit actuals; today/future ops stay
      // PLANNED. Without this the simulator emitted actuals for every op (future included), which (a) marked
      // future jobs "completed" — so the learned wear had nothing left to predict for — and (b) ballooned
      // the emit (321 ops × cycles) into a slow run. Past-only keeps future ops eligible to receive the
      // learned/predicted cycle on the next re-solve (the forward-risk story).
      completedBeforeMs: Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY,
      ...(driftOn && driftResource
        ? {
            // Scope the run to the drifted lane only — so drifting one line leaves every other lane's
            // history + prediction untouched (re-emitting the whole plant at standard would wipe them).
            onlyResourceId: driftResource,
            drift: { resourceId: driftResource, param: 'cycle' as const, magnitude: Number(magnitude) || 0.08, rampOverEvents: 6 },
          }
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
  // Open a line-down window [now, toIso) — a resource_downtime closure the engine subtracts from
  // capacity (ops displace, not excluded). Duration drives the beat: rest-of-today → reroute-tomorrow;
  // next-N-hours → OT-extend. The hooks invalidate the board's resource read, so DOWN shows at once.
  const setDownWindow = async (toIso: string) => {
    if (!downLine) return
    setApplying(true)
    setApplied(null)
    try {
      await openDowntime.mutateAsync({
        resourceId: downLine,
        kind: 'line_down',
        planned: false,
        from: new Date().toISOString(),
        to: toIso,
        reason: downReason.trim() || null,
      })
      setApplied(t('simulator.conditionDownWindow', { until: hhmmOf(toIso) }))
    } finally {
      setApplying(false)
    }
  }
  // Bring the line back up — end every active outage on the selected line now (truncate/retract).
  const bringBackUp = async () => {
    if (!downLine) return
    setApplying(true)
    setApplied(null)
    try {
      const active = downtime.filter((d) => d.resourceId === downLine && d.isActive)
      for (const d of active) await closeDowntime.mutateAsync(d.id)
      setApplied(t('simulator.conditionUp'))
    } finally {
      setApplying(false)
    }
  }
  // Set an operator's performance factor (the factor lives on the operator, master-data). A
  // re-solve on the board then reflects it on whichever line the operator is pinned to.
  const setPerformance = async () => {
    if (!perfOperator) return
    setApplying(true)
    setApplied(null)
    try {
      const factor = Math.max(0.1, (Number(perfPct) || 100) / 100)
      await updateOperator.mutateAsync({ id: perfOperator, body: { performanceFactor: factor } })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.operatorAssignments(plantId ?? '') })
      setApplied(t('simulator.conditionOperator'))
    } finally {
      setApplying(false)
    }
  }
  // Pin (swap) the operator running a line (the §4.8 assignment, scheduling-owned).
  const pinOperatorToLine = async () => {
    if (!pinLine || !perfOperator) return
    setApplying(true)
    setApplied(null)
    try {
      await setAssignment.mutateAsync({ resourceId: pinLine, operatorId: perfOperator })
      setApplied(t('simulator.conditionAssignment'))
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
              <AppSelect
                options={orderOptions}
                value={orderId}
                onChange={setOrderId}
                placeholder={t('simulator.needOrder')}
                searchable
                searchPlaceholder={t('simulator.searchOrders')}
                noMatchesText={t('simulator.noOrders')}
              />
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
            <FormField label={t('simulator.downReason')}>
              <AppInput value={downReason} onChangeText={setDownReason} placeholder={t('simulator.reasonPlaceholder')} />
            </FormField>
            <FormField label={t('simulator.downDuration')}>
              <XStack gap="$2" flexWrap="wrap" alignItems="center">
                <AppButton variant="primary" size="$3" loading={applying} onPress={() => setDownWindow(todayAt('22:00'))}>
                  {t('simulator.restOfToday')}
                </AppButton>
                <AppButton variant="light" size="$3" loading={applying} onPress={() => setDownWindow(restOfShiftEnd())}>
                  {t('simulator.restOfShift')}
                </AppButton>
                <AppButton
                  variant="light"
                  size="$3"
                  loading={applying}
                  onPress={() => setDownWindow(inHours(Math.max(1, Number(downHours) || 4)))}
                >
                  {t('simulator.nextHours', { n: Math.max(1, Number(downHours) || 4) })}
                </AppButton>
                <AppInput value={downHours} onChangeText={setDownHours} keyboardType="numeric" width={64} />
              </XStack>
            </FormField>
            {downLine ? (
              <YStack gap="$1" backgroundColor="$backgroundHover" borderRadius="$4" padding="$3">
                <P size={4} weight="m" color="$textSecondary">
                  {t('simulator.activeDowntime')}
                </P>
                {downtime.filter((d) => d.resourceId === downLine && d.isActive).length === 0 ? (
                  <P size={4} color="$textSecondary">
                    {t('simulator.noActiveDowntime')}
                  </P>
                ) : (
                  downtime
                    .filter((d) => d.resourceId === downLine && d.isActive)
                    .map((d) => (
                      <P key={d.id} size={4} color="$textSecondary">
                        {t('simulator.downWindowRow', { from: hhmmOf(d.from), to: hhmmOf(d.to) })}
                        {d.reason ? ` · ${d.reason}` : ''}
                      </P>
                    ))
                )}
              </YStack>
            ) : null}
            <XStack>
              <AppButton variant="ghost" size="$3" loading={applying} onPress={bringBackUp}>
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

        {scenario === 'operator' ? (
          <>
            <P size={4} color="$textSecondary">
              {t('simulator.operatorHint')}
            </P>
            {assignments.length > 0 ? (
              <YStack gap="$1" backgroundColor="$backgroundHover" borderRadius="$4" padding="$3">
                <P size={4} weight="m" color="$textSecondary">
                  {t('simulator.currentAssignments')}
                </P>
                {assignments.map((a) => (
                  <P key={a.resourceId} size={4} color="$textSecondary">
                    {a.resourceName} → {a.operatorName} · {Math.round(a.performanceFactor * 100)}%
                  </P>
                ))}
              </YStack>
            ) : null}
            <FormField label={t('simulator.operator')}>
              <AppSelect options={operatorOptions} value={perfOperator} onChange={setPerfOperator} placeholder={t('simulator.needOperator')} />
            </FormField>
            <FormField label={t('simulator.performancePct')}>
              <AppInput value={perfPct} onChangeText={setPerfPct} keyboardType="numeric" placeholder="100" />
            </FormField>
            <XStack>
              <AppButton variant="primary" size="$3" loading={applying} onPress={setPerformance}>
                {t('simulator.setPerformance')}
              </AppButton>
            </XStack>
            <FormField label={t('simulator.pinLine')}>
              <AppSelect options={resourceOptions} value={pinLine} onChange={setPinLine} placeholder={t('simulator.needLine')} />
            </FormField>
            <XStack>
              <AppButton variant="ghost" size="$3" loading={applying} onPress={pinOperatorToLine}>
                {t('simulator.pinOperator')}
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
