import type { AssignedOperatorDto } from '@perduraflow/contracts'
import { AppButton, AppSelect, P, XStack, YStack } from '@perduraflow/ui'
import { translateError, useTranslation } from '../../i18n'
import { getApiErrorCode } from '../../utils/error'
import { useOperators } from '../../hooks/useMasterData'
import { usePlants } from '../../hooks/useOrg'
import { useAssignOperator, useResourceOperatorAssignments, useUnassignOperator } from '../../hooks/useScheduling'
import { useToast } from '../../hooks/useToast'

/**
 * OperatorAssignControl — the planner **assign/switch operator** lever on a resource/lane (C5). Shows
 * the operator currently running the line and an `AppSelect` of active operators to assign/switch;
 * unassign reverts the line to standard. Writes the resource-grain `resource_operator_assignment` via
 * the product endpoint; the engine reacts on the next re-solve (no auto-solve), so it nudges "re-solve
 * to apply". Cross-plant is allowed (operators float between plants); the home plant is surfaced
 * informationally, never enforced. Double-booking an operator is rejected server-side (error toast).
 *
 * `planOperator` is who the COMMITTED plan actually ran with (from the version detail). Until you
 * re-solve, a switch leaves the plan stale, so the lever shows **plan → switched** (e.g. "Ana Reyes →
 * Juan") so you don't lose who the current version is running — with a one-click cancel back to the
 * plan's operator.
 */
export function OperatorAssignControl({
  plantId,
  resourceId,
  planOperator,
}: {
  plantId: string | undefined
  resourceId: string
  planOperator?: AssignedOperatorDto | null
}) {
  const { t } = useTranslation('scheduling')
  const { showToast } = useToast()
  const { data: assignments = [] } = useResourceOperatorAssignments(plantId)
  const { data: operators = [] } = useOperators()
  const { data: plants = [] } = usePlants()
  const assign = useAssignOperator(plantId)
  const unassign = useUnassignOperator(plantId)

  const current = assignments.find((a) => a.resourceId === resourceId)
  const currentOp = current ? operators.find((o) => o.id === current.operatorId) : undefined
  // A pending switch: the live assignment differs from the operator the committed plan ran with.
  const switched = (planOperator?.id ?? null) !== (current?.operatorId ?? null)
  const pct = (f: number) => Math.round(f * 100)
  const plantName = (id: string) => plants.find((p) => p.id === id)?.name ?? id
  // Where each operator currently is (this plant). An operator already on ANOTHER line can't be
  // double-booked, so its option is shown greyed + not selectable; its label names the line it's on.
  // (Cross-plant assignments aren't in this plant's read — the server still rejects those.)
  const assignedByOperator = new Map(assignments.map((a) => [a.operatorId, a]))
  // Only this plant's operators (by home plant) for now — cross-plant visibility is a later item. The
  // currently-assigned / plan operator is always kept (so a floated-in operator isn't missing from
  // their own line's list).
  const options = operators
    .filter((o) => o.isActive && (o.homePlantId === plantId || o.id === current?.operatorId || o.id === planOperator?.id))
    .map((o) => {
      const out = !o.available // not present next shift (sick / vacation / not scheduled) → can't run
      const a = assignedByOperator.get(o.id)
      const where = out ? t('operatorAssign.out') : a ? a.resourceName : t('operatorAssign.whereUnassigned')
      return {
        value: o.id,
        label: t('operatorAssign.option', { name: o.name, pct: pct(o.performanceFactor), where }),
        // Not selectable when OUT, or already on another line (double-booking). Shown greyed either way.
        disabled: out || (Boolean(a) && a!.resourceId !== resourceId),
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
  // Revert the line to the operator the committed plan ran with (or to standard if the plan had none).
  const onCancelSwitch = () => {
    const done = {
      onSuccess: () => showToast(t('operatorAssign.switchCancelled')),
      onError: (e: unknown) => showToast(translateError(getApiErrorCode(e)), { type: 'error' }),
    }
    if (planOperator) assign.mutate({ resourceId, operatorId: planOperator.id }, done)
    else if (current) unassign.mutate(current.id, done)
  }

  const busy = assign.isPending || unassign.isPending

  return (
    <YStack backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" padding="$4" gap="$3" width="100%">
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <P size={5} weight="b" caps color="$textTertiary">
          {t('operatorAssign.label')}
        </P>
        {switched ? (
          <AppButton variant="ghost" size="$3" onPress={onCancelSwitch} loading={busy}>
            {t('operatorAssign.cancelSwitch')}
          </AppButton>
        ) : current ? (
          <AppButton variant="ghost" size="$3" onPress={onUnassign} loading={unassign.isPending}>
            {t('operatorAssign.unassign')}
          </AppButton>
        ) : null}
      </XStack>

      {/* The operator name is the editable affordance: a dashed-underlined link that opens the operator
          dropdown on click. When a switch is pending (the live assignment differs from the committed
          plan's operator) it reads "plan → switched" so the plan's operator stays visible. */}
      <XStack alignItems="center" gap="$2" flexWrap="wrap" opacity={busy ? 0.6 : 1} pointerEvents={busy ? 'none' : 'auto'}>
        {switched ? (
          <>
            <P size={3} color="$textSecondary">
              {planOperator ? planOperator.name : t('operator.standardName')}
            </P>
            <P size={3} color="$textTertiary">
              →
            </P>
          </>
        ) : null}
        <AppSelect
          variant="inline"
          triggerLabel={current ? current.operatorName : t('operator.standardName')}
          options={options}
          value={current?.operatorId ?? null}
          onChange={onAssign}
          placeholder={t('operatorAssign.placeholder')}
        />
        {!switched && current && currentOp ? (
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
