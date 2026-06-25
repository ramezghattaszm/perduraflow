'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type ConfigFieldView,
  type ConfigGroupKey,
  type ConfigGroupView,
  type ConfigLevel,
  FIRM_LATENESS_DOMINANCE_RATIO,
  firmLatenessDominates,
  OBJECTIVE_WEIGHT_KEYS,
  type ObjectiveWeights,
} from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  AppSelect,
  AppSlider,
  P,
  PageHeader,
  Panel,
  SegmentedControl,
  StatusPill,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useConfigGroup, useResetConfigOverride, useSetConfigOverride } from '../../hooks/useConfig'
import { usePlants } from '../../hooks/useOrg'
import { useCanConfigure, useCurrentUser } from '../../stores/auth.store'
import { AdminShell } from '../shell/admin-shell'

/** Groups in the framework — Reporting is live (Stage 1); the others are registered placeholders. */
const GROUPS: { key: ConfigGroupKey; live: boolean }[] = [
  { key: 'objective', live: true },
  { key: 'reporting', live: true },
  { key: 'autonomy', live: false },
]

const SCOPES: ConfigLevel[] = ['global', 'tenant', 'plant']
const PROVENANCE_TONE = { global: 'neutral', tenant: 'active', plant: 'warning' } as const

/**
 * Configuration (admin) — the hierarchical config framework surface (CONFIG-FRAMEWORK-DESIGN). One
 * section per setting group; a scope selector (Global → Tenant → Plant) demonstrates the cascade.
 * Each field shows its effective value, where it resolved from (inherited vs overridden), the
 * global/tenant/plant columns, and a reset-to-parent. Stage 1 serves the **Reporting Policy** group
 * (the KPI reporting window) through the framework; Objective (weights) + Autonomy arrive next.
 */
export function ConfigurationContent() {
  const { t } = useTranslation('configuration')
  const canConfigure = useCanConfigure()
  const user = useCurrentUser()
  const { data: plants = [] } = usePlants()

  const [group, setGroup] = useState<ConfigGroupKey>('reporting')
  const [scope, setScope] = useState<ConfigLevel>('tenant')
  const [plantId, setPlantId] = useState<string | null>(plants[0]?.id ?? null)

  const live = GROUPS.find((g) => g.key === group)?.live ?? false
  // Resolve WITH the plant when the plant scope is in view, so the plant override participates.
  const resolvePlantId = scope === 'plant' ? (plantId ?? undefined) : undefined
  const { data: view } = useConfigGroup(group, live ? resolvePlantId : undefined)

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
      />

      {/* Group selector */}
      <Panel title={t('groups.title')} maxWidth={760}>
        <SegmentedControl
          options={GROUPS.map((g) => ({ value: g.key, label: t(`groups.${g.key}`) }))}
          value={group}
          onChange={(g) => setGroup(g as ConfigGroupKey)}
        />
        <P size={3} color="$textSecondary">
          {t(`groupDesc.${group}`)}
        </P>
      </Panel>

      {!live ? (
        <Panel title={t(`groups.${group}`)} maxWidth={760}>
          <StatusPill tone="neutral">{t('notLive.badge')}</StatusPill>
          <P size={3} color="$textSecondary">
            {t(`notLive.${group}`)}
          </P>
        </Panel>
      ) : (
        <Panel title={t('cascade.title')} maxWidth={760}>
          {/* Scope selector — demonstrates the cascade. Global is the read-only floor. */}
          <XStack gap="$3" alignItems="center" flexWrap="wrap">
            <SegmentedControl
              options={SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) }))}
              value={scope}
              onChange={(s) => setScope(s as ConfigLevel)}
            />
            {scope === 'plant' ? (
              <YStack minWidth={220}>
                <AppSelect
                  options={plants.map((p) => ({ value: p.id, label: p.name }))}
                  value={plantId}
                  onChange={setPlantId}
                  placeholder={t('scope.pickPlant')}
                />
              </YStack>
            ) : null}
          </XStack>

          <P size={3} color="$textSecondary">
            {t(`scopeHint.${scope}`)}
          </P>

          {group === 'objective' && view ? (
            <ObjectiveWeightsEditor
              view={view}
              scope={scope}
              tenantId={user?.tenantId ?? ''}
              plantId={plantId}
              canEdit={canConfigure && scope !== 'global'}
            />
          ) : (
            <YStack gap="$3" marginTop="$2">
              {(view?.fields ?? []).map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  group={group}
                  scope={scope}
                  tenantId={user?.tenantId ?? ''}
                  plantId={plantId}
                  canEdit={canConfigure && scope !== 'global'}
                />
              ))}
            </YStack>
          )}
        </Panel>
      )}
    </>
  )
}

