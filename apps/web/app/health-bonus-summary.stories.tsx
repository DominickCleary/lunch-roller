import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { HealthBonus } from '@lunch/contracts'
import { HealthBonusSummary } from './health-label'

const bonus: HealthBonus = {
  multiplier: 1.25,
  places: [
    {
      placeId: '2d5cd264-951c-4cf2-a785-236ae8bce2d7',
      name: 'Cafe North',
      probabilityBefore: 0.4,
      probabilityAfter: 0.454545,
    },
    {
      placeId: '87f2ae04-1886-4a12-bc23-fad7805c0a88',
      name: 'Noodle House',
      probabilityBefore: 0.3,
      probabilityAfter: 0.318182,
    },
  ],
}

const meta = {
  title: 'Lunch Roller/Health bonus summary',
  component: HealthBonusSummary,
  args: { bonus, winner: 'Pizza Palace' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof HealthBonusSummary>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoAffectedPlaces: Story = {
  args: { bonus: { ...bonus, places: [] } },
}
