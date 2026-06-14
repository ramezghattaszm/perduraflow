'use client'

import { EmptyState, PageHeader, YStack } from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { AdminShell } from '../shell/admin-shell'

/**
 * Dashboard landing — the empty kernel registration point (D34/A6). Modules will
 * contribute dashboard tiles here; phase 0 ships the framework slot as a stub.
 */
export function DashboardScreen() {
  const { t } = useTranslation('admin')
  return (
    <AdminShell activeId="dashboard">
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      <YStack flex={1} minHeight={320}>
        <EmptyState icon="📊" title={t('dashboard.empty')} />
      </YStack>
    </AdminShell>
  )
}