/** One field's cascade row — effective value + provenance + global/tenant/plant columns + edit/reset. */
function FieldRow({
  field,
  group,
  scope,
  tenantId,
  plantId,
  canEdit,
}: {
  field: ConfigFieldView
  group: ConfigGroupKey
  scope: ConfigLevel
  tenantId: string
  plantId: string | null
  canEdit: boolean
}) {
  const { t } = useTranslation('configuration')
  const set = useSetConfigOverride()
  const reset = useResetConfigOverride()

  // The override value at the scope in view (null = inherited here), as an edit string.
  const scopeOverride = scope === 'plant' ? field.plant : scope === 'tenant' ? field.tenant : null
  const [draft, setDraft] = useState<string>(scopeOverride != null ? String(scopeOverride) : '')

  const num = draft.trim() === '' ? null : Number(draft)
  const inRange =
    num === null ||
    (Number.isFinite(num) &&
      (field.min === undefined || num >= field.min) &&
      (field.max === undefined || num <= field.max) &&
      (field.kind !== 'int' || Number.isInteger(num)))
  const scopeId = scope === 'plant' ? plantId : tenantId
  const dirty = (scopeOverride != null ? String(scopeOverride) : '') !== draft.trim()
  const overriddenHere = scopeOverride != null

  const onSave = () => {
    if (!inRange || num === null || !scopeId || scope === 'global') return
    set.mutate({ group, level: scope, scopeId, fields: { [field.key]: num }, plantId: plantId ?? undefined })
  }
  const onReset = () => {
    if (!scopeId || scope === 'global') return
    reset.mutate({ group, level: scope, scopeId, field: field.key, plantId: plantId ?? undefined })
    setDraft('')
  }

  return (
    <YStack
      gap="$2"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$4"
      padding="$3"
    >
      <XStack justifyContent="space-between" alignItems="center" gap="$2" flexWrap="wrap">
        <P size={3} weight="m" color="$textPrimary">
          {t(`field.${field.key}`)}
        </P>
        <XStack gap="$2" alignItems="center">
          <P size={4} color="$textTertiary">
            {t('row.effective', { value: String(field.value) })}
          </P>
          <StatusPill tone={PROVENANCE_TONE[field.provenance]}>
            {t(`provenance.${field.provenance}`)}
          </StatusPill>
        </XStack>
      </XStack>

      {/* Cascade columns — the global → tenant → plant values in force. */}
      <XStack gap="$4" flexWrap="wrap">
        <P size={5} color="$textTertiary">
          {t('col.global', { value: String(field.global) })}
        </P>
        <P size={5} color="$textTertiary">
          {t('col.tenant', { value: field.tenant != null ? String(field.tenant) : t('col.inherited') })}
        </P>
        <P size={5} color="$textTertiary">
          {t('col.plant', { value: field.plant != null ? String(field.plant) : t('col.inherited') })}
        </P>
      </XStack>

      {scope !== 'global' ? (
        <XStack gap="$2" alignItems="flex-end" flexWrap="wrap">
          <YStack flex={1} minWidth={160}>
            <AppInput
              label={t('row.overrideAt', { scope: t(`scope.${scope}`) })}
              value={draft}
              onChangeText={setDraft}
              type="text"
              placeholder={t('row.inheritPlaceholder')}
              error={inRange ? undefined : t('row.invalid', { min: field.min ?? '', max: field.max ?? '' })}
            />
          </YStack>
          <AppButton
            variant="primary"
            size="$3"
            disabled={!canEdit || !dirty || !inRange || num === null}
            onPress={onSave}
          >
            {t('row.save')}
          </AppButton>
          <AppButton
            variant="light"
            size="$3"
            disabled={!canEdit || !overriddenHere}
            onPress={onReset}
          >
            {t('row.reset')}
          </AppButton>
        </XStack>
      ) : (
        <P size={5} color="$textTertiary">
          {t('row.globalReadOnly')}
        </P>
      )}
    </YStack>
  )
}

