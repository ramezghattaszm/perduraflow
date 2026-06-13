import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { YStack } from 'tamagui'
import { OtpInput } from './OtpInput'

const meta: Meta<typeof OtpInput> = {
  title: 'Components/OtpInput',
  component: OtpInput,
}
export default meta

type Story = StoryObj<typeof OtpInput>

function Controlled({ length = 6, variant }: { length?: number; variant?: 'default' | 'ghost' }) {
  const [value, setValue] = useState('')
  return <OtpInput value={value} onChange={setValue} length={length} variant={variant} />
}

export const Default: Story = { render: () => <Controlled /> }

export const FourDigits: Story = { render: () => <Controlled length={4} /> }

export const Ghost: Story = { render: () => <Controlled variant="ghost" /> }

export const Prefilled: Story = {
  render: () => {
    const [value, setValue] = useState('1234')
    return (
      <YStack gap="$3">
        <OtpInput value={value} onChange={setValue} length={6} />
      </YStack>
    )
  },
}
