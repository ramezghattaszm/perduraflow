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

/** Coverage skin (View 3): read-only tri-state + OUT pills + `*` markers. */
export const Coverage: Story = {
  render: () => {
    const held: Record<string, string[]> = { o1: ['c2'], o2: ['c3'], o3: [] }
    const present: Record<string, boolean> = { o1: true, o2: true, o3: false }
    const covered = (cid: string) => Object.keys(held).some((o) => present[o] && held[o]!.includes(cid))
    return (
      <YStack padding="$4">
        <QualificationMatrix
          rows={[
            { id: 'o1', label: 'Ana Reyes' },
            { id: 'o2', label: 'Bruno Cruz' },
            { id: 'o3', label: 'Jorge Morales', out: true },
          ]}
          cols={[
            { id: 'c1', label: 'LEAK', marked: true },
            { id: 'c2', label: 'TORQUE', marked: true },
            { id: 'c3', label: 'CMM' },
          ]}
          rowHeader="Operator"
          emptyText="No operators."
          isOn={() => false}
          onToggle={() => {}}
          cellState={(r, c) => (held[r]?.includes(c) ? 'on' : !covered(c) && present[r] ? 'gap' : 'off')}
        />
      </YStack>
    )
  },
}
