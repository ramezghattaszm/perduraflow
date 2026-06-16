import { styled, XStack } from 'tamagui'
import { P } from './typography'

/**
 * SelectField — a chip-based picker that works identically on web and native
 * (no platform-specific dropdown). Single-select by default; `multiple` toggles
 * membership. Used for enum and reference pickers (group type, data scope,
 * customer→program, multi-plant scope). Keep option counts modest (phase 0).
 *
 * @example
 * <SelectField options={plants} value={ids} multiple onChange={setIds} />
 */
export interface SelectOption {
  value: string
  label: string
}

const Chip = styled(XStack, {
  name: 'SelectChip',
  alignItems: 'center',
  borderRadius: '$10',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderWidth: 1,
  cursor: 'pointer',
  variants: {
    selected: {
      true: { backgroundColor: '$primary', borderColor: '$primary' },
      false: { backgroundColor: '$surface', borderColor: '$borderColor' },
    },
  } as const,
  defaultVariants: { selected: false },
})

type SingleProps = {
  options: SelectOption[]
  multiple?: false
  value: string | null
  onChange: (value: string | null) => void
}
type MultiProps = {
  options: SelectOption[]
  multiple: true
  value: string[]
  onChange: (value: string[]) => void
}
export type SelectFieldProps = SingleProps | MultiProps

/**
 * Chip picker. Single-select clears when the selected chip is tapped again;
 * multi-select toggles membership.
 *
 * @example
 * <SelectField options={tiers} value={tierId} onChange={setTierId} />
 */
export function SelectField(props: SelectFieldProps) {
  const isSelected = (v: string) =>
    props.multiple ? props.value.includes(v) : props.value === v

  const toggle = (v: string) => {
    if (props.multiple) {
      const set = new Set(props.value)
      set.has(v) ? set.delete(v) : set.add(v)
      props.onChange([...set])
    } else {
      props.onChange(props.value === v ? null : v)
    }
  }

  return (
    <XStack gap="$2" flexWrap="wrap">
      {props.options.map((o) => {
        const selected = isSelected(o.value)
        return (
          <Chip key={o.value} selected={selected} onPress={() => toggle(o.value)}>
            <P size={4} weight="m" color={selected ? '$surface' : '$textPrimary'}>
              {o.label}
            </P>
          </Chip>
        )
      })}
    </XStack>
  )
}
