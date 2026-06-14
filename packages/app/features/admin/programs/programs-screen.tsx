'use client'

import { useMemo, useState } from 'react'
import type { ProgramDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  ConfirmDialog,
  DataTable,
  FormField,
  FormSheet,
  P,
  PageHeader,
  SelectField,
  StatusPill,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { useCustomers, usePrograms, useProgramMutations } from '../../../hooks/useOrg'
import { AdminShell } from '../../shell/admin-shell'

/** Programs admin screen — customer/vehicle programs with firm-fence override (5.7/D23). */
export function ProgramsScreen() {
  const { t } = useTranslation('admin')
  const { data: programs = [], isLoading } = usePrograms()
  const { data: customers = [] } = useCustomers()
  const { create, update } = useProgramMutations()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [fence, setFence] = useState('')

  const deactivate = () => {
    if (!editingId) return
    update.mutate(
      { id: editingId, body: { isActive: false } },
      { onSuccess: () => { setConfirmOpen(false); setOpen(false) } },
    )
  }
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const customerName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])
  const options = customers.map((c) => ({ value: c.id, label: c.name }))

  const openNew = () => {
    setEditingId(null)
    setName('')
    setCustomerId(null)
    setFence('')
    setOpen(true)
  }
  const openEdit = (p: ProgramDto) => {
    setEditingId(p.id)
    setName(p.name)
    setCustomerId(p.customerId)
    setFence(p.firmFenceDays?.toString() ?? '')
    setOpen(true)
  }
  const submit = () => {
    if (!customerId) return
    const fenceVal = fence.trim() === '' ? null : Number(fence)
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body: { name, customerId, firmFenceDays: fenceVal } }, { onSuccess })
    else create.mutate({ name, customerId, firmFenceDays: fenceVal }, { onSuccess })
  }

  return (
    <AdminShell activeId="programs">
      <PageHeader
        title={t('programs.title')}
        subtitle={t('programs.subtitle')}
        actions={<AppButton size="$3" onPress={openNew}>{t('actions.new')}</AppButton>}
      />
      <DataTable<ProgramDto>
        isLoading={isLoading}
        rows={programs}
        onRowPress={openEdit}
        emptyTitle={t('programs.title')}
        columns={[
          { key: 'name', label: t('programs.fields.name'), flex: 2 },
          {
            key: 'customerId',
            label: t('programs.fields.customerId'),
            flex: 2,
            render: (p) => <P size={4}>{customerName.get(p.customerId) ?? '—'}</P>,
          },
          { key: 'firmFenceDays', label: t('programs.fields.firmFenceDays') },
          {
            key: 'isActive',
            label: t('common.status'),
            render: (p) => <StatusPill tone={p.isActive ? 'active' : 'inactive'}>{p.isActive ? t('common.active') : t('common.inactive')}</StatusPill>,
          },
        ]}
      />
      <FormSheet
        open={open}
        title={editingId ? t('actions.edit') : t('actions.new')}
        submitting={create.isPending || update.isPending}
        submitLabel={editingId ? t('actions.save') : t('actions.create')}
        cancelLabel={t('actions.cancel')}
        error={formError}
        onCancel={() => setOpen(false)}
        onSubmit={submit}
      >
        <AppInput label={t('programs.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('programs.fields.customerId')} required>
          <SelectField options={options} value={customerId} onChange={setCustomerId} />
        </FormField>
        <AppInput
          label={t('programs.fields.firmFenceDays')}
          value={fence}
          onChangeText={setFence}
          keyboardType="number-pad"
        />
        {editingId ? (
          <AppButton variant="danger" size="$3" onPress={() => setConfirmOpen(true)}>
            {t('actions.deactivate')}
          </AppButton>
        ) : null}
      </FormSheet>
      <ConfirmDialog
        open={confirmOpen}
        title={t('actions.deactivate')}
        tone="danger"
        confirmLabel={t('actions.deactivate')}
        cancelLabel={t('actions.cancel')}
        submitting={update.isPending}
        onConfirm={deactivate}
        onCancel={() => setConfirmOpen(false)}
      />
    </AdminShell>
  )
}
