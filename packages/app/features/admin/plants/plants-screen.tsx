'use client'

import { useState } from 'react'
import type { PlantDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  DataTable,
  FormField,
  Popup,
  PageHeader,
  SelectField,
  StatusPill,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { usePlants, usePlantMutations } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { Plus } from '@tamagui/lucide-icons'
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
  const { show } = usePopup()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PlantForm>(EMPTY)
  const set = (patch: Partial<PlantForm>) => setForm((f) => ({ ...f, ...patch }))

  const confirmDeactivate = () => {
    if (!editingId) return
    const id = editingId
    setOpen(false) // close the edit sheet first; the confirm popup stands alone
    show({
      title: t('actions.deactivate'),
      message: t('common.deactivateConfirm'),
      buttons: [
        { text: t('actions.cancel'), tone: 'light' },
        {
          text: t('actions.deactivate'),
          tone: 'danger',
          onPress: () => update.mutate({ id, body: { status: 'inactive' } }),
        },
      ],
    })
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
    setForm({
      name: p.name,
      timezone: p.timezone,
      region: p.region ?? '',
      location: p.location ?? '',
      status: p.status,
    })
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
        actions={
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('actions.new')}
          </AppButton>
        }
      />
      <DataTable<PlantDto>
        isLoading={isLoading}
        rows={plants}
        onRowPress={openEdit}
        emptyTitle={t('plants.title')}
        columns={[
          { key: 'name', label: t('plants.fields.name'), flex: 2, sortable: true },
          { key: 'timezone', label: t('plants.fields.timezone'), flex: 2, sortable: true },
          { key: 'region', label: t('plants.fields.region'), sortable: true },
          {
            key: 'status',
            label: t('plants.fields.status'),
            sortable: true,
            render: (p) => (
              <StatusPill tone={p.status === 'active' ? 'active' : 'inactive'}>
                {p.status === 'active' ? t('common.active') : t('common.inactive')}
              </StatusPill>
            ),
          },
        ]}
      />
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? t('actions.edit') : t('actions.new')}
        size="medium"
        error={formError}
        footer={
          <>
            <AppButton variant="light" size="$3" onPress={() => setOpen(false)}>
              {t('actions.cancel')}
            </AppButton>
            <AppButton
              variant="primary"
              size="$3"
              loading={create.isPending || update.isPending}
              onPress={submit}
            >
              {editingId ? t('actions.save') : t('actions.create')}
            </AppButton>
          </>
        }
      >
        <AppInput
          label={t('plants.fields.name')}
          value={form.name}
          onChangeText={(v) => set({ name: v })}
        />
        <AppInput
          label={t('plants.fields.timezone')}
          value={form.timezone}
          onChangeText={(v) => set({ timezone: v })}
          placeholder="America/Mexico_City"
        />
        <AppInput
          label={t('plants.fields.region')}
          value={form.region}
          onChangeText={(v) => set({ region: v })}
        />
        <AppInput
          label={t('plants.fields.location')}
          value={form.location}
          onChangeText={(v) => set({ location: v })}
        />
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
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('actions.deactivate')}
          </AppButton>
        ) : null}
      </Popup>
    </AdminShell>
  )
}
