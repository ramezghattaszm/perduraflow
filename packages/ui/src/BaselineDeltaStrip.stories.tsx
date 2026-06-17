import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { YStack } from 'tamagui'
import { BaselineDeltaStrip } from './BaselineDeltaStrip'

const meta: Meta<typeof BaselineDeltaStrip> = { title: 'WhatIf/BaselineDeltaStrip', component: BaselineDeltaStrip }
export default meta
type Story = StoryObj<typeof BaselineDeltaStrip>

/** Frozen-engine vs measured-historical arms, with an honest empty state on switch. */
export const Arms: Story = {
  render: () => {
    const [arm, setArm] = useState<'frozen' | 'historical' | 'empty'>('frozen')
    return (
      <YStack maxWidth={460} padding="$3">
        <BaselineDeltaStrip
          liveHeader="Live"
          baselineHeader="Baseline"
          deltaHeader="Δ"
          arms={[
            { id: 'frozen', label: 'Engine lift', active: arm === 'frozen', onPress: () => setArm('frozen') },
            { id: 'historical', label: 'Historical', active: arm === 'historical', onPress: () => setArm('historical') },
            { id: 'empty', label: 'No-history scope', active: arm === 'empty', onPress: () => setArm('empty') },
          ]}
          caption={arm === 'frozen' ? 'The lift our intelligence adds (not your manual process).' : 'Representative historical outcomes.'}
          empty={arm === 'empty'}
          emptyTitle="No historical baseline yet"
          emptyHint="This computes the moment a historian feeds recorded outcomes for this scope."
          rows={
            arm === 'frozen'
              ? [
                  { label: 'OTIF', live: '92%', baseline: '85%', delta: '+7%', tone: 'up' },
                  { label: 'Cost/unit', live: '$3.86', baseline: '$4.20', delta: '−$0.34', tone: 'up' },
                  { label: 'Late orders', live: '1', baseline: '3', delta: '−2', tone: 'up' },
                ]
              : [
                  { label: 'OTIF', live: '92%', baseline: '85%', delta: '+7%', tone: 'up' },
                  { label: 'Cost/unit', live: '$3.86', baseline: '$8.80', delta: '−$4.94', tone: 'up' },
                  { label: 'OEE', live: '—', baseline: '69%', delta: '—', tone: 'neutral' },
                ]
          }
        />
      </YStack>
    )
  },
}
