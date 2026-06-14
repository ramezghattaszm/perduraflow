'use client'

import { useState } from 'react'
import type { PlantDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  ConfirmDialog,
  DataTable,
  FormField,
  FormSheet,
  PageHeader,
  SelectField,
  StatusPill,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { usePlants, usePlantMutations } from '../../../hooks/useOrg'
import { AdminShell } from '../../shell/admin-shell'

interface PlantForm {
  name: string
  timezone: string
  region: string
  location: string
  status: 'active' | 'inactive'
}
const EMPTY: PlantForm = { name: '', timezone: '', region: '', location: '', status: 'active' }

/** Plants admin screen — CRUD over the tenant's producing sites (5.7). */
export function PlantsScreen() {
  const { t } = useTranslation('admin')
  const { data: plants = [], isLoading } = usePlants()
  const { create, update } = usePlantMutations()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PlantForm>(EMPTY)
  const set = (patch: Partial<PlantForm>) => setForm((f) => ({ ...f, ...patch }))

  const deactivate = () => {
    if (!editingId) return
    update.mutate(
      { id: editingId, body: { status: 'inactive' } },
      { onSuccess: () => { setConfirmOpen(false); setOpen(false) } },
    )
  }
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setForm(EMPTY)
    setOpen(true)
  }
  const openEdit = (p: PlantDto) => {
    setEditingId(p.id)
    setForm({ name: p.name, timezone: p.timezone, region: p.region ?? '', location: p.location ?? '', status: p.status })
    setOpen(true)
  }
  const submit = () => {
    const body = {
      name: form.name,
      timezone: form.timezone,
      region: form.region || null,
      location: form.location || null,
      status: form.status,
    }
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body }, { onSuccess })
    else create.mutate(body, { onSuccess })
  }

  return (
    <AdminShell activeId="plants">
      <PageHeader
        title={t('plants.title')}
        subtitle={t('plants.subtitle')}
        actions={<AppButton size="$3" onPress={openNew}>{t('actions.new')}</AppButton>}
      />
      <DataTable<PlantDto>
        isLoading={isLoading}
        rows={plants}
        onRowPress={openEdit}
        emptyTitle={t('plants.title')}
        columns={[
          { key: 'name', label: t('plants.fields.name'), flex: 2 },
          { key: 'timezone', label: t('plants.fields.timezone'), flex: 2 },
          { key: 'region', label: t('plants.fields.region') },
          {
            key: 'status',
            label: t('plants.fields.status'),
            render: (p) => (
              <StatusPill tone={p.status === 'active' ? 'active' : 'inactive'}>
                {p.status === 'active' ? t('common.active') : t('common.inactive')}
              </StatusPill>
            ),
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
        <AppInput label={t('plants.fields.name')} value={form.name} onChangeText={(v) => set({ name: v })} />
        <AppInput
          label={t('plants.fields.timezone')}
          value={form.timezone}
          onChangeText={(v) => set({ timezone: v })}
          placeholder="America/Mexico_City"
        />
        <AppInput label={t('plants.fields.region')} value={form.region} onChangeText={(v) => set({ region: v })} />
        <AppInput label={t('plants.fields.location')} value={form.location} onChangeText={(v) => set({ location: v })} />
        {editingId ? (
          <FormField label={t('plants.fields.status')}>
            <SelectField
              options={[
                { value: 'active', label: t('common.active') },
                { value: 'inactive', label: t('common.inactive') },
              ]}
              value={form.status}
              onChange={(v) => set({ status: (v as 'active' | 'inactive') ?? 'active' })}
            />
          </FormField>
        ) : null}
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
