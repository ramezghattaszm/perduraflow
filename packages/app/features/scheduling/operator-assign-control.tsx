import { AppButton, AppSelect, P, XStack, YStack } from '@perduraflow/ui'
import { translateError, useTranslation } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'
import { useOperators } from '../../hooks/useMasterData'
import { usePlants } from '../../hooks/useOrg'
import { useAssignOperator, useResourceOperatorAssignments, useUnassignOperator } from '../../hooks/useScheduling'
import { useToast } from '../../hooks/useToast'

/**
 * OperatorAssignControl — the planner **assign/switch operator** lever on a resource/lane (C5). Shows
 * the operator currently running the line (name · performance % · informational home plant), and an
 * `AppSelect` of active operators to assign/switch; unassign reverts the line to standard. Writes the
 * resource-grain `resource_operator_assignment` via the product endpoint; the engine reacts on the
 * next re-solve (no auto-solve), so it nudges "re-solve to apply". Cross-plant is allowed (operators
 * float between plants); the home plant is surfaced informationally, never enforced. Double-booking an
 * operator across lines is rejected server-side and surfaced as an error toast.
 */
export function OperatorAssignControl({ plantId, resourceId }: { plantId: string | undefined; resourceId: string }) {
  const { t } = useTranslation('scheduling')
  const { showToast } = useToast()
  const { data: assignments = [] } = useResourceOperatorAssignments(plantId)
  const { data: operators = [] } = useOperators()
  const { data: plants = [] } = usePlants()
  const assign = useAssignOperator(plantId)
  const unassign = useUnassignOperator(plantId)

  const current = assignments.find((a) => a.resourceId === resourceId)
  const currentOp = current ? operators.find((o) => o.id === current.operatorId) : undefined
  const pct = (f: number) => Math.round(f * 100)
  const plantName = (id: string) => plants.find((p) => p.id === id)?.name ?? id
  // Where each operator currently is (this plant). An operator already on ANOTHER line can't be
  // double-booked, so its option is shown greyed + not selectable; its label names the line it's on.
  // (Cross-plant assignments aren't in this plant's read — the server still rejects those.)
  const assignedByOperator = new Map(assignments.map((a) => [a.operatorId, a]))
  const options = operators
    .filter((o) => o.isActive)
    .map((o) => {
      const a = assignedByOperator.get(o.id)
      const where = a ? a.resourceName : t('operatorAssign.whereUnassigned')
      return {
        value: o.id,
        label: t('operatorAssign.option', { name: o.name, pct: pct(o.performanceFactor), where }),
        disabled: Boolean(a) && a!.resourceId !== resourceId,
      }
    })

  const onAssign = (operatorId: string) => {
    if (operatorId === current?.operatorId) return
    assign.mutate(
      { resourceId, operatorId },
      {
        onSuccess: () => showToast(t('operatorAssign.assigned')),
        onError: (e) => showToast(translateError(getApiErrorCode(e)), { type: 'error' }),
      },
    )
  }
  const onUnassign = () => {
    if (!current) return
    unassign.mutate(current.id, {
      onSuccess: () => showToast(t('operatorAssign.unassigned')),
      onError: (e) => showToast(translateError(getApiErrorCode(e)), { type: 'error' }),
    })
  }

  const busy = assign.isPending || unassign.isPending

  return (
    <YStack backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" padding="$4" gap="$3" width="100%">
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <P size={5} weight="b" caps color="$textTertiary">
          {t('operatorAssign.label')}
        </P>
        {current ? (
          <AppButton variant="ghost" size="$3" onPress={onUnassign} loading={unassign.isPending}>
            {t('operatorAssign.unassign')}
          </AppButton>
        ) : null}
      </XStack>

      {/* The operator name itself is the editable affordance: a dashed-underlined link that opens the
          operator dropdown on click (the dropdown stays on-screen — see AppSelect). */}
      <XStack alignItems="center" gap="$2" flexWrap="wrap" opacity={busy ? 0.6 : 1} pointerEvents={busy ? 'none' : 'auto'}>
        <AppSelect
          variant="inline"
          triggerLabel={current ? current.operatorName : t('operator.standardName')}
          options={options}
          value={current?.operatorId ?? null}
          onChange={onAssign}
          placeholder={t('operatorAssign.placeholder')}
        />
        {current && currentOp ? (
          <P size={4} color="$textSecondary">
            {t('operatorAssign.meta', { pct: pct(current.performanceFactor), plant: plantName(currentOp.homePlantId) })}
          </P>
        ) : null}
      </XStack>
      {!current ? (
        <P size={5} color="$textTertiary">
          {t('operatorAssign.none')}
        </P>
      ) : null}
      <P size={5} color="$textTertiary">
        {t('operatorAssign.reSolveHint')}
      </P>
    </YStack>
  )
}
