import type { Meta, StoryObj } from '@storybook/react'
import { AppInput } from './AppInput'
import { FormField } from './FormField'

const meta: Meta<typeof FormField> = { title: 'Forms/FormField', component: FormField }
export default meta
type Story = StoryObj<typeof FormField>

export const WithControl: Story = {
  args: { label: 'Region', required: true, children: <AppInput placeholder="Coahuila" /> },
}

export const WithError: Story = {
  args: { label: 'Region', error: 'Required', children: <AppInput /> },
}
