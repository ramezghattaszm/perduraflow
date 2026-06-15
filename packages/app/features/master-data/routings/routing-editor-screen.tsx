'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'solito/navigation'
import {
  AppButton,
  AppInput,
  AppSwitch,
  FormField,
  H,
  type OperationRow,
  OperationsEditor,
  P,
  PageHeader,
  Spinner,
  TextLink,
  YStack,
} from '@perduraflow/ui'
import { translateError, useTranslation } from '../../../i18n'
import { useCanConfigure } from '../../../stores/auth.store'
import { getApiErrorCode } from '../../../utils/error'
import { useParts, useResourceGroups, useRouting, useRoutingMutations } from '../../../hooks/useMasterData'
import { AdminShell } from '../../shell/admin-shell'

/**
 * Routing editor (routings/[id]) — master-detail: header card + the ordered
 * OperationsEditor, saved together (FS5). The operation set is replaced wholesale
 * on save; op_seq is derived from order.
 */
export function RoutingEditorScreen() {
  const { t } = useTranslation(['masterData', 'admin'])
  const canConfigure = useCanConfigure()
  const router = useRouter()
  const params = useParams() as { id?: string }
  const id = params?.id
  const { data: routing, isLoading } = useRouting(id)
  const { data: parts = [] } = useParts()
  const { data: groups = [] } = useResourceGroups()
  const { update } = useRoutingMutations()

  const [name, setName] = useState('')
  const [isPrimary, setIsPrimary] = useState(true)
  const [ops, setOps] = useState<OperationRow[]>([])

  useEffect(() => {
    if (!routing) return
    setName(routing.name)
    setIsPrimary(routing.isPrimary)
    setOps(
      routing.operations.map((o) => ({
        resourceGroupId: o.resourceGroupId,
        stdSetupTime: o.stdSetupTime,
        stdCycleTime: o.stdCycleTime,
        changeoverAttributeKey: o.changeoverAttributeKey,
      })),
    )
  }, [routing])

  const partNo = useMemo(() => parts.find((p) => p.id === routing?.partId)?.partNo ?? '—', [parts, routing])
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }))
  const changeoverOptions = (['colour', 'material', 'gauge'] as const).map((v) => ({ value: v, label: t(`changeoverKeys.${v}`) }))
  const formError = update.error ? translateError(getApiErrorCode(update.error)) : undefined

  const opLabels = {
    heading: t('routings.operations.title'),
    add: t('routings.operations.add'),
    empty: t('routings.operations.empty'),
    opSeq: t('routings.operations.fields.opSeq'),
    resourceGroup: t('routings.operations.fields.resourceGroupId'),
    setup: t('routings.operations.fields.stdSetupTime'),
    cycle: t('routings.operations.fields.stdCycleTime'),
    changeover: t('routings.operations.fields.changeoverAttributeKey'),
  }

  const save = () => {
    if (!id) return
    const operations = ops.map((o, i) => ({
      opSeq: (i + 1) * 10,
      resourceGroupId: o.resourceGroupId ?? '',
      stdSetupTime: o.stdSetupTime,
      stdCycleTime: o.stdCycleTime,
      changeoverAttributeKey: (o.changeoverAttributeKey as 'colour' | 'material' | 'gauge' | null) ?? null,
    }))
    update.mutate({ id, body: { name, isPrimary, operations } })
  }

  return (
    <AdminShell activeId="routings" maxWidth="large">
      <TextLink size={4} weight="m" onPress={() => router.push('/admin/master-data/routings')}>
        ← {t('routings.back')}
      </TextLink>
      {isLoading || !routing ? (
        <YStack padding="$6" alignItems="center">
          <Spinner color="$primary" />
        </YStack>
      ) : (
        <>
          <PageHeader
            title={routing.name}
            subtitle={`${t('routings.fields.partId')}: ${partNo}`}
            actions={
              canConfigure ? (
                <AppButton variant="primary" size="$3" loading={update.isPending} onPress={save}>
                  {t('admin:actions.save')}
                </AppButton>
              ) : undefined
            }
          />
          {formError ? (
            <P size={4} color="$danger">
              {formError}
            </P>
          ) : null}
          <YStack
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius="$4"
            backgroundColor="$surface"
            padding="$4"
            gap="$3"
          >
            <H level={5}>{t('routings.title')}</H>
            <AppInput label={t('routings.fields.name')} value={name} onChangeText={setName} />
            <FormField label={t('routings.fields.isPrimary')}>
              <AppSwitch checked={isPrimary} onCheckedChange={setIsPrimary} />
            </FormField>
          </YStack>
          <OperationsEditor
            value={ops}
            onChange={setOps}
            resourceGroupOptions={groupOptions}
            changeoverOptions={changeoverOptions}
            labels={opLabels}
          />
        </>
      )}
    </AdminShell>
  )
}
