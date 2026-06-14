import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { SelectField, type SelectOption } from './SelectField'

const meta: Meta<typeof SelectField> = { title: 'Forms/SelectField', component: SelectField }
export default meta
type Story = StoryObj<typeof SelectField>

const OPTIONS: SelectOption[] = [
  { value: 'cluster', label: 'Cluster' },
  { value: 'division', label: 'Division' },
  { value: 'region', label: 'Region' },
  { value: 'custom', label: 'Custom' },
]

export const Single: Story = {
  render: () => {
    const [v, setV] = useState<string | null>('cluster')
    return <SelectField options={OPTIONS} value={v} onChange={setV} />
  },
}

export const Multiple: Story = {
  render: () => {
    const [v, setV] = useState<string[]>(['cluster', 'region'])
    return <SelectField options={OPTIONS} multiple value={v} onChange={setV} />
  },
}
