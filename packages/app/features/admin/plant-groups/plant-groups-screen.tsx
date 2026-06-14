'use client'

import { useState } from 'react'
import type { PlantGroupDto, PlantGroupType } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  AppSwitch,
  ConfirmDialog,
  DataTable,
  FormField,
  FormSheet,
  P,
  PageHeader,
  SelectField,
  StatusPill,
  XStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { usePlantGroups, usePlantGroupMutations, usePlants } from '../../../hooks/useOrg'
import { AdminShell } from '../../shell/admin-shell'

const GROUP_TYPES: PlantGroupType[] = ['cluster', 'division', 'region', 'custom']

/** Plant groups admin screen — clusters/divisions/regions with member plants (D49). */
export function PlantGroupsScreen() {
  const { t } = useTranslation('admin')
  const { data: groups = [], isLoading } = usePlantGroups()
  const { data: plants = [] } = usePlants()
  const { create, update } = usePlantGroupMutations()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [groupType, setGroupType] = useState<PlantGroupType>('cluster')
  const [sharing, setSharing] = useState(false)
  const [members, setMembers] = useState<string[]>([])

  const deactivate = () => {
    if (!editingId) return
    update.mutate(
      { id: editingId, body: { isActive: false } },
      { onSuccess: () => { setConfirmOpen(false); setOpen(false) } },
    )
  }
  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))

  const openNew = () => {
    setEditingId(null)
    setName('')
    setGroupType('cluster')
    setSharing(false)
    setMembers([])
    setOpen(true)
  }
  const openEdit = (g: PlantGroupDto) => {
    setEditingId(g.id)
    setName(g.name)
    setGroupType(g.groupType)
    setSharing(g.allowsResourceSharing)
    setMembers(g.memberPlantIds)
    setOpen(true)
  }
  const submit = () => {
    const body = { name, groupType, allowsResourceSharing: sharing, memberPlantIds: members }
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body }, { onSuccess })
    else create.mutate(body, { onSuccess })
  }

  return (
    <AdminShell activeId="plant-groups">
      <PageHeader
        title={t('plantGroups.title')}
        subtitle={t('plantGroups.subtitle')}
        actions={<AppButton size="$3" onPress={openNew}>{t('actions.new')}</AppButton>}
      />
      <DataTable<PlantGroupDto>
        isLoading={isLoading}
        rows={groups}
        onRowPress={openEdit}
        emptyTitle={t('plantGroups.title')}
        columns={[
          { key: 'name', label: t('plantGroups.fields.name'), flex: 2 },
          { key: 'groupType', label: t('plantGroups.fields.groupType') },
          {
            key: 'memberPlantIds',
            label: t('plantGroups.fields.memberPlantIds'),
            render: (g) => <P size={4}>{g.memberPlantIds.length}</P>,
          },
          {
            key: 'isActive',
            label: t('common.status'),
            render: (g) => <StatusPill tone={g.isActive ? 'active' : 'inactive'}>{g.isActive ? t('common.active') : t('common.inactive')}</StatusPill>,
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
        <AppInput label={t('plantGroups.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('plantGroups.fields.groupType')}>
          <SelectField
            options={GROUP_TYPES.map((g) => ({ value: g, label: g }))}
            value={groupType}
            onChange={(v) => setGroupType((v as PlantGroupType) ?? 'cluster')}
          />
        </FormField>
        <FormField label={t('plantGroups.fields.allowsResourceSharing')}>
          <XStack alignItems="center" gap="$3">
            <AppSwitch checked={sharing} onCheckedChange={setSharing} />
            <P size={4} color="$textSecondary">
              {sharing ? t('common.active') : t('common.inactive')}
            </P>
          </XStack>
        </FormField>
        <FormField label={t('plantGroups.fields.memberPlantIds')}>
          <SelectField options={plantOptions} multiple value={members} onChange={setMembers} />
        </FormField>
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
