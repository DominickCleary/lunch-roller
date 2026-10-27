'use client'

import type { BettingWindow } from '@lunch/contracts'
import { useEffect, useState } from 'react'
import { countdownState, formatCountdown } from '../lib/countdown'
import { calendarDateLabel } from '../lib/date-label'

type Props = {
  localDate: string
  drawTime: string
  timezone: string
  window: BettingWindow | null
  fallbackCutoffMinutes: number
  getServerNow: () => number
  spinning: boolean
  winner?: { placeName: string; localDate: string } | null
}

export function CountdownBanner({
  localDate,
  drawTime,
  timezone,
  window,
  fallbackCutoffMinutes,
  getServerNow,
  spinning,
  winner,
}: Props) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = globalThis.setInterval(
      () => setTick((tick) => tick + 1),
      1000,
    )
    return () => globalThis.clearInterval(timer)
  }, [])

  const state = countdownState({
    now: getServerNow(),
    localDate,
    drawTime,
    timezone,
    window,
    fallbackCutoffMinutes,
  })
  const showingSpin = state.bettingClosed
  const label = showingSpin
    ? spinning
      ? 'THE WHEEL IS SPINNING'
      : state.drawDue
        ? 'SPIN DUE · WAITING FOR THE DRAW'
        : 'SPIN STARTS IN'
    : 'BETS CLOSE IN'
  const value = showingSpin
    ? spinning
      ? 'LIVE'
      : state.drawDue
        ? 'DUE'
        : formatCountdown(state.drawSeconds)
    : formatCountdown(state.cutoffSeconds)
  const accessibleValue = showingSpin
    ? spinning
      ? 'The wheel is spinning now'
      : state.drawDue
        ? 'The scheduled spin is due and waiting for the draw'
        : `Spin starts in ${formatCountdown(state.drawSeconds)}`
    : `Betting closes in ${formatCountdown(state.cutoffSeconds)}`

  return (
    <section
      className={`countdown-banner${spinning ? ' is-spinning' : ''}`}
      aria-label="Next lunch draw countdown"
      data-testid="countdown-banner"
    >
      {winner && !spinning && (
        <div className="countdown-winner" aria-label="Winning restaurant">
          <span aria-hidden="true">✦</span>
          <div>
            <span className="countdown-eyebrow">
              LAST WINNER · {winner.localDate}
            </span>
            <strong>{winner.placeName}</strong>
          </div>
        </div>
      )}
      <div className="countdown-banner-heading">
        <span className="countdown-eyebrow">NEXT LUNCH DRAW</span>
        <strong>
          {calendarDateLabel(localDate)}
          {' · '}
          {window?.localDate === localDate ? window.drawTime : drawTime}
        </strong>
      </div>
      <div className={`countdown-timer${showingSpin ? ' countdown-spin' : ''}`}>
        <span className="countdown-eyebrow">{label}</span>
        <strong
          className="countdown-value"
          data-testid={showingSpin ? 'spin-countdown' : 'bet-cutoff-countdown'}
          role="timer"
          aria-label={accessibleValue}
          aria-live="off"
        >
          {value}
        </strong>
      </div>
    </section>
  )
}
