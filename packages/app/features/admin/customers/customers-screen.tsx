'use client'

import { useState } from 'react'
import type { CustomerDto } from '@perduraflow/contracts'
import { AppButton, AppInput, DataTable, FormSheet, PageHeader, StatusPill } from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { useCustomers, useCustomerMutations } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

/** Customers admin screen — OEM customers + default firm fence (5.7/D23). */
export function CustomersScreen() {
  const { t } = useTranslation('admin')
  const { data: customers = [], isLoading } = useCustomers()
  const { create, update } = useCustomerMutations()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [fence, setFence] = useState('')

  const { show } = usePopup()

  const confirmDeactivate = () => {
    if (!editingId) return
    const id = editingId
    setOpen(false)
    show({
      title: t('actions.deactivate'),
      message: t('common.deactivateConfirm'),
      buttons: [
        { text: t('actions.cancel'), tone: 'light' },
        {
          text: t('actions.deactivate'),
          tone: 'danger',
          onPress: () => update.mutate({ id, body: { isActive: false } }),
        },
      ],
    })
  }
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setName('')
    setFence('')
    setOpen(true)
  }
  const openEdit = (c: CustomerDto) => {
    setEditingId(c.id)
    setName(c.name)
    setFence(c.firmFenceDays?.toString() ?? '')
    setOpen(true)
  }
  const submit = () => {
    const body = { name, firmFenceDays: fence.trim() === '' ? null : Number(fence) }
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body }, { onSuccess })
    else create.mutate(body, { onSuccess })
  }

  return (
    <AdminShell activeId="customers">
      <PageHeader
        title={t('customers.title')}
        subtitle={t('customers.subtitle')}
        actions={<AppButton size="$3" onPress={openNew}>{t('actions.new')}</AppButton>}
      />
      <DataTable<CustomerDto>
        isLoading={isLoading}
        rows={customers}
        onRowPress={openEdit}
        emptyTitle={t('customers.title')}
        columns={[
          { key: 'name', label: t('customers.fields.name'), flex: 2 },
          { key: 'firmFenceDays', label: t('customers.fields.firmFenceDays') },
          {
            key: 'isActive',
            label: t('common.status'),
            render: (c) => <StatusPill tone={c.isActive ? 'active' : 'inactive'}>{c.isActive ? t('common.active') : t('common.inactive')}</StatusPill>,
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
        <AppInput label={t('customers.fields.name')} value={name} onChangeText={setName} />
        <AppInput
          label={t('customers.fields.firmFenceDays')}
          value={fence}
          onChangeText={setFence}
          keyboardType="number-pad"
        />
        {editingId ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('actions.deactivate')}
          </AppButton>
        ) : null}
      </FormSheet>
    </AdminShell>
  )
}
