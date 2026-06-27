'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'solito/navigation'
import { ArrowUp, ChevronRight, CircleDashed, Search, TriangleAlert } from '@tamagui/lucide-icons'
import type { WorkListRowDto, WorkListStatus } from '@perduraflow/contracts'
import {
  AppButton,
  AppSelect,
  type Column,
  DataTable,
  Input,
  LatenessChain,
  P,
  PageHeader,
  SegmentedControl,
  StatusPill,
  type StatusTone,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../../i18n'
import { latenessLines, latenessSummary } from '../../../utils/lateness'
import { usePlants } from '../../../hooks/useOrg'
import { usePlantSelection } from '../../../hooks/usePlantSelection'
import { useScheduleVersion, useWorkList } from '../../../hooks/useScheduling'
import { useLearnedParameters } from '../../../hooks/useLearning'
import { useParts } from '../../../hooks/useMasterData'
import { useDiscussOptions, useSeeOptions, type AtRiskOrderRef } from '../../../hooks/useAtRiskRemediation'
import { useActivePopup, usePopup } from '../../../stores/popup.store'
import { OpDetailCard } from '../op-detail-card'
import { AdminShell } from '../../shell/admin-shell'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
const fmtDayTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${fmtDay(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Status → pill tone (single mapping; shared by the column cell + the detail ops).
 *  `stranded` is amber (warning), distinct from `at_risk` red — a can't-run-as-planned FACT, not a
 *  delivery-late prediction. */
const STATUS_TONE: Record<WorkListStatus, StatusTone> = {
  completed: 'active',
  at_risk: 'danger',
  stranded: 'warning',
  in_progress: 'neutral',
  scheduled: 'inactive',
}
/** Default sort weight — most-actionable first (matches the API's row order). */
const STATUS_RANK: Record<WorkListStatus, number> = {
  at_risk: 0,
  stranded: 1,
  in_progress: 2,
  scheduled: 3,
  completed: 4,
}
const PRIORITY_RANK = { critical: 0, high: 1, standard: 2 } as const

/**
 * Priority as a symbol, not a word — only the exceptions are flagged: a red alert for `critical`,
 * an amber up-arrow for `high`, nothing for the (common) `standard`.
 */
/** Build the at-risk order ref the two doors act on (label = release reference, falls back to the id). */
const orderRef = (r: WorkListRowDto): AtRiskOrderRef => ({ demandLineId: r.demandLineId, label: r.releaseReference ?? r.demandLineId })

function PriorityMark({ priority }: { priority: WorkListRowDto['priority'] }) {
  if (priority === 'critical')
    return (
      <TriangleAlert
        size={14}
        color="$danger"
      />
    )
  if (priority === 'high')
    return (
      <ArrowUp
        size={15}
        color="$warning"
      />
    )
  return null
}

type FilterValue = 'all' | WorkListStatus
/** Valid filter values — also the allow-list for the `?status=` deep-link (e.g. from the scorecard). */
const FILTER_VALUES: FilterValue[] = ['all', 'at_risk', 'stranded', 'in_progress', 'scheduled', 'completed']

/**
 * Work List table (D-worklist) — the all-work table: every order with a computed lifecycle status,
 * status-count chips that double as the filter, and a per-row drill-in (op breakdown + causal
 * lateness chain). **Embeddable** — it takes the scope (`plantId` / optional `versionId`) so it can
 * render on its own screen ({@link WorkListContent}) or below the Gantt on the Decision Cockpit,
 * always reading the same single source. The at-risk chip count equals the exception queue by
 * construction.
 */
export function WorkListTable({
  plantId,
  versionId,
  initialFilter,
}: { plantId: string | undefined; versionId?: string; initialFilter?: FilterValue }) {
  const { t } = useTranslation(['workList', 'scheduling'])
  const runSeeOptions = useSeeOptions()
  const runDiscussOptions = useDiscussOptions()
  const { show: showPopup, hide: hidePopup } = usePopup()
  const activePopup = useActivePopup()
  const { data, isLoading } = useWorkList(plantId, versionId)
  const [filter, setFilter] = useState<FilterValue>(initialFilter ?? 'all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The op the user drilled into from the order rollup (null = showing the rollup). Drives whether the
  // popup shows the order rollup or the shared op card; "back" just clears it.
  const [drilledOpSeq, setDrilledOpSeq] = useState<number | null>(null)

  // Drill-in: an op row in the order rollup opens the SHARED OpDetailCard (the same card the board's
  // Gantt bar opens). The work-list rows carry only a thin op summary, so resolve the full op from the
  // version detail (same scheduleVersionId the work-list was computed against) + its learned record.
  const { data: versionDetail } = useScheduleVersion(data?.scheduleVersionId ?? undefined)
  const { data: learnedParams = [] } = useLearnedParameters()
  const { data: partsList = [] } = useParts()
  const fullOpByKey = useMemo(
    () => new Map((versionDetail?.operations ?? []).map((op) => [`${op.demandLineId}:${op.opSeq}`, op])),
    [versionDetail],
  )
  const learnedCycleByKey = useMemo(
    () => new Map(learnedParams.filter((l) => l.param === 'cycle').map((l) => [`${l.resourceId}:${l.routingOperationId}`, l])),
    [learnedParams],
  )
  const partNoById = useMemo(() => new Map(partsList.map((p) => [p.id, p.partNo])), [partsList])

  const counts = data?.counts ?? { total: 0, completed: 0, atRisk: 0, committedAtRisk: 0, stranded: 0, inProgress: 0, scheduled: 0 }
  const rows = data?.rows ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Free-text search over everything visible in a row — identity, customer, status, the
    // priority/firmness words (so "critical"/"forecast" still find the symbol rows), the formatted
    // due/planned dates, the lanes, and the at-risk reason.
    const matches = (r: WorkListRowDto) => {
      if (!q) return true
      // The at-risk reason cell renders the causal chain (e.g. "PV-22 material · held by …"), so
      // search the full chain text — component, blocker order/op, resources — not just the raw tag.
      const riskText =
        r.status === 'at_risk'
          ? r.chain
            ? latenessLines(r.chain, (k, o) => t(`scheduling:${k}`, o ?? {})).join(' ')
            : t(`scheduling:riskReason.${r.atRiskReason}`, { defaultValue: r.atRiskReason ?? '' })
          : ''
      const hay = [
        r.label,
        r.demandLineId,
        r.partNo,
        r.releaseReference ?? '',
        r.customerName,
        t(`priority.${r.priority}`),
        t(`firmness.${r.firmness}`),
        t(`status.${r.status}`),
        fmtDay(r.requiredDate),
        fmtDayTime(r.plannedEnd),
        r.resourceNames.join(' '),
        riskText,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    }
    return rows.filter((r) => (filter === 'all' || r.status === filter) && matches(r))
  }, [rows, filter, search, t])
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  // The drilled-into op card (the SAME component the board's Gantt bar opens), shown in the popup when
  // an op row is clicked. Resolves the full op from the version detail + its learned record; carries a
  // "back" to the rollup and (for firm at-risk) the same "Evaluate options" the board uses. Null when
  // not drilled in or the full op isn't resolved yet → the popup shows the order rollup instead.
  const drilledOp = selected && drilledOpSeq != null ? selected.ops.find((o) => o.opSeq === drilledOpSeq) : undefined
  const drilledFullOp = selected && drilledOpSeq != null ? fullOpByKey.get(`${selected.demandLineId}:${drilledOpSeq}`) : undefined
  const opCardContent =
    selected && drilledOp && drilledFullOp ? (
      <OpDetailCard
        op={drilledFullOp}
        learned={learnedCycleByKey.get(`${drilledFullOp.resourceId}:${drilledFullOp.routingOperationId}`)}
        resourceName={drilledOp.resourceName}
        partNo={partNoById.get(drilledFullOp.partId) ?? drilledFullOp.partId}
        onBack={{ label: t('detail.back'), onPress: () => setDrilledOpSeq(null) }}
        seeOptions={
          selected.status === 'at_risk' && selected.firmness === 'firm'
            ? { label: t('exceptions:seeOptions'), onPress: () => runSeeOptions(orderRef(selected)) }
            : undefined
        }
        evaluateOptions={
          selected.status === 'at_risk' && selected.firmness === 'firm'
            ? { label: t('exceptions:evaluateOptions'), onPress: () => runDiscussOptions(orderRef(selected)) }
            : undefined
        }
      />
    ) : null

  // The row detail (ops + "why late" chain + the firm-at-risk "Evaluate options" action) opens in the
  // GLOBAL POPUP (usePopup) when a row is clicked — same as the board op card. Content only; the popup
  // supplies the frame + title. A snapshot of the selected row.
  const detailContent = selected ? (
    <YStack gap="$2">
      <P size={5} weight="b" caps color="$textTertiary">
        {t('detail.ops')}
      </P>
      {/* Each op drills into the shared op card (chevron = clickable). Multiple ops are split by a thin
          divider (like the work-list rows) with minimal vertical padding. */}
      <YStack>
        {selected.ops.map((o, i) => (
          <XStack
            key={o.opSeq}
            gap="$3"
            alignItems="center"
            cursor="pointer"
            hoverStyle={{ opacity: 0.7 }}
            onPress={() => setDrilledOpSeq(o.opSeq)}
            paddingVertical="$1.5"
            {...(i > 0 ? { borderTopWidth: 1, borderTopColor: '$borderColor' } : {})}
          >
            <XStack flex={1} gap="$3" alignItems="center" flexWrap="wrap">
              <StatusPill tone={STATUS_TONE[o.status]}>{t(`status.${o.status}`)}</StatusPill>
              <P size={3} weight="m" color="$textPrimary">
                {t('detail.op', { opSeq: o.opSeq })} · {o.resourceName}
              </P>
              <P size={4} color="$textSecondary">
                {t('detail.planned', { start: fmtDayTime(o.plannedStart), end: fmtDayTime(o.plannedEnd) })}
              </P>
            </XStack>
            <ChevronRight size={16} color="$textTertiary" />
          </XStack>
        ))}
      </YStack>
      {selected.status === 'at_risk' && selected.chain ? (
        <YStack marginTop="$2">
          <LatenessChain
            title={t('detail.why')}
            summary={latenessSummary(selected.chain, (k, o) => t(`scheduling:${k}`, o ?? {}))}
            lines={latenessLines(selected.chain, (k, o) => t(`scheduling:${k}`, o ?? {}))}
            expandLabel={t('scheduling:lateness.expand')}
            collapseLabel={t('scheduling:lateness.collapse')}
          />
        </YStack>
      ) : null}
      {/* Firm at-risk → the two doors: "See options" (PRIMARY, the bounded costed card) + "Evaluate
          options" (SECONDARY, Copilot exploration anchored to the same result). Same on board + queue. */}
      {selected.status === 'at_risk' && selected.firmness === 'firm' ? (
        <XStack gap="$2">
          <AppButton variant="light" size="$3" onPress={() => runDiscussOptions(orderRef(selected))}>
            {t('exceptions:evaluateOptions')}
          </AppButton>
          <AppButton variant="primary" size="$3" onPress={() => runSeeOptions(orderRef(selected))}>
            {t('exceptions:seeOptions')}
          </AppButton>
        </XStack>
      ) : null}
    </YStack>
  ) : null

  // Show the detail in the popup on row selection (keyed on the id — content is a per-render snapshot,
  // so re-keying every render would loop the store). The modal scrim blocks the table while open, so
  // selection only changes via dismiss → no row→row race.
  const detailPopupOpenRef = useRef(false)
  useEffect(() => {
    if (!selected) {
      if (detailPopupOpenRef.current) hidePopup()
      return
    }
    // Drilled into an op → the shared op card (with a back to the rollup); else the order rollup.
    if (opCardContent) showPopup({ size: 'medium', content: opCardContent })
    else showPopup({ title: t('detail.title', { label: selected.label }), content: detailContent, size: 'medium' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-show only on selection / drill change; content is a snapshot
  }, [selectedId, drilledOpSeq])
  // Dismissed (overlay / escape / drag) → clear the row + drill so the same row can be reopened.
  // Fire only on the open→closed transition (a fresh selection's show() hasn't applied yet this render).
  useEffect(() => {
    const wasOpen = detailPopupOpenRef.current
    detailPopupOpenRef.current = Boolean(activePopup)
    if (wasOpen && !activePopup && selectedId) {
      setSelectedId(null)
      setDrilledOpSeq(null)
    }
  }, [activePopup, selectedId])
  // Don't leak the popup onto the next screen if the table unmounts while it's open.
  useEffect(() => () => { if (detailPopupOpenRef.current) hidePopup() }, [hidePopup])

  const filterOptions: { value: FilterValue; label: string }[] = [
    { value: 'all', label: `${t('filter.all')} · ${counts.total}` },
    { value: 'at_risk', label: `${t('filter.at_risk')} · ${counts.atRisk}` },
    { value: 'stranded', label: `${t('filter.stranded')} · ${counts.stranded}` },
    { value: 'in_progress', label: `${t('filter.in_progress')} · ${counts.inProgress}` },
    { value: 'scheduled', label: `${t('filter.scheduled')} · ${counts.scheduled}` },
    { value: 'completed', label: `${t('filter.completed')} · ${counts.completed}` },
  ]

  const columns: Column<WorkListRowDto>[] = [
    {
      key: 'status',
      label: t('col.status'),
      width: 116,
      sortable: true,
      sortValue: (r) => STATUS_RANK[r.status],
      render: (r) => (
        <StatusPill tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</StatusPill>
      ),
    },
    {
      key: 'label',
      label: t('col.order'),
      flex: 1.6,
      primary: true,
      sortable: true,
      sortValue: (r) => r.label,
      render: (r) => (
        <XStack
          gap="$1.5"
          alignItems="center"
        >
          <P
            size={3}
            weight="m"
            color="$textPrimary"
          >
            {r.label}
          </P>
          {/* Firm is the norm (no marker); only forecast orders carry a "tentative" symbol. */}
          {r.firmness === 'forecast' ? (
            <CircleDashed
              size={12}
              color="$textTertiary"
            />
          ) : null}
        </XStack>
      ),
    },
    {
      key: 'customer',
      label: t('col.customer'),
      flex: 1.3,
      sortable: true,
      sortValue: (r) => PRIORITY_RANK[r.priority],
      render: (r) => (
        <XStack
          gap="$1.5"
          alignItems="center"
        >
          <PriorityMark priority={r.priority} />
          <P
            size={3}
            color="$textPrimary"
          >
            {r.customerName}
          </P>
        </XStack>
      ),
    },
    {
      key: 'due',
      label: t('col.due'),
      width: 96,
      sortable: true,
      sortValue: (r) => r.requiredDate,
      render: (r) => fmtDay(r.requiredDate),
    },
    {
      key: 'planned',
      label: t('col.planned'),
      width: 128,
      sortable: true,
      sortValue: (r) => r.plannedEnd ?? '',
      render: (r) => fmtDayTime(r.plannedEnd),
    },
    {
      key: 'resource',
      label: t('col.resource'),
      flex: 1.2,
      render: (r) => r.resourceNames.join(', ') || '—',
    },
    {
      key: 'risk',
      label: t('col.risk'),
      flex: 1.6,
      render: (r) =>
        r.status === 'at_risk'
          ? r.chain
            ? latenessSummary(r.chain, (k, o) => t(`scheduling:${k}`, o ?? {}))
            : t(`scheduling:riskReason.${r.atRiskReason}`, { defaultValue: r.atRiskReason ?? '' })
          : '—',
    },
  ]

  return (
    <>
      <XStack
        flexWrap="wrap"
        gap="$3"
        alignItems="center"
        justifyContent="space-between"
      >
        <XStack
          gap="$3"
          alignItems="center"
          flexWrap="wrap"
        >
          <SegmentedControl<FilterValue>
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
          {/* Search field styled to match the app-shell top-bar search pill. */}
          <XStack
            alignItems="center"
            gap="$2"
            height={34}
            width={260}
            paddingHorizontal="$3"
            borderRadius="$6"
            borderWidth={1}
            borderColor="$borderColor"
            backgroundColor="$surface"
          >
            <Search
              size={16}
              color="$textSecondary"
            />
            <Input
              flex={1}
              value={search}
              onChangeText={setSearch}
              placeholder={t('searchPlaceholder')}
              borderWidth={0}
              backgroundColor="transparent"
              paddingHorizontal={0}
              height={32}
              fontSize="$4"
              color="$textPrimary"
              placeholderTextColor="$textSecondary"
              focusStyle={{ outlineWidth: 0, borderWidth: 0 }}
            />
          </XStack>
        </XStack>
        {/* Symbol legend (top-right) — keys the row markers without re-stating them per row. */}
        <XStack
          gap="$3"
          alignItems="center"
          flexWrap="wrap"
        >
          <XStack
            gap="$1"
            alignItems="center"
          >
            <TriangleAlert
              size={13}
              color="$danger"
            />
            <P
              size={5}
              color="$textTertiary"
            >
              {t('priority.critical')}
            </P>
          </XStack>
          <XStack
            gap="$1"
            alignItems="center"
          >
            <ArrowUp
              size={14}
              color="$warning"
            />
            <P
              size={5}
              color="$textTertiary"
            >
              {t('priority.high')}
            </P>
          </XStack>
          <XStack
            gap="$1"
            alignItems="center"
          >
            <CircleDashed
              size={12}
              color="$textTertiary"
            />
            <P
              size={5}
              color="$textTertiary"
            >
              {t('firmness.forecast')}
            </P>
          </XStack>
        </XStack>
      </XStack>

      <DataTable
        columns={columns}
        rows={filtered}
        isLoading={isLoading}
        onRowPress={(r) => {
          setDrilledOpSeq(null)
          setSelectedId((cur) => (cur === r.id ? null : r.id))
        }}
        emptyTitle={rows.length === 0 ? t('empty') : t('emptyFiltered')}
        minRowWidth={980}
        rowsMatchHeader
      />
    </>
  )
}

/**
 * Standalone Work List screen body — the page header + plant scope picker around the embeddable
 * {@link WorkListTable}. The board embeds the table directly (its plant/version is already chosen).
 */
export function WorkListContent() {
  const { t } = useTranslation('workList')
  const { data: plants = [] } = usePlants()
  const { plantId, setPlant } = usePlantSelection(plants)
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  // Deep-link filter (e.g. the scorecard's at-risk count → "?status=at_risk"); ignored if not a valid value.
  const statusParam = useSearchParams()?.get('status') ?? undefined
  const initialFilter = FILTER_VALUES.includes(statusParam as FilterValue) ? (statusParam as FilterValue) : undefined
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <YStack width={220}>
            <AppSelect
              options={plantOptions}
              value={plantId}
              onChange={setPlant}
              placeholder={t('plant')}
            />
          </YStack>
        }
      />
      <WorkListTable plantId={plantId ?? undefined} initialFilter={initialFilter} />
    </>
  )
}

/** Web Work List screen — body inside the desktop `AdminShell` chrome. */
export function WorkListScreen() {
  const { t } = useTranslation('workList')
  return (
    <AdminShell
      activeId="work-list"
      title={t('title')}
    >
      <WorkListContent />
    </AdminShell>
  )
}
