import { ArrowDown, ArrowUp, Plus, X } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { AppInput } from './AppInput'
import { EmptyState } from './EmptyState'
import { FormField } from './FormField'
import { IconButton } from './IconButton'
import { SelectField, type SelectOption } from './SelectField'
import { H, P } from './typography'

/**
 * One editable operation row. `opSeq` is derived from order (10, 20, …) by the
 * editor, so callers only manage the meaningful fields.
 */
export interface OperationRow {
  resourceGroupId: string | null
  stdSetupTime: number
  stdCycleTime: number
  changeoverAttributeKey: string | null
}

/** Labels (i18n-resolved by the caller — `packages/ui` stays i18n-decoupled). */
export interface OperationsEditorLabels {
  heading: string
  add: string
  empty: string
  opSeq: string
  resourceGroup: string
  setup: string
  cycle: string
  changeover: string
}

/** Props for {@link OperationsEditor}. */
export interface OperationsEditorProps {
  value: OperationRow[]
  onChange: (rows: OperationRow[]) => void
  resourceGroupOptions: SelectOption[]
  /** Changeover attribute options (colour/material/gauge); deselect = none (null). */
  changeoverOptions: SelectOption[]
  labels: OperationsEditorLabels
}

/**
 * OperationsEditor — the routing master-detail body (UI shell/MD spec, FS5): an
 * ordered list of operation cards with add / reorder (up·down) / remove and
 * inline editing of resource group, std setup/cycle times, and the changeover
 * attribute key. Controlled (`value` / `onChange`); the screen owns persistence.
 * `op_seq` is kept in sync with order automatically.
 *
 * @example
 * <OperationsEditor value={ops} onChange={setOps}
 *   resourceGroupOptions={groups} changeoverOptions={keys} labels={labels} />
 */
export function OperationsEditor({
  value,
  onChange,
  resourceGroupOptions,
  changeoverOptions,
  labels,
}: OperationsEditorProps) {
  const patch = (i: number, p: Partial<OperationRow>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...p } : row)))

  const add = () =>
    onChange([...value, { resourceGroupId: null, stdSetupTime: 0, stdCycleTime: 0, changeoverAttributeKey: null }])

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    const tmp = next[i]!
    next[i] = next[j]!
    next[j] = tmp
    onChange(next)
  }

  return (
    <YStack gap="$3">
      <XStack alignItems="center" justifyContent="space-between">
        <H level={4}>{labels.heading}</H>
        <AppButton variant="ghost" size="$3" icon={Plus} onPress={add}>
          {labels.add}
        </AppButton>
      </XStack>

      {value.length === 0 ? (
        <EmptyState title={labels.empty} />
      ) : (
        value.map((row, i) => (
          <YStack
            key={i}
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius="$4"
            backgroundColor="$surface"
            padding="$4"
            gap="$3"
          >
            <XStack alignItems="center" justifyContent="space-between">
              <P size={3} weight="b" color="$primary">
                {labels.opSeq} {(i + 1) * 10}
              </P>
              <XStack gap="$1">
                <IconButton icon={ArrowUp} label="Move up" iconSize={16} onPress={() => move(i, -1)} />
                <IconButton icon={ArrowDown} label="Move down" iconSize={16} onPress={() => move(i, 1)} />
                <IconButton icon={X} label="Remove" iconSize={16} onPress={() => remove(i)} />
              </XStack>
            </XStack>

            <FormField label={labels.resourceGroup} required>
              <SelectField
                options={resourceGroupOptions}
                value={row.resourceGroupId}
                onChange={(v) => patch(i, { resourceGroupId: v })}
              />
            </FormField>

            <XStack gap="$3">
              <YStack flex={1}>
                <AppInput
                  label={labels.setup}
                  value={String(row.stdSetupTime)}
                  onChangeText={(t) => patch(i, { stdSetupTime: Number(t) || 0 })}
                  keyboardType="numeric"
                />
              </YStack>
              <YStack flex={1}>
                <AppInput
                  label={labels.cycle}
                  value={String(row.stdCycleTime)}
                  onChangeText={(t) => patch(i, { stdCycleTime: Number(t) || 0 })}
                  keyboardType="numeric"
                />
              </YStack>
            </XStack>

            <FormField label={labels.changeover}>
              <SelectField
                options={changeoverOptions}
                value={row.changeoverAttributeKey}
                onChange={(v) => patch(i, { changeoverAttributeKey: v })}
              />
            </FormField>
          </YStack>
        ))
      )}
    </YStack>
  )
}
