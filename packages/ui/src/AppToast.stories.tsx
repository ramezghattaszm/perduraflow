import { ToastProvider, useToastController } from '@tamagui/toast'
import type { Meta, StoryObj } from '@storybook/react'
import type { ToastType } from '@perduraflow/config'
import { XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { AppToast } from './AppToast'
import { AppToastViewport } from './AppToastViewport'

/**
 * AppToast + AppToastViewport render together inside a ToastProvider. The demo
 * controller fires toasts by type; the styling comes from the shared toastConfig.
 */
const meta: Meta = {
  title: 'Feedback/Toast',
}
export default meta

type Story = StoryObj

function Trigger({ type, label }: { type: ToastType; label: string }) {
  const toast = useToastController()
  return (
    <AppButton
      onPress={() =>
        toast.show(label, { message: `This is a ${type} toast.`, customData: { type } })
      }
    >
      {label}
    </AppButton>
  )
}

export const Types: Story = {
  render: () => (
    <ToastProvider>
      <YStack gap="$3">
        <XStack gap="$3" flexWrap="wrap">
          <Trigger type="info" label="Info" />
          <Trigger type="success" label="Success" />
          <Trigger type="warning" label="Warning" />
          <Trigger type="error" label="Error" />
        </XStack>
      </YStack>
      <AppToast />
      <AppToastViewport />
    </ToastProvider>
  ),
}
