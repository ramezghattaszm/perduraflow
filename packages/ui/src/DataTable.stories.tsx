import type { Meta, StoryObj } from '@storybook/react'
import { DataTable } from './DataTable'
import { StatusPill } from './StatusPill'

const meta: Meta = { title: 'Data/DataTable' }
export default meta
type Story = StoryObj

interface Row {
  id: string
  name: string
  region: string
  status: 'active' | 'inactive'
}
const rows: Row[] = [
  { id: '1', name: 'Saltillo Stamping', region: 'Coahuila', status: 'active' },
  { id: '2', name: 'Ramos Arizpe Molding', region: 'Coahuila', status: 'inactive' },
]

export const WithRows: Story = {
  render: () => (
    <DataTable<Row>
      columns={[
        { key: 'name', label: 'Name', flex: 2 },
        { key: 'region', label: 'Region' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill tone={r.status}>{r.status}</StatusPill> },
      ]}
      rows={rows}
      onRowPress={() => {}}
    />
  ),
}

export const Loading: Story = {
  render: () => <DataTable<Row> columns={[{ key: 'name', label: 'Name' }]} rows={[]} isLoading />,
}

export const Empty: Story = {
  render: () => (
    <DataTable<Row>
      columns={[{ key: 'name', label: 'Name' }]}
      rows={[]}
      emptyTitle="No plants yet"
      emptyMessage="Create your first plant."
    />
  ),
}
