'use client';

import { useEffect, useState } from 'react';
import type { BettingWindow } from '@lunch/contracts';
import { countdownState, formatCountdown } from '../lib/countdown';
import { calendarDateLabel } from '../lib/date-label';

type Props = {
  localDate: string;
  drawTime: string;
  timezone: string;
  window: BettingWindow | null;
  fallbackCutoffMinutes: number;
  getServerNow: () => number;
  spinning: boolean;
};

export function CountdownBanner({
  localDate,
  drawTime,
  timezone,
  window,
  fallbackCutoffMinutes,
  getServerNow,
  spinning,
}: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = globalThis.setInterval(
      () => setTick((tick) => tick + 1),
      1000,
    );
    return () => globalThis.clearInterval(timer);
  }, []);

  const state = countdownState({
    now: getServerNow(),
    localDate,
    drawTime,
    timezone,
    window,
    fallbackCutoffMinutes,
  });
  const spinLabel = spinning
    ? 'THE WHEEL IS SPINNING'
    : state.drawDue
      ? 'SPIN DUE · WAITING FOR THE DRAW'
      : 'SPIN STARTS IN';

  return (
    <section
      className={`countdown-banner${spinning ? ' is-spinning' : ''}`}
      aria-label="Lunch draw countdowns"
      data-testid="countdown-banner"
    >
      <div className="countdown-banner-heading">
        <span className="countdown-eyebrow">NEXT LUNCH DRAW</span>
        <strong>
          {calendarDateLabel(localDate)}
          {' · '}
          {window?.localDate === localDate ? window.drawTime : drawTime}
        </strong>
      </div>
      <div className="countdown-timers">
        <div className="countdown-timer">
          <span className="countdown-eyebrow">
            {state.bettingClosed ? 'BETTING CLOSED' : 'BETS CLOSE IN'}
          </span>
          <strong
            className="countdown-value"
            data-testid="bet-cutoff-countdown"
            role="timer"
            aria-label={
              state.bettingClosed
                ? 'Betting is closed'
                : `Betting closes in ${formatCountdown(state.cutoffSeconds)}`
            }
            aria-live="off"
          >
            {state.bettingClosed
              ? 'CLOSED'
              : formatCountdown(state.cutoffSeconds)}
          </strong>
        </div>
        <div className="countdown-timer countdown-spin">
          <span className="countdown-eyebrow">{spinLabel}</span>
          <strong
            className="countdown-value"
            data-testid="spin-countdown"
            role="timer"
            aria-label={
              spinning
                ? 'The wheel is spinning now'
                : state.drawDue
                  ? 'The scheduled spin is due and waiting for the draw'
                  : `Spin starts in ${formatCountdown(state.drawSeconds)}`
            }
            aria-live="off"
          >
            {spinning
              ? 'LIVE'
              : state.drawDue
                ? 'DUE'
                : formatCountdown(state.drawSeconds)}
          </strong>
        </div>
      </div>
    </section>
  );
}
