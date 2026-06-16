import type { Meta, StoryObj } from '@storybook/react'
import { XStack } from 'tamagui'
import { Panel } from './Panel'
import { H, P } from './typography'

const meta: Meta<typeof Panel> = { title: 'Dashboard/Panel', component: Panel }
export default meta
type Story = StoryObj<typeof Panel>

export const Basic: Story = {
  render: () => (
    <Panel title="Next-shift readiness" maxWidth={320}>
      <H level={3} color="$success">
        100%
      </H>
      <P size={4} color="$textSecondary">
        effective coverage · 0 certification gaps
      </P>
    </Panel>
  ),
}

/** A 60 / 40 row — the Workforce coverage layout. */
export const SixtyForty: Story = {
  render: () => (
    <XStack gap="$4" flexWrap="wrap" alignItems="flex-start">
      <Panel title="Skills & certification coverage" flexGrow={3} flexBasis={360} minWidth={300}>
        <P size={3} color="$textSecondary">
          Full-bleed table + legend live here.
        </P>
      </Panel>
      <Panel title="Next-shift readiness" flexGrow={2} flexBasis={240} minWidth={240}>
        <H level={3} color="$warning">
          75%
        </H>
        <P size={4} color="$textSecondary">
          effective coverage · 1 certification gap
        </P>
      </Panel>
    </XStack>
  ),
}
