import { defaultEconomySettings } from '@lunch/contracts'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ComponentProps } from 'react'
import { RestaurantSidebar } from './restaurant-sidebar'

type SidebarProps = ComponentProps<typeof RestaurantSidebar>

const marketWindow: NonNullable<SidebarProps['window']> = {
  localDate: '2299-04-21',
  timezone: 'Europe/Dublin',
  drawTime: '11:30',
  cutoffMinutes: 10,
  cutoffLocalDate: '2299-04-21',
  cutoffLocalTime: '11:20',
  cutoffAt: '2299-04-21T10:20:00.000Z',
  open: true,
}

const economy: SidebarProps['economy'] = {
  ...defaultEconomySettings,
}

const actions: Pick<
  SidebarProps,
  'onRetry' | 'onChangeInfluence' | 'onRefund' | 'onBanish' | 'onAddPlace'
> = {
  onRetry: () => undefined,
  onChangeInfluence: () => undefined,
  onRefund: () => undefined,
  onBanish: () => undefined,
  onAddPlace: async () => true,
}

const meta = {
  title: 'Lunch Roller/Restaurant sidebar',
  component: RestaurantSidebar,
  args: {
    checkIns: [],
    window: marketWindow,
    economy,
    balance: 45,
    busy: false,
    influenceBusy: false,
    influenceError: '',
    identityReady: true,
    pausedMessage: '',
    ...actions,
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ width: 360, maxWidth: '100%' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RestaurantSidebar>

export default meta
type Story = StoryObj<typeof meta>

export const BalancedHealthMix: Story = {
  args: {
    odds: [
      {
        placeId: '7e97e826-2562-499c-befe-59488e8a05ae',
        name: 'Green Table',
        probability: 0.5,
        healthLevel: 'healthy',
      },
      {
        placeId: '8c933bae-7f31-4215-9810-f7e4d541de7f',
        name: 'Noodle House',
        probability: 0.35,
        healthLevel: 'balanced',
      },
      {
        placeId: 'caa0cb2e-1547-487a-a83d-12e780b9afec',
        name: 'Penny’s Pies',
        probability: 0.15,
        healthLevel: 'treat',
      },
    ],
    positions: [
      {
        placeId: '7e97e826-2562-499c-befe-59488e8a05ae',
        boosts: 3,
        reductions: 1,
        historicalBoosts: 0,
        historicalReductions: 0,
        yourBoosts: 1,
        yourReductions: 0,
      },
      {
        placeId: '8c933bae-7f31-4215-9810-f7e4d541de7f',
        boosts: 2,
        reductions: 2,
        historicalBoosts: 0,
        historicalReductions: 0,
        yourBoosts: 1,
        yourReductions: 1,
      },
      {
        placeId: 'caa0cb2e-1547-487a-a83d-12e780b9afec',
        boosts: 1,
        reductions: 3,
        historicalBoosts: 0,
        historicalReductions: 0,
        yourBoosts: 0,
        yourReductions: 1,
      },
    ],
    checkIns: [
      { placeId: '8c933bae-7f31-4215-9810-f7e4d541de7f', count: 4 },
      { placeId: 'caa0cb2e-1547-487a-a83d-12e780b9afec', count: 2 },
    ],
  },
}

export const OverboostedFavorite: Story = {
  args: {
    odds: [
      {
        placeId: '7e97e826-2562-499c-befe-59488e8a05ae',
        name: 'Green Table',
        probability: 0.82,
        healthLevel: 'healthy',
      },
      {
        placeId: '8c933bae-7f31-4215-9810-f7e4d541de7f',
        name: 'Noodle House',
        probability: 0.1,
        healthLevel: 'balanced',
      },
      {
        placeId: 'caa0cb2e-1547-487a-a83d-12e780b9afec',
        name: 'Penny’s Pies',
        probability: 0.08,
        healthLevel: 'treat',
      },
    ],
    positions: [
      {
        placeId: '7e97e826-2562-499c-befe-59488e8a05ae',
        boosts: 18,
        reductions: 1,
        historicalBoosts: 0,
        historicalReductions: 0,
        yourBoosts: 5,
        yourReductions: 0,
      },
      {
        placeId: '8c933bae-7f31-4215-9810-f7e4d541de7f',
        boosts: 1,
        reductions: 2,
        historicalBoosts: 0,
        historicalReductions: 0,
        yourBoosts: 0,
        yourReductions: 1,
      },
      {
        placeId: 'caa0cb2e-1547-487a-a83d-12e780b9afec',
        boosts: 0,
        reductions: 3,
        historicalBoosts: 0,
        historicalReductions: 0,
        yourBoosts: 0,
        yourReductions: 2,
      },
    ],
    checkIns: [
      { placeId: '7e97e826-2562-499c-befe-59488e8a05ae', count: 11 },
      { placeId: '8c933bae-7f31-4215-9810-f7e4d541de7f', count: 3 },
      { placeId: 'caa0cb2e-1547-487a-a83d-12e780b9afec', count: 2 },
    ],
  },
}
