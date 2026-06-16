'use client'

import { useMemo, useState } from 'react'
import type { OperatorDto } from '@perduraflow/contracts'
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
import { useOperators, useOperatorMutations } from '../../../hooks/useMasterData'
import { usePlants } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

/** Operators admin screen — externally-sourced operator stubs (MD15); quals on the matrix. */
export function OperatorsScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const canConfigure = useCanConfigure()
  const { data: operators = [], isLoading } = useOperators()
  const { data: plants = [] } = usePlants()
  const { create, update } = useOperatorMutations()
  const { show } = usePopup()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [homePlantId, setHomePlantId] = useState<string | null>(null)
  const [laborRate, setLaborRate] = useState('')

  const plantName = useMemo(() => new Map(plants.map((p) => [p.id, p.name])), [plants])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setName('')
    setHomePlantId(null)
    setLaborRate('')
    setOpen(true)
  }
  const openEdit = (o: OperatorDto) => {
    setEditingId(o.id)
    setName(o.name)
    setHomePlantId(o.homePlantId)
    setLaborRate(o.laborRate?.toString() ?? '')
    setOpen(true)
  }
  const submit = () => {
    if (!homePlantId) return
    const body = {
      name,
      homePlantId,
      laborRate: laborRate.trim() === '' ? null : Number(laborRate),
    }
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body }, { onSuccess })
    else create.mutate(body, { onSuccess })
  }
  const confirmDeactivate = () => {
    if (!editingId) return
    const id = editingId
    setOpen(false)
    show({
      title: t('admin:actions.deactivate'),
      message: t('admin:common.deactivateConfirm'),
      buttons: [
        { text: t('admin:actions.cancel'), tone: 'light' },
        {
          text: t('admin:actions.deactivate'),
          tone: 'danger',
          onPress: () => update.mutate({ id, body: { isActive: false } }),
        },
      ],
    })
  }

  return (
    <AdminShell activeId="operators">
      <PageHeader
        title={t('operators.title')}
        subtitle={t('operators.subtitle')}
        actions={
          canConfigure ? (
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('admin:actions.new')}
          </AppButton>
          ) : undefined
        }
      />
      <DataTable<OperatorDto>
        isLoading={isLoading}
        rows={operators}
        onRowPress={openEdit}
        emptyTitle={t('operators.title')}
        columns={[
          { key: 'name', label: t('operators.fields.name'), flex: 2, sortable: true },
          {
            key: 'homePlantId',
            label: t('operators.fields.homePlantId'),
            flex: 2,
            render: (o) => <P size={3}>{plantName.get(o.homePlantId) ?? '—'}</P>,
          },
          {
            key: 'certificationIds',
            label: t('qualifications.title'),
            render: (o) => <P size={3}>{o.certificationIds.length}</P>,
          },
          {
            key: 'isActive',
            label: t('admin:common.status'),
            render: (o) => (
              <StatusPill tone={o.isActive ? 'active' : 'inactive'}>
                {o.isActive ? t('admin:common.active') : t('admin:common.inactive')}
              </StatusPill>
            ),
          },
        ]}
      />
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? t('admin:actions.edit') : t('admin:actions.new')}
        size="medium"
        error={formError}
        footer={
          <>
            <AppButton variant="light" size="$3" onPress={() => setOpen(false)}>
              {t('admin:actions.cancel')}
            </AppButton>
            {canConfigure ? (
            <AppButton
              variant="primary"
              size="$3"
              loading={create.isPending || update.isPending}
              onPress={submit}
            >
              {editingId ? t('admin:actions.save') : t('admin:actions.create')}
            </AppButton>
            ) : null}
          </>
        }
      >
        <AppInput label={t('operators.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('operators.fields.homePlantId')} required>
          <SelectField options={plantOptions} value={homePlantId} onChange={setHomePlantId} />
        </FormField>
        <AppInput
          label={t('operators.fields.laborRate')}
          value={laborRate}
          onChangeText={setLaborRate}
          keyboardType="numeric"
        />
        {editingId ? (
          canConfigure ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('admin:actions.deactivate')}
          </AppButton>
          ) : null
        ) : null}
      </Popup>
    </AdminShell>
  )
}
