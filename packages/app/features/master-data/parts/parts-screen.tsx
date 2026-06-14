'use client'

import { useState } from 'react'
import type { PartDto, PartType } from '@perduraflow/contracts'
import { AppButton, AppInput, DataTable, FormField, Popup, PageHeader, SelectField, StatusPill } from '@perduraflow/ui'
import { Plus } from '@tamagui/lucide-icons'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { useParts, usePartMutations } from '../../../hooks/useMasterData'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

/** Parts admin screen — part master core + the physical changeover-driver attributes (MD1/MD11). */
export function PartsScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const { data: parts = [], isLoading } = useParts()
  const { create, update } = usePartMutations()
  const { show } = usePopup()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [partNo, setPartNo] = useState('')
  const [description, setDescription] = useState('')
  const [partType, setPartType] = useState<PartType | null>('finished')
  const [uom, setUom] = useState('EA')
  const [material, setMaterial] = useState('')
  const [gauge, setGauge] = useState('')
  const [colour, setColour] = useState('')

  const typeOptions = (['finished', 'component', 'raw'] as const).map((v) => ({ value: v, label: t(`parts.types.${v}`) }))
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setPartNo('')
    setDescription('')
    setPartType('finished')
    setUom('EA')
    setMaterial('')
    setGauge('')
    setColour('')
    setOpen(true)
  }
  const openEdit = (p: PartDto) => {
    setEditingId(p.id)
    setPartNo(p.partNo)
    setDescription(p.description ?? '')
    setPartType(p.partType)
    setUom(p.uom)
    setMaterial(p.material ?? '')
    setGauge(p.gauge ?? '')
    setColour(p.colour ?? '')
    setOpen(true)
  }
  const submit = () => {
    if (!partType) return
    const body = {
      partNo,
      description: description.trim() || null,
      partType,
      uom,
      material: material.trim() || null,
      gauge: gauge.trim() || null,
      colour: colour.trim() || null,
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
        { text: t('admin:actions.deactivate'), tone: 'danger', onPress: () => update.mutate({ id, body: { status: 'inactive' } }) },
      ],
    })
  }

  return (
    <AdminShell activeId="parts">
      <PageHeader
        title={t('parts.title')}
        subtitle={t('parts.subtitle')}
        actions={<AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>{t('admin:actions.new')}</AppButton>}
      />
      <DataTable<PartDto>
        isLoading={isLoading}
        rows={parts}
        onRowPress={openEdit}
        emptyTitle={t('parts.title')}
        columns={[
          { key: 'partNo', label: t('parts.fields.partNo'), flex: 2, sortable: true },
          { key: 'description', label: t('parts.fields.description'), flex: 2 },
          { key: 'partType', label: t('parts.fields.partType'), sortable: true, render: (p) => t(`parts.types.${p.partType}`) },
          { key: 'uom', label: t('parts.fields.uom') },
          {
            key: 'status',
            label: t('parts.fields.status'),
            sortable: true,
            render: (p) => <StatusPill tone={p.status === 'active' ? 'active' : 'inactive'}>{p.status === 'active' ? t('admin:common.active') : t('admin:common.inactive')}</StatusPill>,
          },
        ]}
      />
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? t('admin:actions.edit') : t('admin:actions.new')}
        dismissable={false}
        error={formError}
        footer={
          <>
            <AppButton variant="light" size="$3" onPress={() => setOpen(false)}>{t('admin:actions.cancel')}</AppButton>
            <AppButton variant="primary" size="$3" loading={create.isPending || update.isPending} onPress={submit}>
              {editingId ? t('admin:actions.save') : t('admin:actions.create')}
            </AppButton>
          </>
        }
      >
        <AppInput label={t('parts.fields.partNo')} value={partNo} onChangeText={setPartNo} />
        <AppInput label={t('parts.fields.description')} value={description} onChangeText={setDescription} />
        <FormField label={t('parts.fields.partType')} required>
          <SelectField options={typeOptions} value={partType} onChange={(v) => setPartType(v as PartType | null)} />
        </FormField>
        <AppInput label={t('parts.fields.uom')} value={uom} onChangeText={setUom} />
        <AppInput label={t('parts.fields.material')} value={material} onChangeText={setMaterial} />
        <AppInput label={t('parts.fields.gauge')} value={gauge} onChangeText={setGauge} />
        <AppInput label={t('parts.fields.colour')} value={colour} onChangeText={setColour} />
        {editingId ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>{t('admin:actions.deactivate')}</AppButton>
        ) : null}
      </Popup>
    </AdminShell>
  )
}
