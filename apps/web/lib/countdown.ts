import type { BettingWindow } from '@lunch/contracts'
import { scheduledInstant } from '@lunch/domain'

export type CountdownState = {
  cutoffAt: number
  drawAt: number
  cutoffSeconds: number
  drawSeconds: number
  bettingClosed: boolean
  drawDue: boolean
}

/** Uses the saved market cutoff when available and the configured local draw schedule. */
export function countdownState(args: {
  now: number
  localDate: string
  drawTime: string
  timezone: string
  window: BettingWindow | null
  fallbackCutoffMinutes: number
}): CountdownState {
  const market = args.window?.localDate === args.localDate ? args.window : null
  const drawAt = scheduledInstant(
    args.localDate,
    market?.drawTime ?? args.drawTime,
    market?.timezone ?? args.timezone,
  ).getTime()
  const savedCutoff =
    args.window?.localDate === args.localDate && args.window.cutoffAt
      ? Date.parse(args.window.cutoffAt)
      : Number.NaN
  const cutoffAt = Number.isFinite(savedCutoff)
    ? savedCutoff
    : drawAt -
      (args.window?.localDate === args.localDate
        ? args.window.cutoffMinutes
        : args.fallbackCutoffMinutes) *
        60_000
  return {
    cutoffAt,
    drawAt,
    cutoffSeconds: Math.max(0, Math.ceil((cutoffAt - args.now) / 1000)),
    drawSeconds: Math.max(0, Math.ceil((drawAt - args.now) / 1000)),
    bettingClosed: args.now >= cutoffAt,
    drawDue: args.now >= drawAt,
  }
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  const clock = [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  return days ? `${days}d ${clock}` : clock
}
