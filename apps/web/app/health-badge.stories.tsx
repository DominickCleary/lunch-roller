import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { HealthBadge } from './health-label'

const meta = {
  title: 'Lunch Roller/Health badge',
  component: HealthBadge,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HealthBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Treat: Story = {
  args: { level: 'treat' },
}

export const Balanced: Story = {
  args: { level: 'balanced' },
}

export const Healthy: Story = {
  args: { level: 'healthy' },
}

export const MissingRating: Story = {
  args: {},
  parameters: {
    docs: { description: { story: 'Legacy places have no badge.' } },
  },
}
