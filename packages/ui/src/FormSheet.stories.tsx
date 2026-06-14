import type { Meta, StoryObj } from '@storybook/react'
import { AppInput } from './AppInput'
import { FormSheet } from './FormSheet'

const meta: Meta<typeof FormSheet> = { title: 'Forms/FormSheet', component: FormSheet }
export default meta
type Story = StoryObj<typeof FormSheet>

export const Open: Story = {
  args: {
    open: true,
    title: 'New plant',
    onSubmit: () => {},
    onCancel: () => {},
    children: <AppInput label="Name" placeholder="Saltillo Stamping" />,
  },
}
