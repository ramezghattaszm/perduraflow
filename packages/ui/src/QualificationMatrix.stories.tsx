import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { QualificationMatrix } from './QualificationMatrix'

const meta: Meta<typeof QualificationMatrix> = {
  title: 'MasterData/QualificationMatrix',
  component: QualificationMatrix,
}
export default meta
type Story = StoryObj<typeof QualificationMatrix>

const operators = [
  { id: 'o1', label: 'Ana Reyes' },
  { id: 'o2', label: 'Bruno Cruz' },
  { id: 'o3', label: 'Carla Díaz' },
]
const certs = [
  { id: 'c1', label: 'LEAK' },
  { id: 'c2', label: 'TORQUE' },
  { id: 'c3', label: 'CMM' },
]

function Demo() {
  const [on, setOn] = useState<Set<string>>(new Set(['o1:c1', 'o1:c2', 'o2:c3']))
  return (
    <YStack padding="$4">
      <QualificationMatrix
        rows={operators}
        cols={certs}
        rowHeader="Operator"
        emptyText="Add operators and certifications first."
        isOn={(r, c) => on.has(`${r}:${c}`)}
        onToggle={(r, c, next) =>
          setOn((prev) => {
            const copy = new Set(prev)
            if (next) copy.add(`${r}:${c}`)
            else copy.delete(`${r}:${c}`)
            return copy
          })
        }
      />
    </YStack>
  )
}

export const Default: Story = { render: () => <Demo /> }
