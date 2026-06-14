import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { OperationsEditor, type OperationRow } from './OperationsEditor'

const meta: Meta<typeof OperationsEditor> = {
  title: 'MasterData/OperationsEditor',
  component: OperationsEditor,
}
export default meta
type Story = StoryObj<typeof OperationsEditor>

const labels = {
  heading: 'Operations',
  add: 'Add operation',
  empty: 'No operations yet — add the first one.',
  opSeq: 'Op',
  resourceGroup: 'Resource group',
  setup: 'Setup',
  cycle: 'Cycle',
  changeover: 'Changeover',
}
const groups = [
  { value: 'g1', label: 'Stamping presses' },
  { value: 'g2', label: 'Weld cells' },
]
const changeover = [
  { value: 'colour', label: 'Colour' },
  { value: 'material', label: 'Material' },
  { value: 'gauge', label: 'Gauge' },
]

function Demo({ initial }: { initial: OperationRow[] }) {
  const [value, setValue] = useState<OperationRow[]>(initial)
  return (
    <YStack padding="$4" maxWidth={640}>
      <OperationsEditor
        value={value}
        onChange={setValue}
        resourceGroupOptions={groups}
        changeoverOptions={changeover}
        labels={labels}
      />
    </YStack>
  )
}

export const Empty: Story = { render: () => <Demo initial={[]} /> }
export const WithOperations: Story = {
  render: () => (
    <Demo
      initial={[
        { resourceGroupId: 'g1', stdSetupTime: 30, stdCycleTime: 1.2, changeoverAttributeKey: 'colour' },
        { resourceGroupId: 'g2', stdSetupTime: 15, stdCycleTime: 0.8, changeoverAttributeKey: null },
      ]}
    />
  ),
}
