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

  // Local edit state, hydrated from the loaded config (threshold shown as a percent).
  const [pct, setPct] = useState('75')
  const [boundedAuto, setBoundedAuto] = useState(false)
  useEffect(() => {
    if (cfg) {
      setPct(String(Math.round(cfg.tier1AutoThreshold * 100)))
      setBoundedAuto(cfg.tier2Mode === 'bounded_auto')
    }
  }, [cfg])

  const pctNum = Number(pct)
  const valid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100
  const dirty = cfg ? pctNum !== Math.round(cfg.tier1AutoThreshold * 100) || boundedAuto !== (cfg.tier2Mode === 'bounded_auto') : false

  const onSave = () => {
    if (!valid) return
    update.mutate({ tier1AutoThreshold: pctNum / 100, tier2Mode: boundedAuto ? 'bounded_auto' : 'advisory', wearBand: cfg?.wearBand ?? null })
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Panel title={t('autonomy.title')} maxWidth={620}>
        {/* Tier 1 — the confidence threshold (the dial) */}
        <YStack gap="$2">
          <AppInput
            label={t('tier1.label')}
            value={pct}
            onChangeText={setPct}
            type="text"
            error={valid ? undefined : t('tier1.invalid')}
          />
          <P size={3} color="$textSecondary">
            {t('tier1.read', { pct: valid ? pctNum : '—' })}
          </P>
        </YStack>

        {/* Tier 2 — advisory ↔ bounded-auto (seam this phase) */}
        <XStack justifyContent="space-between" alignItems="center" gap="$3" marginTop="$2">
          <YStack flex={1}>
            <P size={3} weight="m" color="$textPrimary">
              {t('tier2.label')}
            </P>
            <P size={4} color="$textSecondary">
              {boundedAuto ? t('tier2.boundedRead') : t('tier2.advisoryRead')}
            </P>
          </YStack>
          <AppSwitch checked={boundedAuto} onCheckedChange={setBoundedAuto} disabled={!canConfigure} />
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
            <P size={3} weight="m" color="$textPrimary">
              {t('tier3.label')}
            </P>
            <P size={4} color="$textSecondary">
              {t('tier3.read')}
            </P>
          </YStack>
          <StatusPill tone="inactive">{t('tier3.locked')}</StatusPill>
        </XStack>

        {canConfigure ? (
          <XStack marginTop="$2" opacity={valid && dirty ? 1 : 0.5} pointerEvents={valid && dirty ? 'auto' : 'none'}>
            <AppButton variant="primary" size="$3" loading={update.isPending} onPress={onSave}>
              {t('save')}
            </AppButton>
          </XStack>
        ) : null}
      </Panel>

      {/* Phase-5 seam — objective trade-off weights + priority tiers (not built). */}
      <Panel title={t('objectives.title')} maxWidth={620}>
        <P size={3} color="$textSecondary">
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
    <AdminShell activeId="objective-policy" title={t('title')}>
      <ObjectivePolicyContent />
    </AdminShell>
  )
}
