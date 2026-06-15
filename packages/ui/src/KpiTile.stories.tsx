import type { Meta, StoryObj } from '@storybook/react'
import { KpiTile, KpiTileRow } from './KpiTile'

const meta: Meta<typeof KpiTile> = { title: 'Metrics/KpiTile', component: KpiTile }
export default meta
type Story = StoryObj<typeof KpiTile>

export const Row: Story = {
  render: () => (
    <KpiTileRow>
      <KpiTile value="96.2%" label="On-time-in-full" caption="service level" trend="up" />
      <KpiTile value="$142" label="Cost / unit" caption="vs $148 baseline" trend="down" upIsGood={false} />
      <KpiTile value="78%" label="OEE" caption="A·P·Q blended" trend="up" />
    </KpiTileRow>
  ),
}
