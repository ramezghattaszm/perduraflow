import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { YStack } from 'tamagui'
import { NotificationBell, type NotificationItem } from './NotificationBell'

const meta: Meta<typeof NotificationBell> = { title: 'Components/NotificationBell', component: NotificationBell }
export default meta
type Story = StoryObj<typeof NotificationBell>

const sample: NotificationItem[] = [
  { id: '1', title: 'Schedule published', body: 'Saltillo Stamping — week 24' },
  { id: '2', title: 'Capacity warning', body: 'Line 3 over 95% utilization' },
]

function Demo({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <YStack padding="$8" alignItems="flex-end">
      <NotificationBell open={open} onOpenChange={setOpen} items={items} />
    </YStack>
  )
}

export const Empty: Story = { render: () => <Demo items={[]} /> }
export const WithItems: Story = { render: () => <Demo items={sample} /> }
