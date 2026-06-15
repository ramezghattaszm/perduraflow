'use client'

import { useMemo, useState } from 'react'
import type { AdminUser } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  AppSwitch,
  DataTable,
  FormField,
  Popup,
  P,
  PageHeader,
  SelectField,
  StatusPill,
  XStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { useCanConfigure } from '../../../stores/auth.store'
import { getApiErrorCode } from '../../../utils/error'
import { useAdminUsers, useRoles, useUserMutations } from '../../../hooks/useAdmin'
import { usePopup } from '../../../stores/popup.store'
import { Plus } from '@tamagui/lucide-icons'
import { AdminShell } from '../../shell/admin-shell'

/** Users admin screen — people in the tenant and the role assigned to each. */
export function UsersScreen() {
  const { t } = useTranslation('admin')
  const canConfigure = useCanConfigure()
  const { data: users = [], isLoading } = useAdminUsers()
  const { data: roles = [] } = useRoles()
  const { create, update } = useUserMutations()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState<string | null>(null)
  const [verified, setVerified] = useState(true)

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

  const roleName = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }))

  const openNew = () => {
    setEditingId(null)
    setName('')
    setEmail('')
    setPassword('')
    setRoleId(null)
    setVerified(true)
    setOpen(true)
  }
  const openEdit = (u: AdminUser) => {
    setEditingId(u.id)
    setName(u.name)
    setEmail(u.email)
    setPassword('')
    setRoleId(u.roleId)
    setVerified(u.isVerified)
    setOpen(true)
  }
  const submit = () => {
    const onSuccess = () => setOpen(false)
    if (editingId)
      update.mutate({ id: editingId, body: { name, roleId, isVerified: verified } }, { onSuccess })
    else create.mutate({ name, email, password, roleId, isVerified: verified }, { onSuccess })
  }

  return (
    <AdminShell activeId="users">
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          canConfigure ? (
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('actions.new')}
          </AppButton>
          ) : undefined
        }
      />
      <DataTable<AdminUser>
        isLoading={isLoading}
        rows={users}
        onRowPress={openEdit}
        emptyTitle={t('users.title')}
        columns={[
          { key: 'name', label: t('users.fields.name'), flex: 2, sortable: true },
          { key: 'email', label: t('users.fields.email'), flex: 2 },
          {
            key: 'roleId',
            label: t('users.fields.roleId'),
            render: (u) => <P size={4}>{u.roleId ? (roleName.get(u.roleId) ?? '—') : '—'}</P>,
          },
          {
            key: 'isVerified',
            label: t('users.fields.isVerified'),
            render: (u) =>
              u.isVerified ? (
                <StatusPill tone="active">✓</StatusPill>
              ) : (
                <P size={4} color="$textSecondary">
                  —
                </P>
              ),
          },
          {
            key: 'isActive',
            label: t('common.status'),
            render: (u) => (
              <StatusPill tone={u.isActive ? 'active' : 'inactive'}>
                {u.isActive ? t('common.active') : t('common.inactive')}
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
            {canConfigure ? (
            <AppButton
              variant="primary"
              size="$3"
              loading={create.isPending || update.isPending}
              onPress={submit}
            >
              {editingId ? t('actions.save') : t('actions.create')}
            </AppButton>
            ) : null}
          </>
        }
      >
        <AppInput label={t('users.fields.name')} value={name} onChangeText={setName} />
        {editingId ? null : (
          <>
            <AppInput
              type="email"
              label={t('users.fields.email')}
              value={email}
              onChangeText={setEmail}
            />
            <AppInput
              type="password"
              label={t('users.fields.password')}
              value={password}
              onChangeText={setPassword}
            />
          </>
        )}
        <FormField label={t('users.fields.roleId')}>
          <SelectField options={roleOptions} value={roleId} onChange={setRoleId} />
        </FormField>
        <FormField label={t('users.fields.isVerified')}>
          <XStack alignItems="center" gap="$3">
            <AppSwitch checked={verified} onCheckedChange={setVerified} />
            <P size={4} color="$textSecondary">
              {verified ? t('common.active') : t('common.inactive')}
            </P>
          </XStack>
        </FormField>
        {editingId ? (
          canConfigure ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('actions.deactivate')}
          </AppButton>
          ) : null
        ) : null}
      </Popup>
    </AdminShell>
  )
}
