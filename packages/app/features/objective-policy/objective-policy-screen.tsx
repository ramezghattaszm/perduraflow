'use client'

import { useEffect, useState } from 'react'
import {
  AppButton,
  AppInput,
  AppSwitch,
  P,
  PageHeader,
  Panel,
  StatusPill,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useAutonomyConfig, useUpdateAutonomyConfig } from '../../hooks/useLearning'
import { useCanConfigure } from '../../stores/auth.store'
import { AdminShell } from '../shell/admin-shell'

/**
 * View 5 · Objective Policy (ops leader) — **the autonomy boundary as config** (the
 * A18 Tier-2/Tier-3 line, D42). A config screen legitimately **names** the rules
 * (different context from the live demo's "don't narrate the model", VIEW-PLAN §5).
 * Phase 4 builds the **autonomy controls only**: the Tier-1 confidence threshold +
 * tier behavior (Tier-3 shown **locked-human** — the A18 floor). Objective trade-off
 * weights + priority tiers are a labelled **Phase-5 seam**, not built.
 */
export function ObjectivePolicyContent() {
  const { t } = useTranslation('objectivePolicy')
  const canConfigure = useCanConfigure()
  const { data: cfg } = useAutonomyConfig()
  const update = useUpdateAutonomyConfig()

  // Local edit state, hydrated from the loaded config. Threshold/wear/delta show as percents,
  // urgency as hours. The three tuning fields are NULLABLE — blank means "use the safe default".
  const [pct, setPct] = useState('75')
  const [boundedAuto, setBoundedAuto] = useState(false)
  const [wearPct, setWearPct] = useState('')
  const [snoozeDeltaPct, setSnoozeDeltaPct] = useState('')
  const [snoozeHours, setSnoozeHours] = useState('')

  // Hydrate the nullable fields to their display string ('' when unset → the default applies).
  const wearStr = (c: typeof cfg) =>
    c?.wearBand != null ? String(Math.round(c.wearBand * 100)) : ''
  const deltaStr = (c: typeof cfg) =>
    c?.snoozeConfDelta != null ? String(Math.round(c.snoozeConfDelta * 100)) : ''
  const hoursStr = (c: typeof cfg) =>
    c?.snoozeUrgencyMinutes != null ? String(Math.round(c.snoozeUrgencyMinutes / 60)) : ''
  useEffect(() => {
    if (cfg) {
      setPct(String(Math.round(cfg.tier1AutoThreshold * 100)))
      setBoundedAuto(cfg.tier2Mode === 'bounded_auto')
      setWearPct(wearStr(cfg))
      setSnoozeDeltaPct(deltaStr(cfg))
      setSnoozeHours(hoursStr(cfg))
    }
  }, [cfg])

  const pctNum = Number(pct)
  const pctValid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100
  // Each nullable field: blank is valid (→ default); else it must parse in range.
  const wearNum = wearPct.trim() === '' ? null : Number(wearPct)
  const wearValid = wearNum === null || (Number.isFinite(wearNum) && wearNum > 0 && wearNum <= 200)
  const deltaNum = snoozeDeltaPct.trim() === '' ? null : Number(snoozeDeltaPct)
  const deltaValid =
    deltaNum === null || (Number.isFinite(deltaNum) && deltaNum >= 0 && deltaNum <= 100)
  const hoursNum = snoozeHours.trim() === '' ? null : Number(snoozeHours)
  const hoursValid = hoursNum === null || (Number.isFinite(hoursNum) && hoursNum > 0)
  const valid = pctValid && wearValid && deltaValid && hoursValid

  // Dirty by comparing display strings to the hydrated config form (exact — avoids float wobble).
  const dirty = cfg
    ? pctNum !== Math.round(cfg.tier1AutoThreshold * 100) ||
      boundedAuto !== (cfg.tier2Mode === 'bounded_auto') ||
      wearPct.trim() !== wearStr(cfg) ||
      snoozeDeltaPct.trim() !== deltaStr(cfg) ||
      snoozeHours.trim() !== hoursStr(cfg)
    : false

  const onSave = () => {
    if (!valid) return
    update.mutate({
      tier1AutoThreshold: pctNum / 100,
      tier2Mode: boundedAuto ? 'bounded_auto' : 'advisory',
      wearBand: wearNum === null ? null : wearNum / 100,
      snoozeConfDelta: deltaNum === null ? null : deltaNum / 100,
      snoozeUrgencyMinutes: hoursNum === null ? null : Math.round(hoursNum * 60),
    })
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
      />

      <Panel
        title={t('autonomy.title')}
        maxWidth={620}
      >
        {/* Tier 1 — the confidence threshold (the dial) */}
        <YStack gap="$2">
          <AppInput
            label={t('tier1.label')}
            value={pct}
            onChangeText={setPct}
            type="text"
            error={valid ? undefined : t('tier1.invalid')}
          />
          <P
            size={3}
            color="$textSecondary"
          >
            {t('tier1.read', { pct: valid ? pctNum : '—' })}
          </P>
        </YStack>

        {/* Tier 2 — advisory ↔ bounded-auto (seam this phase) */}
        <XStack
          justifyContent="space-between"
          alignItems="center"
          gap="$3"
          marginTop="$2"
        >
          <YStack flex={1}>
            <P
              size={3}
              weight="m"
              color="$textPrimary"
            >
              {t('tier2.label')}
            </P>
            <P
              size={4}
              color="$textSecondary"
            >
              {boundedAuto ? t('tier2.boundedRead') : t('tier2.advisoryRead')}
            </P>
          </YStack>
          <AppSwitch
            checked={boundedAuto}
            onCheckedChange={setBoundedAuto}
            disabled={!canConfigure}
          />
        </XStack>

        {/* Tier 3 — always human, the A18 floor (locked, not relaxable) */}
        <XStack
          justifyContent="space-between"
          alignItems="center"
          gap="$3"
          marginTop="$2"
          borderTopWidth={1}
          borderTopColor="$borderColor"
          paddingTop="$3"
        >
          <YStack flex={1}>
            <P
              size={3}
              weight="m"
              color="$textPrimary"
            >
              {t('tier3.label')}
            </P>
            <P
              size={4}
              color="$textSecondary"
            >
              {t('tier3.read')}
            </P>
          </YStack>
          <StatusPill tone="inactive">{t('tier3.locked')}</StatusPill>
        </XStack>
      </Panel>

      {/* Predictive tuning — the wear-flag band + the snooze re-ask thresholds. Each is NULLABLE:
          blank = the safe default (the wearBand / RULE.SNOOZE_* constants). Per-tenant (D42). */}
      <Panel
        title={t('tuning.title')}
        maxWidth={620}
      >
        <P
          size={4}
          color="$textSecondary"
        >
          {t('tuning.subtitle')}
        </P>
        <YStack gap="$2">
          <AppInput
            label={t('tuning.wearLabel')}
            value={wearPct}
            onChangeText={setWearPct}
            type="text"
            error={wearValid ? undefined : t('tuning.invalidWear')}
          />
          <P
            size={4}
            color="$textSecondary"
          >
            {t('tuning.wearRead', { pct: wearNum ?? 5 })}
          </P>
        </YStack>
        <YStack gap="$2">
          <AppInput
            label={t('tuning.deltaLabel')}
            value={snoozeDeltaPct}
            onChangeText={setSnoozeDeltaPct}
            type="text"
            error={deltaValid ? undefined : t('tuning.invalidDelta')}
          />
          <P
            size={4}
            color="$textSecondary"
          >
            {t('tuning.deltaRead', { pts: deltaNum ?? 15 })}
          </P>
        </YStack>
        <YStack gap="$2">
          <AppInput
            label={t('tuning.hoursLabel')}
            value={snoozeHours}
            onChangeText={setSnoozeHours}
            type="text"
            error={hoursValid ? undefined : t('tuning.invalidHours')}
          />
          <P
            size={4}
            color="$textSecondary"
          >
            {t('tuning.hoursRead', { h: hoursNum ?? 24 })}
          </P>
        </YStack>
      </Panel>

      {canConfigure ? (
        <XStack
          opacity={valid && dirty ? 1 : 0.5}
          pointerEvents={valid && dirty ? 'auto' : 'none'}
        >
          <AppButton
            variant="primary"
            size="$3"
            loading={update.isPending}
            onPress={onSave}
          >
            {t('save')}
          </AppButton>
        </XStack>
      ) : null}

      {/* Phase-5 seam — objective trade-off weights + priority tiers (not built). */}
      <Panel
        title={t('objectives.title')}
        maxWidth={620}
      >
        <P
          size={3}
          color="$textSecondary"
        >
          {t('objectives.seam')}
        </P>
      </Panel>
    </>
  )
}

/** Web Objective Policy screen — body inside the desktop `AdminShell` chrome. */
export function ObjectivePolicyScreen() {
  const { t } = useTranslation('objectivePolicy')
  return (
    <AdminShell
      activeId="objective-policy"
      title={t('title')}
    >
      <ObjectivePolicyContent />
    </AdminShell>
  )
}
