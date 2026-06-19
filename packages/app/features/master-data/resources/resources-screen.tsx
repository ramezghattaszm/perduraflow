'use client'

import { useMemo, useState } from 'react'
import type { ResourceDto, ResourceType } from '@perduraflow/contracts'
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
import { useResources, useResourceMutations } from '../../../hooks/useMasterData'
import { useCalendars, usePlants } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

/** Resources admin screen — machines/lines/cells; plant + calendar via org.read (MD14). */
export function ResourcesScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const canConfigure = useCanConfigure()
  const { data: resources = [], isLoading } = useResources()
  const { data: plants = [] } = usePlants()
  const { data: calendars = [] } = useCalendars()
  const { create, update } = useResourceMutations()
  const { show } = usePopup()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [resourceType, setResourceType] = useState<ResourceType | null>('line')
  const [plantId, setPlantId] = useState<string | null>(null)
  const [calendarId, setCalendarId] = useState<string | null>(null)
  const [rate, setRate] = useState('')
  const [rateUom, setRateUom] = useState('')
  const [runCostPerHour, setRunCostPerHour] = useState('')
  const [setupCost, setSetupCost] = useState('')
  const [overheadPerUnit, setOverheadPerUnit] = useState('')
  const [otCapMinutes, setOtCapMinutes] = useState('')

  const plantName = useMemo(() => new Map(plants.map((p) => [p.id, p.name])), [plants])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const calendarOptions = calendars.map((c) => ({ value: c.id, label: c.name }))
  const typeOptions = (['line', 'machine', 'cell', 'work_center'] as const).map((v) => ({
    value: v,
    label: t(`resources.types.${v}`),
  }))
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setName('')
    setResourceType('line')
    setPlantId(null)
    setCalendarId(null)
    setRate('')
    setRateUom('')
    setRunCostPerHour('')
    setSetupCost('')
    setOverheadPerUnit('')
    setOtCapMinutes('')
    setOpen(true)
  }
  const openEdit = (r: ResourceDto) => {
    setEditingId(r.id)
    setName(r.name)
    setResourceType(r.resourceType)
    setPlantId(r.plantId)
    setCalendarId(r.calendarId)
    setRate(r.rate?.toString() ?? '')
    setRateUom(r.rateUom ?? '')
    setRunCostPerHour(r.runCostPerHour?.toString() ?? '')
    setSetupCost(r.setupCost?.toString() ?? '')
    setOverheadPerUnit(r.overheadPerUnit?.toString() ?? '')
    setOtCapMinutes(r.otCapMinutes?.toString() ?? '')
    setOpen(true)
  }
  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
  const submit = () => {
    if (!resourceType || !plantId || !calendarId) return
    const body = {
      name,
      resourceType,
      plantId,
      calendarId,
      rate: num(rate),
      rateUom: rateUom.trim() || null,
      runCostPerHour: num(runCostPerHour),
      setupCost: num(setupCost),
      overheadPerUnit: num(overheadPerUnit),
      otCapMinutes: num(otCapMinutes),
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
          onPress: () => update.mutate({ id, body: { status: 'inactive' } }),
        },
      ],
    })
  }

  return (
    <AdminShell activeId="resources">
      <PageHeader
        title={t('resources.title')}
        subtitle={t('resources.subtitle')}
        actions={
          canConfigure ? (
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('admin:actions.new')}
          </AppButton>
          ) : undefined
        }
      />
      <DataTable<ResourceDto>
        isLoading={isLoading}
        rows={resources}
        onRowPress={openEdit}
        emptyTitle={t('resources.title')}
        columns={[
          { key: 'name', label: t('resources.fields.name'), flex: 2, sortable: true },
          {
            key: 'resourceType',
            label: t('resources.fields.resourceType'),
            sortable: true,
            render: (r) => t(`resources.types.${r.resourceType}`),
          },
          {
            key: 'plantId',
            label: t('resources.fields.plantId'),
            flex: 2,
            render: (r) => <P size={3}>{plantName.get(r.plantId) ?? '—'}</P>,
          },
          {
            key: 'status',
            label: t('resources.fields.status'),
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
        <AppInput label={t('resources.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('resources.fields.resourceType')} required>
          <SelectField
            options={typeOptions}
            value={resourceType}
            onChange={(v) => setResourceType(v as ResourceType | null)}
          />
        </FormField>
        <FormField label={t('resources.fields.plantId')} required>
          <SelectField options={plantOptions} value={plantId} onChange={setPlantId} />
        </FormField>
        <FormField label={t('resources.fields.calendarId')} required>
          <SelectField options={calendarOptions} value={calendarId} onChange={setCalendarId} />
        </FormField>
        <AppInput
          label={t('resources.fields.rate')}
          value={rate}
          onChangeText={setRate}
          keyboardType="numeric"
        />
        <AppInput label={t('resources.fields.rateUom')} value={rateUom} onChangeText={setRateUom} />
        <AppInput label={t('resources.fields.runCostPerHour')} value={runCostPerHour} onChangeText={setRunCostPerHour} keyboardType="numeric" />
        <AppInput label={t('resources.fields.setupCost')} value={setupCost} onChangeText={setSetupCost} keyboardType="numeric" />
        <AppInput label={t('resources.fields.overheadPerUnit')} value={overheadPerUnit} onChangeText={setOverheadPerUnit} keyboardType="numeric" />
        <AppInput label={t('resources.fields.otCapMinutes')} value={otCapMinutes} onChangeText={setOtCapMinutes} keyboardType="numeric" />
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
