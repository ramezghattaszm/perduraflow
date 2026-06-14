'use client'

import { useMemo, useState } from 'react'
import type { DataScope, Role } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  AppSwitch,
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
import { useApprovalTiers, useRoles, useRoleMutations } from '../../../hooks/useAdmin'
import { usePlantGroups, usePlants } from '../../../hooks/useOrg'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

const DATA_SCOPES: DataScope[] = ['plant', 'plant_group', 'multi_plant', 'tenant']

/** Roles admin screen — D33 structure: data scope, scoped org refs (validated via org.read, O4), approval tier, configure. */
export function RolesScreen() {
  const { t } = useTranslation('admin')
  const { data: roles = [], isLoading } = useRoles()
  const { data: plants = [] } = usePlants()
  const { data: groups = [] } = usePlantGroups()
  const { data: tiers = [] } = useApprovalTiers()
  const { create, update } = useRoleMutations()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dataScope, setDataScope] = useState<DataScope>('plant')
  const [scopedPlantIds, setScopedPlantIds] = useState<string[]>([])
  const [scopedGroupIds, setScopedGroupIds] = useState<string[]>([])
  const [tierId, setTierId] = useState<string | null>(null)
  const [canConfigure, setCanConfigure] = useState(false)

  const tierName = useMemo(() => new Map(tiers.map((x) => [x.id, x.name])), [tiers])
  const plantOptions = plants.map((p) => ({ value: p.id, label: p.name }))
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }))
  const tierOptions = tiers.map((x) => ({ value: x.id, label: x.name }))

  const openNew = () => {
    setEditingId(null)
    setName('')
    setDataScope('plant')
    setScopedPlantIds([])
    setScopedGroupIds([])
    setTierId(null)
    setCanConfigure(false)
    setOpen(true)
  }
  const openEdit = (r: Role) => {
    setEditingId(r.id)
    setName(r.name)
    setDataScope(r.dataScope)
    setScopedPlantIds(r.scopedPlantIds)
    setScopedGroupIds(r.scopedPlantGroupIds)
    setTierId(r.approvalTierId)
    setCanConfigure(r.canConfigure)
    setOpen(true)
  }
  const submit = () => {
    const body = {
      name,
      dataScope,
      scopedPlantIds,
      scopedPlantGroupIds: scopedGroupIds,
      approvalTierId: tierId,
      canConfigure,
    }
    const onSuccess = () => setOpen(false)
    if (editingId) update.mutate({ id: editingId, body }, { onSuccess })
    else create.mutate(body, { onSuccess })
  }
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

  return (
    <AdminShell activeId="roles">
      <PageHeader
        title={t('roles.title')}
        subtitle={t('roles.subtitle')}
        actions={<AppButton size="$3" onPress={openNew}>{t('actions.new')}</AppButton>}
      />
      <DataTable<Role>
        isLoading={isLoading}
        rows={roles}
        onRowPress={openEdit}
        emptyTitle={t('roles.title')}
        columns={[
          { key: 'name', label: t('roles.fields.name'), flex: 2 },
          { key: 'dataScope', label: t('roles.fields.dataScope') },
          {
            key: 'approvalTierId',
            label: t('roles.fields.approvalTierId'),
            render: (r) => <P size={4}>{r.approvalTierId ? (tierName.get(r.approvalTierId) ?? '—') : '—'}</P>,
          },
          {
            key: 'canConfigure',
            label: t('roles.fields.canConfigure'),
            render: (r) =>
              r.canConfigure ? <StatusPill tone="active">✓</StatusPill> : <P size={4} color="$textSecondary">—</P>,
          },
          {
            key: 'isActive',
            label: t('common.status'),
            render: (r) => <StatusPill tone={r.isActive ? 'active' : 'inactive'}>{r.isActive ? t('common.active') : t('common.inactive')}</StatusPill>,
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
        <AppInput label={t('roles.fields.name')} value={name} onChangeText={setName} />
        <FormField label={t('roles.fields.dataScope')}>
          <SelectField
            options={DATA_SCOPES.map((d) => ({ value: d, label: d }))}
            value={dataScope}
            onChange={(v) => setDataScope((v as DataScope) ?? 'plant')}
          />
        </FormField>
        <FormField label={t('roles.fields.scopedPlantIds')}>
          <SelectField options={plantOptions} multiple value={scopedPlantIds} onChange={setScopedPlantIds} />
        </FormField>
        <FormField label={t('roles.fields.scopedPlantGroupIds')}>
          <SelectField options={groupOptions} multiple value={scopedGroupIds} onChange={setScopedGroupIds} />
        </FormField>
        <FormField label={t('roles.fields.approvalTierId')}>
          <SelectField options={tierOptions} value={tierId} onChange={setTierId} />
        </FormField>
        <FormField label={t('roles.fields.canConfigure')}>
          <XStack alignItems="center" gap="$3">
            <AppSwitch checked={canConfigure} onCheckedChange={setCanConfigure} />
            <P size={4} color="$textSecondary">
              {canConfigure ? t('common.active') : t('common.inactive')}
            </P>
          </XStack>
        </FormField>
        {editingId ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('actions.deactivate')}
          </AppButton>
        ) : null}
      </FormSheet>
    </AdminShell>
  )
}
