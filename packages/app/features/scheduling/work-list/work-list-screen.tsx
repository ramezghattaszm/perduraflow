'use client'

import { useMemo, useState } from 'react'
import { ArrowUp, CircleDashed, Search, TriangleAlert } from '@tamagui/lucide-icons'
import type { WorkListRowDto, WorkListStatus } from '@perduraflow/contracts'
import {
  AppSelect,
  type Column,
  DataTable,
  Input,
  LatenessChain,
  P,
  PageHeader,
  Panel,
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
import { useWorkList } from '../../../hooks/useScheduling'
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

/** Status → pill tone (single mapping; shared by the column cell + the detail ops). */
const STATUS_TONE: Record<WorkListStatus, StatusTone> = {
  completed: 'active',
  at_risk: 'danger',
  in_progress: 'neutral',
  scheduled: 'inactive',
}
/** Default sort weight — most-actionable first (matches the API's row order). */
const STATUS_RANK: Record<WorkListStatus, number> = {
  at_risk: 0,
  in_progress: 1,
  scheduled: 2,
  completed: 3,
}
const PRIORITY_RANK = { critical: 0, high: 1, standard: 2 } as const

/**
 * Priority as a symbol, not a word — only the exceptions are flagged: a red alert for `critical`,
 * an amber up-arrow for `high`, nothing for the (common) `standard`.
 */
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
}: { plantId: string | undefined; versionId?: string }) {
  const { t } = useTranslation(['workList', 'scheduling'])
  const { data, isLoading } = useWorkList(plantId, versionId)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const counts = data?.counts ?? { total: 0, completed: 0, atRisk: 0, inProgress: 0, scheduled: 0 }
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

  const filterOptions: { value: FilterValue; label: string }[] = [
    { value: 'all', label: `${t('filter.all')} · ${counts.total}` },
    { value: 'at_risk', label: `${t('filter.at_risk')} · ${counts.atRisk}` },
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
        onRowPress={(r) => setSelectedId((cur) => (cur === r.id ? null : r.id))}
        emptyTitle={rows.length === 0 ? t('empty') : t('emptyFiltered')}
        minRowWidth={980}
        rowsMatchHeader
      />

      {selected ? (
        <Panel title={t('detail.title', { label: selected.label })}>
          <YStack gap="$2">
            <P
              size={5}
              weight="b"
              caps
              color="$textTertiary"
            >
              {t('detail.ops')}
            </P>
            {selected.ops.map((o) => (
              <XStack
                key={o.opSeq}
                gap="$3"
                alignItems="center"
                flexWrap="wrap"
              >
                <StatusPill tone={STATUS_TONE[o.status]}>{t(`status.${o.status}`)}</StatusPill>
                <P
                  size={3}
                  weight="m"
                  color="$textPrimary"
                >
                  {t('detail.op', { opSeq: o.opSeq })} · {o.resourceName}
                </P>
                <P
                  size={4}
                  color="$textSecondary"
                >
                  {t('detail.planned', {
                    start: fmtDayTime(o.plannedStart),
                    end: fmtDayTime(o.plannedEnd),
                  })}
                </P>
              </XStack>
            ))}
            {selected.status === 'at_risk' && selected.chain ? (
              <LatenessChain
                title={t('detail.why')}
                summary={latenessSummary(selected.chain, (k, o) => t(`scheduling:${k}`, o ?? {}))}
                lines={latenessLines(selected.chain, (k, o) => t(`scheduling:${k}`, o ?? {}))}
                expandLabel={t('scheduling:lateness.expand')}
                collapseLabel={t('scheduling:lateness.collapse')}
              />
            ) : null}
          </YStack>
        </Panel>
      ) : null}
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
      <WorkListTable plantId={plantId ?? undefined} />
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
