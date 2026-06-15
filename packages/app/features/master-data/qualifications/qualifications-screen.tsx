'use client'

import { useMemo } from 'react'
import { PageHeader, QualificationMatrix } from '@perduraflow/ui'
import { useTranslation } from '../../../i18n'
import { useCanConfigure } from '../../../stores/auth.store'
import { useCertifications, useOperators, useSetOperatorQualification } from '../../../hooks/useMasterData'
import { AdminShell } from '../../shell/admin-shell'

/** Qualifications matrix — operators × certifications, toggling operator_qualification (MD15, FS6). */
export function QualificationsScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const canConfigure = useCanConfigure()
  const { data: operators = [] } = useOperators()
  const { data: certs = [] } = useCertifications()
  const setQual = useSetOperatorQualification()

  const rows = operators.filter((o) => o.isActive).map((o) => ({ id: o.id, label: o.name }))
  const cols = certs.filter((c) => c.isActive).map((c) => ({ id: c.id, label: c.code }))

  // operatorId → Set of held certification ids
  const held = useMemo(
    () => new Map(operators.map((o) => [o.id, new Set(o.certificationIds)])),
    [operators],
  )

  return (
    <AdminShell activeId="qualifications">
      <PageHeader title={t('qualifications.title')} subtitle={t('qualifications.subtitle')} />
      <QualificationMatrix
        rows={rows}
        cols={cols}
        rowHeader={t('qualifications.operator')}
        emptyText={t('qualifications.empty')}
        readOnly={!canConfigure}
        isOn={(operatorId, certId) => held.get(operatorId)?.has(certId) ?? false}
        onToggle={(operatorId, certId, next) =>
          setQual.mutate({ operatorId, body: { certificationId: certId, qualified: next } })
        }
      />
    </AdminShell>
  )
}
