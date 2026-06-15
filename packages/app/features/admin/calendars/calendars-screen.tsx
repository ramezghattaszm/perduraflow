'use client'

import { useMemo, useState } from 'react'
import type { CalendarDto } from '@perduraflow/contracts'
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
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { useCalendars, useCalendarMutations, usePlants } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { Plus } from '@tamagui/lucide-icons'
import { AdminShell } from '../../shell/admin-shell'

const parseJson = (text: string): unknown => {
  try {
    return text.trim() === '' ? [] : JSON.parse(text)
  } catch {
    return []
  }
}
const stringify = (v: unknown): string => JSON.stringify(v ?? [], null, 2)

/** Calendars admin screen — shift patterns/holidays/maintenance windows (D17; JSON editors, SKIP-52). */
export function CalendarsScreen() {
  const { t } = useTranslation('admin')
  const { data: calendars = [], isLoading } = useCalendars()
  const { data: plants = [] } = usePlants()
  const { create, update } = useCalendarMutations()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [plantId, setPlantId] = useState<string | null>(null)
  const [shifts, setShifts] = useState('[]')
  const [holidays, setHolidays] = useState('[]')
  const [maint, setMaint] = useState('[]')

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

  const plantName = useMemo(() => new Map(plants.map((p) => [p.id, p.name])), [plants])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))

  const openNew = () => {
    setEditingId(null)
    setName('')
    setPlantId(null)
    setShifts('[]')
    setHolidays('[]')
    setMaint('[]')
    setOpen(true)
  }
  const openEdit = (c: CalendarDto) => {
    setEditingId(c.id)
    setName(c.name)
    setPlantId(c.plantId)
    setShifts(stringify(c.shiftPatterns))
    setHolidays(stringify(c.holidays))
    setMaint(stringify(c.maintenanceWindows))
    setOpen(true)
  }
  const submit = () => {
    const body = {
      name,
      plantId,
      shiftPatterns: parseJson(shifts),
      holidays: parseJson(holidays),
      maintenanceWindows: parseJson(maint),
    }
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body }, { onSuccess })
    else create.mutate(body, { onSuccess })
  }

  return (
    <AdminShell activeId="calendars">
      <PageHeader
        title={t('calendars.title')}
        subtitle={t('calendars.subtitle')}
        actions={
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('actions.new')}
          </AppButton>
        }
      />
      <DataTable<CalendarDto>
        isLoading={isLoading}
        rows={calendars}
        onRowPress={openEdit}
        emptyTitle={t('calendars.title')}
        columns={[
          { key: 'name', label: t('calendars.fields.name'), flex: 2, sortable: true },
          {
            key: 'plantId',
            label: t('calendars.fields.plantId'),
            flex: 2,
            render: (c) => (
              <P size={4}>{c.plantId ? (plantName.get(c.plantId) ?? '—') : t('common.none')}</P>
            ),
          },
          {
            key: 'isActive',
            label: t('common.status'),
            render: (c) => (
              <StatusPill tone={c.isActive ? 'active' : 'inactive'}>
                {c.isActive ? t('common.active') : t('common.inactive')}
              </StatusPill>
            ),
          },
        ]}
      />
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? t('actions.edit') : t('actions.new')}
        dismissable
        error={formError}
        size="large"
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
        <AppInput label={t('calendars.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('calendars.fields.plantId')}>
          <SelectField options={plantOptions} value={plantId} onChange={setPlantId} />
        </FormField>
        <AppInput
          type="multiline"
          label={t('calendars.fields.shiftPatterns')}
          value={shifts}
          onChangeText={setShifts}
        />
        <AppInput
          type="multiline"
          label={t('calendars.fields.holidays')}
          value={holidays}
          onChangeText={setHolidays}
        />
        <AppInput
          type="multiline"
          label={t('calendars.fields.maintenanceWindows')}
          value={maint}
          onChangeText={setMaint}
        />
        {editingId ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('actions.deactivate')}
          </AppButton>
        ) : null}
      </Popup>
    </AdminShell>
  )
}
