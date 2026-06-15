'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { GanttBar } from '@perduraflow/ui'
import {
  AppButton,
  AppSelect,
  FormField,
  P,
  PageHeader,
  ScheduleGantt,
  StatusPill,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { usePlants } from '../../../hooks/useOrg'
import { useParts } from '../../../hooks/useMasterData'
import {
  useCommitSchedule,
  useScheduleResources,
  useScheduleVersion,
  useScheduleVersions,
  useSolveSchedule,
} from '../../../hooks/useScheduling'
import { AdminShell } from '../../shell/admin-shell'

/**
 * Board body (shell-agnostic) — selectors, run strip, Gantt. Rendered inside the
 * web `AdminShell` by {@link BoardScreen} and directly inside the Expo native
 * Stack on iPad (the board is iPad-first-class, FS9), so it must not depend on
 * web-only shell chrome.
 */
export function BoardContent() {
  const { t } = useTranslation(['scheduling', 'admin', 'masterData'])
  const { data: plants = [] } = usePlants()
  const { data: parts = [] } = useParts()
  const [plantId, setPlantId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [selected, setSelected] = useState<GanttBar | null>(null)

  // default plant = first
  useEffect(() => {
    if (!plantId && plants.length > 0) setPlantId(plants[0]!.id)
  }, [plants, plantId])

  const { data: versions = [] } = useScheduleVersions(plantId ?? undefined)
  const { data: resources = [] } = useScheduleResources(plantId ?? undefined)
  const { data: detail } = useScheduleVersion(versionId ?? undefined)
  const solve = useSolveSchedule()
  const commit = useCommitSchedule()

  // default/repair version selection: newest committed, else newest
  useEffect(() => {
    if (versions.length === 0) {
      setVersionId(null)
      return
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      const committed = versions.find((v) => v.status === 'committed')
      setVersionId((committed ?? versions[0]!).id)
    }
  }, [versions, versionId])

  const partNo = useMemo(() => new Map(parts.map((p) => [p.id, p.partNo])), [parts])
  const partColour = useMemo(() => new Map(parts.map((p) => [p.id, p.colour])), [parts])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const versionOptions = versions.map((v) => ({
    value: v.id,
    label: `${t(`status.${v.status}`)} · ${new Date(v.createdAt).toLocaleString()}`,
  }))

  // Changeover markers (render-only): per resource, an op whose part's changeover
  // attribute (colour, the seed driver) differs from the previous op's. Derived
  // from data already on the board — no contract/data change.
  const changeoverIds = useMemo(() => {
    const ids = new Set<string>()
    const ops = [...(detail?.operations ?? [])].sort((a, b) =>
      a.resourceId === b.resourceId ? a.sequencePosition - b.sequencePosition : a.resourceId < b.resourceId ? -1 : 1,
    )
    let prevRes: string | null = null
    let prevColour: string | null | undefined = null
    for (const o of ops) {
      const colour = partColour.get(o.partId)
      if (o.resourceId === prevRes && colour != null && prevColour != null && colour !== prevColour) ids.add(o.id)
      prevRes = o.resourceId
      prevColour = colour
    }
    return ids
  }, [detail, partColour])

  const bars: GanttBar[] = (detail?.operations ?? []).map((o) => ({
    id: o.id,
    resourceId: o.resourceId,
    label: partNo.get(o.partId) ?? o.partId.slice(0, 6),
    sourceTag: t(`source.${o.setupSource}`),
    startMs: new Date(o.plannedStart).getTime(),
    endMs: new Date(o.plannedEnd).getTime(),
    setupMin: o.setupTime,
    runMin: o.cycleTime * o.plannedQty,
    atRisk: o.atRisk,
    changeover: changeoverIds.has(o.id),
  }))
  const ganttResources = resources.map((r) => ({
    id: r.id,
    label: r.name,
    subLabel: t(`masterData:resources.types.${r.resourceType}`),
  }))

  const actionError = solve.error ?? commit.error
  const errorMsg = actionError ? translateError(getApiErrorCode(actionError)) : undefined
  const selectedVersion = versions.find((v) => v.id === versionId)

  const onSolve = () => {
    if (!plantId) return
    solve.mutate(plantId, { onSuccess: (v) => setVersionId(v.id) })
  }

  return (
    <>
      <PageHeader
        title={t('board.title')}
        subtitle={t('board.subtitle')}
        actions={
          <XStack gap="$2">
            {selectedVersion?.status === 'draft' ? (
              <AppButton variant="primary" size="$3" loading={commit.isPending} onPress={() => versionId && commit.mutate(versionId)}>
                {t('board.commit')}
              </AppButton>
            ) : null}
            <AppButton variant="ghost" size="$3" loading={solve.isPending} onPress={onSolve}>
              {t('board.resolve')}
            </AppButton>
          </XStack>
        }
      />

      <XStack gap="$4" flexWrap="wrap">
        <YStack width={240}>
          <FormField label={t('board.plant')}>
            <AppSelect options={plantOptions} value={plantId} onChange={setPlantId} placeholder={t('board.plant')} />
          </FormField>
        </YStack>
        <YStack width={360}>
          <FormField label={t('board.version')}>
            <AppSelect options={versionOptions} value={versionId} onChange={setVersionId} placeholder={t('board.version')} />
          </FormField>
        </YStack>
      </XStack>

      {errorMsg ? (
        <P size={4} color="$danger">
          {errorMsg}
        </P>
      ) : null}

      {detail ? (
        <XStack gap="$3" alignItems="center" flexWrap="wrap">
          <StatusPill tone={detail.version.status === 'committed' ? 'active' : detail.version.status === 'draft' ? 'neutral' : 'inactive'}>
            {t(`status.${detail.version.status}`)}
          </StatusPill>
          <P size={5} color="$textSecondary">
            {t('board.run.status')}: {t(`runStatus.${detail.run.status}`)} · {t('board.run.ops')}: {detail.operations.length} ·{' '}
            {t('board.run.demand')}: {detail.run.inputDemandCount}
          </P>
        </XStack>
      ) : null}

      {detail ? <GanttLegend /> : null}

      {versions.length === 0 ? (
        <P size={4} color="$textSecondary">
          {t('board.empty')}
        </P>
      ) : detail ? (
        <>
          <ScheduleGantt
            resources={ganttResources}
            bars={bars}
            horizonStartMs={new Date(detail.version.horizonStart).getTime()}
            horizonEndMs={new Date(detail.version.horizonEnd).getTime()}
            onBarPress={setSelected}
            emptyText={t('board.noResources')}
          />
          {selected ? (
            <P size={5} color="$textSecondary">
              {selected.label} · {fmtTime(selected.startMs)}–{fmtTime(selected.endMs)} · {t('board.tooltip.setup')}{' '}
              {Math.round(selected.setupMin)}m / {t('board.tooltip.run')} {Math.round(selected.runMin)}m ·{' '}
              {selected.sourceTag}
              {selected.atRisk ? ` · ${t('atRisk')}` : ''}
            </P>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/** Time as HH:MM (UTC, matching the Gantt's axis). */
function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Gantt legend — swatches match the bar visuals exactly; source lives here, not in bars. */
function GanttLegend() {
  const { t } = useTranslation('scheduling')
  const Entry = ({ swatch, label }: { swatch: ReactNode; label: string }) => (
    <XStack alignItems="center" gap="$2">
      {swatch}
      <P size={6} color="$textSecondary">
        {label}
      </P>
    </XStack>
  )
  return (
    <XStack gap="$4" flexWrap="wrap" alignItems="center">
      <Entry swatch={<YStack width={22} height={12} borderRadius="$2" backgroundColor="$primary" />} label={t('legend.run')} />
      {/* setup = run colour + a black-0.28 overlay, same recipe as the bar's setup head */}
      <Entry
        swatch={
          <YStack width={22} height={12} borderRadius="$2" backgroundColor="$primary" overflow="hidden">
            <YStack flex={1} style={{ backgroundColor: 'rgba(0,0,0,0.28)' }} />
          </YStack>
        }
        label={t('legend.setup')}
      />
      <Entry swatch={<YStack width={4} height={16} borderRadius="$1" backgroundColor="$primaryLight" />} label={t('legend.changeover')} />
      <Entry
        swatch={<YStack width={22} height={12} borderRadius="$2" backgroundColor="$primary" borderWidth={2} borderColor="$danger" />}
        label={t('legend.atRisk')}
      />
      <P size={7} color="$textSecondary">
        {t('legend.sourceNote')}
      </P>
    </XStack>
  )
}

/** Web board screen — the board body inside the desktop `AdminShell` chrome. */
export function BoardScreen() {
  return (
    <AdminShell activeId="board">
      <BoardContent />
    </AdminShell>
  )
}
