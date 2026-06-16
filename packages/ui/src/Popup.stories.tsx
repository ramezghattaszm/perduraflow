import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { AppButton } from './AppButton'
import { P } from './typography'
import { Popup } from './Popup'

const meta: Meta<typeof Popup> = { title: 'Overlays/Popup', component: Popup }
export default meta
type Story = StoryObj<typeof Popup>

export const Confirm: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <AppButton onPress={() => setOpen(true)}>Open</AppButton>
        <Popup
          open={open}
          onClose={() => setOpen(false)}
          title="Deactivate plant?"
          description="It will be hidden from new scheduling but kept for history."
          footer={
            <>
              <AppButton variant="light" size="$3" onPress={() => setOpen(false)}>
                Cancel
              </AppButton>
              <AppButton variant="danger" size="$3" onPress={() => setOpen(false)}>
                Deactivate
              </AppButton>
            </>
          }
        />
      </>
    )
  },
}

export const WithContent: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        title="Details"
        size="medium"
        footer={
          <AppButton size="$3" onPress={() => setOpen(false)}>
            Done
          </AppButton>
        }
      >
        <P size={3} color="$textSecondary">
          Arbitrary body content goes here — on small screens this same content renders as a bottom sheet.
        </P>
      </Popup>
    )
  },
}