/** Read the resolved weights (effective values) out of a group view. */
function weightsFromView(view: ConfigGroupView): ObjectiveWeights {
  const byKey = new Map(view.fields.map((f) => [f.key, Number(f.value)]))
  return {
    lateness: byKey.get('lateness') ?? 0,
    changeover: byKey.get('changeover') ?? 0,
    overtime: byKey.get('overtime') ?? 0,
    inventory: byKey.get('inventory') ?? 0,
    displacement: byKey.get('displacement') ?? 0,
    cost: byKey.get('cost') ?? 0,
  }
}

const WEIGHT_SLIDER_MAX: Record<keyof ObjectiveWeights, number> = {
  lateness: 40,
  changeover: 20,
  overtime: 20,
  inventory: 20,
  displacement: 20,
  cost: 20,
}

/**
 * Objective Policy editor — the six weights as **slider + exact-number entry**, edited as one cohesive
 * set and saved together at the scope. The firm-lateness-dominance guard ({@link firmLatenessDominates},
 * the SAME pure fn as the runtime + locked test) runs **live** as you drag/type: a breaching weight is
 * shown in `$warning`, the protected invariant is named, and Save is blocked until firm delivery again
 * dominates — so a custom set can never weight firm delivery away. The server re-checks on save.
 */
function ObjectiveWeightsEditor({
  view,
  scope,
  tenantId,
  plantId,
  canEdit,
}: {
  view: ConfigGroupView
  scope: ConfigLevel
  tenantId: string
  plantId: string | null
  canEdit: boolean
}) {
  const { t } = useTranslation('configuration')
  const set = useSetConfigOverride()
  const reset = useResetConfigOverride()

  const initial = useMemo(() => weightsFromView(view), [view])
  const [w, setW] = useState<ObjectiveWeights>(initial)
  useEffect(() => setW(initial), [initial])

  const verdict = firmLatenessDominates(w)
  const ceiling = w.lateness / FIRM_LATENESS_DOMINANCE_RATIO
  const provenance = new Map(view.fields.map((f) => [f.key, f.provenance]))
  const overriddenHere = view.fields.some((f) => (scope === 'plant' ? f.plant : scope === 'tenant' ? f.tenant : null) != null)
  const dirty = OBJECTIVE_WEIGHT_KEYS.some((k) => w[k] !== initial[k])
  const scopeId = scope === 'plant' ? plantId : tenantId

  const setWeight = (k: keyof ObjectiveWeights, value: number) => setW((prev) => ({ ...prev, [k]: value }))

  const onSave = () => {
    if (!verdict.ok || !scopeId || scope === 'global') return
    set.mutate({ group: 'objective', level: scope, scopeId, fields: { ...w }, plantId: plantId ?? undefined })
  }
  const onReset = () => {
    if (!scopeId || scope === 'global') return
    reset.mutate({ group: 'objective', level: scope, scopeId, plantId: plantId ?? undefined })
  }

  return (
    <YStack gap="$3" marginTop="$2">
      {/* The protected-invariant banner — always visible; turns into the live guard warning when broken. */}
      <YStack
        gap="$1"
        borderWidth={1}
        borderColor={verdict.ok ? '$borderColor' : '$warning'}
        backgroundColor={verdict.ok ? '$surfaceRaised' : '$warningSoft'}
        borderRadius="$4"
        padding="$3"
      >
        <XStack gap="$2" alignItems="center">
          <StatusPill tone={verdict.ok ? 'active' : 'warning'}>
            {verdict.ok ? t('objective.guardOk') : t('objective.guardBroken')}
          </StatusPill>
          <P size={4} color="$textSecondary">
            {t('objective.invariant', { ratio: FIRM_LATENESS_DOMINANCE_RATIO, ceiling: round2(ceiling) })}
          </P>
        </XStack>
        {!verdict.ok ? (
          <P size={4} color="$warning">
            {t('objective.guardHint', { fields: verdict.offending.map((k) => t(`field.${k}`)).join(', ') })}
          </P>
        ) : null}
      </YStack>

      {OBJECTIVE_WEIGHT_KEYS.map((k) => {
        const isLateness = k === 'lateness'
        const breaches = verdict.offending.includes(k)
        return (
          <YStack key={k} gap="$2" borderWidth={1} borderColor="$borderColor" borderRadius="$4" padding="$3">
            <XStack justifyContent="space-between" alignItems="center" gap="$2" flexWrap="wrap">
              <XStack gap="$2" alignItems="center">
                <P size={3} weight="m" color="$textPrimary">
                  {t(`field.${k}`)}
                </P>
                {isLateness ? <StatusPill tone="active">{t('objective.dominant')}</StatusPill> : null}
              </XStack>
              <StatusPill tone={PROVENANCE_TONE[provenance.get(k) ?? 'global']}>
                {t(`provenance.${provenance.get(k) ?? 'global'}`)}
              </StatusPill>
            </XStack>
            <XStack gap="$3" alignItems="center">
              <YStack flex={1} opacity={canEdit ? 1 : 0.6} pointerEvents={canEdit ? 'auto' : 'none'}>
                <AppSlider
                  value={w[k]}
                  onChange={(v) => setWeight(k, round2(v))}
                  min={0}
                  max={WEIGHT_SLIDER_MAX[k]}
                  step={0.1}
                  tone={breaches ? 'warning' : 'primary'}
                />
              </YStack>
              <YStack width={92}>
                <AppInput
                  value={String(w[k])}
                  onChangeText={(txt) => {
                    const n = Number(txt)
                    if (txt.trim() !== '' && Number.isFinite(n)) setWeight(k, n)
                    else if (txt.trim() === '') setWeight(k, 0)
                  }}
                  type="text"
                />
              </YStack>
            </XStack>
            {!isLateness ? (
              <P size={5} color={breaches ? '$warning' : '$textTertiary'}>
                {t('objective.ceilingHint', { ceiling: round2(ceiling) })}
              </P>
            ) : null}
          </YStack>
        )
      })}

      {scope !== 'global' ? (
        <XStack gap="$2" alignItems="center" flexWrap="wrap">
          <AppButton variant="primary" size="$3" disabled={!canEdit || !dirty || !verdict.ok} onPress={onSave}>
            {t('row.save')}
          </AppButton>
          <AppButton variant="light" size="$3" disabled={!canEdit || !overriddenHere} onPress={onReset}>
            {t('row.reset')}
          </AppButton>
          {!verdict.ok ? (
            <P size={4} color="$warning">
              {t('objective.saveBlocked')}
            </P>
          ) : null}
        </XStack>
      ) : (
        <P size={5} color="$textTertiary">
          {t('row.globalReadOnly')}
        </P>
      )}
    </YStack>
  )
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Web Configuration screen — body inside the desktop `AdminShell` chrome. */
export function ConfigurationScreen() {
  const { t } = useTranslation('configuration')
  return (
    <AdminShell activeId="configuration" title={t('title')}>
      <ConfigurationContent />
    </AdminShell>
  )
}
