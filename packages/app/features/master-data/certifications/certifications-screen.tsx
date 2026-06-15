'use client'

import { useState } from 'react'
import type { CertificationDto } from '@perduraflow/contracts'
import { AppButton, AppInput, DataTable, Popup, PageHeader, StatusPill } from '@perduraflow/ui'
import { Plus } from '@tamagui/lucide-icons'
import { translateError, useTranslation } from '../../../i18n'
import { getApiErrorCode } from '../../../utils/error'
import { useCertifications, useCertificationMutations } from '../../../hooks/useMasterData'
import { usePopup } from '../../../stores/popup.store'
import { AdminShell } from '../../shell/admin-shell'

/** Certifications admin screen — the skill/certification taxonomy (MD15). */
export function CertificationsScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const { data: certs = [], isLoading } = useCertifications()
  const { create, update } = useCertificationMutations()
  const { show } = usePopup()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const submitError = create.error ?? update.error
  const formError = submitError ? translateError(getApiErrorCode(submitError)) : undefined

  const openNew = () => {
    setEditingId(null)
    setCode('')
    setName('')
    setDescription('')
    setOpen(true)
  }
  const openEdit = (c: CertificationDto) => {
    setEditingId(c.id)
    setCode(c.code)
    setName(c.name)
    setDescription(c.description ?? '')
    setOpen(true)
  }
  const submit = () => {
    const body = { code, name, description: description.trim() || null }
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
    <AdminShell activeId="certifications">
      <PageHeader
        title={t('certifications.title')}
        subtitle={t('certifications.subtitle')}
        actions={
          <AppButton variant="ghost" size="$3" icon={Plus} onPress={openNew}>
            {t('admin:actions.new')}
          </AppButton>
        }
      />
      <DataTable<CertificationDto>
        isLoading={isLoading}
        rows={certs}
        onRowPress={openEdit}
        emptyTitle={t('certifications.title')}
        columns={[
          { key: 'code', label: t('certifications.fields.code'), sortable: true },
          { key: 'name', label: t('certifications.fields.name'), flex: 2, sortable: true },
          { key: 'description', label: t('certifications.fields.description'), flex: 2 },
          {
            key: 'isActive',
            label: t('certifications.fields.status'),
            render: (c) => (
              <StatusPill tone={c.isActive ? 'active' : 'inactive'}>
                {c.isActive ? t('admin:common.active') : t('admin:common.inactive')}
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
            <AppButton
              variant="primary"
              size="$3"
              loading={create.isPending || update.isPending}
              onPress={submit}
            >
              {editingId ? t('admin:actions.save') : t('admin:actions.create')}
            </AppButton>
          </>
        }
      >
        <AppInput label={t('certifications.fields.code')} value={code} onChangeText={setCode} />
        <AppInput label={t('certifications.fields.name')} value={name} onChangeText={setName} />
        <AppInput
          label={t('certifications.fields.description')}
          value={description}
          onChangeText={setDescription}
        />
        {editingId ? (
          <AppButton variant="danger" size="$3" onPress={confirmDeactivate}>
            {t('admin:actions.deactivate')}
          </AppButton>
        ) : null}
      </Popup>
    </AdminShell>
  )
}
