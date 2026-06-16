'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'solito/navigation'
import type { RoutingDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  DataTable,
  FormField,
  Popup,
  P,
  PageHeader,
  SelectField,
  StatusPill,
} from '@perduraflow/ui'
import { Plus } from '@tamagui/lucide-icons'
import { translateError, useTranslation } from '../../../i18n'
import { useCanConfigure } from '../../../stores/auth.store'
import { getApiErrorCode } from '../../../utils/error'
import { useParts, useRoutings, useRoutingMutations } from '../../../hooks/useMasterData'
import { AdminShell } from '../../shell/admin-shell'

/** Routings list — create the header here, then edit header + operations on routings/[id] (FS5/FS8). */
export function RoutingsScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const canConfigure = useCanConfigure()
  const router = useRouter()
  const { data: routings = [], isLoading } = useRoutings()
  const { data: parts = [] } = useParts()
  const { create } = useRoutingMutations()

  const [open, setOpen] = useState(false)
  const [partId, setPartId] = useState<string | null>(null)
  const [name, setName] = useState('')

  const partName = useMemo(() => new Map(parts.map((p) => [p.id, p.partNo])), [parts])
  const partOptions = parts.map((p) => ({ value: p.id, label: p.partNo }))
  const formError = create.error ? translateError(getApiErrorCode(create.error)) : undefined

  const openNew = () => {
    setPartId(null)
    setName('')
    setOpen(true)
  }
  const submit = () => {
    if (!partId) return
    create.mutate(
      { partId, name, isPrimary: true, operations: [] },
      {
        onSuccess: (r) => {
          setOpen(false)
          router.push(`/admin/master-data/routings/${r.id}`)
        },
      }
    )
  }

  return (
    <AdminShell activeId="routings">
      <PageHeader
        title={t('routings.title')}
        subtitle={t('routings.subtitle')}
        actions={
          canConfigure ? (
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('admin:actions.new')}
          </AppButton>
          ) : undefined
        }
      />
      <DataTable<RoutingDto>
        isLoading={isLoading}
        rows={routings}
        onRowPress={(r) => router.push(`/admin/master-data/routings/${r.id}`)}
        emptyTitle={t('routings.title')}
        columns={[
          { key: 'name', label: t('routings.fields.name'), flex: 2, sortable: true },
          {
            key: 'partId',
            label: t('routings.fields.partId'),
            flex: 2,
            render: (r) => <P size={3}>{partName.get(r.partId) ?? '—'}</P>,
          },
          {
            key: 'operations',
            label: t('routings.operations.title'),
            render: (r) => <P size={3}>{r.operations.length}</P>,
          },
          {
            key: 'status',
            label: t('routings.fields.status'),
            render: (r) => (
              <StatusPill tone={r.status === 'active' ? 'active' : 'inactive'}>
                {r.status === 'active' ? t('admin:common.active') : t('admin:common.inactive')}
              </StatusPill>
            ),
          },
        ]}
      />
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin:actions.new')}
        size="medium"
        error={formError}
        footer={
          <>
            <AppButton variant="light" size="$3" onPress={() => setOpen(false)}>
              {t('admin:actions.cancel')}
            </AppButton>
            {canConfigure ? (
            <AppButton variant="primary" size="$3" loading={create.isPending} onPress={submit}>
              {t('admin:actions.create')}
            </AppButton>
            ) : null}
          </>
        }
      >
        <FormField label={t('routings.fields.partId')} required>
          <SelectField options={partOptions} value={partId} onChange={setPartId} />
        </FormField>
        <AppInput label={t('routings.fields.name')} value={name} onChangeText={setName} />
      </Popup>
    </AdminShell>
  )
}
