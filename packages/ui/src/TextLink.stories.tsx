import type { Meta, StoryObj } from '@storybook/react'
import { XStack } from 'tamagui'
import { P } from './typography'
import { TextLink } from './TextLink'

const meta: Meta<typeof TextLink> = { title: 'Typography/TextLink', component: TextLink }
export default meta
type Story = StoryObj<typeof TextLink>

export const Inline: Story = {
  render: () => (
    <XStack gap="$2" alignItems="center">
      <P size={4} color="$textSecondary">
        Don't have an account?
      </P>
      <TextLink size={4} weight="b" onPress={() => {}}>
        Sign up
      </TextLink>
    </XStack>
  ),
}

export const Standalone: Story = {
  render: () => (
    <TextLink size={4} weight="m" onPress={() => {}}>
      Forgot password?
    </TextLink>
  ),
}
