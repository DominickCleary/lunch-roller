import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { HealthSelect } from './health-label'

const meta = {
  title: 'Lunch Roller/Health selector',
  component: HealthSelect,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HealthSelect>

export default meta
type Story = StoryObj<typeof meta>

export const NewPlaceDefault: Story = {
  args: {},
}

export const ExistingHealthyPlace: Story = {
  args: { value: 'healthy' },
}

export const Disabled: Story = {
  args: { value: 'balanced', disabled: true },
}
