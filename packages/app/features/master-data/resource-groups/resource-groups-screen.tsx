'use client'

import { useMemo, useState } from 'react'
import type { ResourceGroupDto } from '@perduraflow/contracts'
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
import {
  useResourceGroups,
  useResourceGroupMutations,
  useResources,
} from '../../../hooks/useMasterData'
import { usePlants } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

/** Resource groups admin screen — interchangeable groupings; members multi-select (MD14). */
export function ResourceGroupsScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const canConfigure = useCanConfigure()
  const { data: groups = [], isLoading } = useResourceGroups()
  const { data: resources = [] } = useResources()
  const { data: plants = [] } = usePlants()
  const { create, update } = useResourceGroupMutations()
  const { show } = usePopup()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [plantId, setPlantId] = useState<string | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])

  const plantName = useMemo(() => new Map(plants.map((p) => [p.id, p.name])), [plants])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const resourceOptions = resources.map((r) => ({ value: r.id, label: r.name }))
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setName('')
    setPlantId(null)
    setMemberIds([])
    setOpen(true)
  }
  const openEdit = (g: ResourceGroupDto) => {
    setEditingId(g.id)
    setName(g.name)
    setPlantId(g.plantId)
    setMemberIds(g.memberResourceIds)
    setOpen(true)
  }
  const submit = () => {
    if (!plantId) return
    const body = { name, plantId, memberResourceIds: memberIds }
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
    <AdminShell activeId="resource-groups">
      <PageHeader
        title={t('resourceGroups.title')}
        subtitle={t('resourceGroups.subtitle')}
        actions={
          canConfigure ? (
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('admin:actions.new')}
          </AppButton>
          ) : undefined
        }
      />
      <DataTable<ResourceGroupDto>
        isLoading={isLoading}
        rows={groups}
        onRowPress={openEdit}
        emptyTitle={t('resourceGroups.title')}
        columns={[
          { key: 'name', label: t('resourceGroups.fields.name'), flex: 2, sortable: true },
          {
            key: 'plantId',
            label: t('resourceGroups.fields.plantId'),
            flex: 2,
            render: (g) => <P size={4}>{plantName.get(g.plantId) ?? '—'}</P>,
          },
          {
            key: 'memberResourceIds',
            label: t('resourceGroups.fields.memberResourceIds'),
            render: (g) => <P size={4}>{g.memberResourceIds.length}</P>,
          },
          {
            key: 'isActive',
            label: t('admin:common.status'),
            render: (g) => (
              <StatusPill tone={g.isActive ? 'active' : 'inactive'}>
                {g.isActive ? t('admin:common.active') : t('admin:common.inactive')}
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
        <AppInput label={t('resourceGroups.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('resourceGroups.fields.plantId')} required>
          <SelectField options={plantOptions} value={plantId} onChange={setPlantId} />
        </FormField>
        <FormField label={t('resourceGroups.fields.memberResourceIds')}>
          <SelectField
            options={resourceOptions}
            value={memberIds}
            multiple
            onChange={setMemberIds}
          />
        </FormField>
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
