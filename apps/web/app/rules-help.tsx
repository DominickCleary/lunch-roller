'use client';

import { useRef, useState } from 'react';
import type { BettingWindow, TodayResponse } from '@lunch/contracts';
import { calendarDateLabel } from '../lib/date-label';
import './rules-help.css';

const weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const amount = (value: number) =>
  new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 17 }).format(
    value,
  );

export function RulesHelp({
  today,
  window: market,
  onRefresh,
}: {
  today: TodayResponse | null;
  window: BettingWindow | null;
  onRefresh: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const economy = today?.economy;
  const preferences = today?.preferences;
  const healthRule = today?.healthRule;
  return (
    <>
      <button
        type="button"
        className="rules-help-button"
        aria-label="Help"
        title="Help"
        aria-haspopup="dialog"
        onClick={() => {
          setError('');
          dialog.current?.showModal();
          void onRefresh().catch(() =>
            setError('Could not refresh the rules. Close and try again.'),
          );
        }}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.4 8.5a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2-2.6 3.5" />
          <path d="M12 16.5h.01" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        className="rules-dialog"
        aria-labelledby="rules-heading"
      >
        <header className="rules-header">
          <div>
            <p>How to play</p>
            <h2 id="rules-heading">Gambling about lunch rules</h2>
          </div>
          <button
            type="button"
            className="rules-close"
            aria-label="Close rules"
            title="Close"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <div className="rules-content">
          {error && <p role="alert">{error}</p>}
          {!today || !economy || !preferences ? (
            <p role="status">
              {error
                ? 'Current settings are unavailable.'
                : 'Loading current rules…'}
            </p>
          ) : (
            <>
              <section aria-labelledby="rules-wheel">
                <h3 id="rules-wheel">The wheel</h3>
                <p>
                  Draws run at{' '}
                  <strong>
                    {today.schedule.time} ({today.schedule.timezone})
                  </strong>{' '}
                  on{' '}
                  {today.schedule.weekdays
                    .map((day) => weekdays[day - 1])
                    .join(', ')}
                  . Each place’s chance comes from its relative weight. One
                  server draw decides the winner each scheduled day.
                </p>
                <p>
                  An administrator can skip the next roll for an office event.
                  Any open bets and staged influence for that date are refunded,
                  and the wheel moves on to the following scheduled roll.
                </p>
                <p>
                  The winner’s weight is <strong>halved</strong> for future
                  draws. Weights carry over without resetting. Spins last{' '}
                  <strong>{preferences.wheelSpinSeconds} seconds</strong>;
                  replay shows the same result and costs nothing. Close the
                  winner modal to return to the current wheel.
                </p>
                <p>
                  From <strong>{preferences.wheelSwitchTime}</strong>, the wheel
                  previews the next scheduled draw once today’s draw is
                  complete.
                </p>
              </section>
              <section aria-labelledby="rules-tokens">
                <h3 id="rules-tokens">Tokens and places</h3>
                <dl className="rules-values">
                  <div>
                    <dt>Check in</dt>
                    <dd>
                      <strong>
                        +{amount(economy.attendanceReward)} tokens
                      </strong>
                      , once per person after today’s draw and before midnight
                      in the draw’s timezone.
                    </dd>
                  </div>
                  <div>
                    <dt>Boost ↑</dt>
                    <dd>
                      <strong>
                        {amount(economy.boostCost)} tokens · ×
                        {amount(economy.boostMultiplier)} weight
                      </strong>{' '}
                      per step.
                    </dd>
                  </div>
                  <div>
                    <dt>Reduce ↓</dt>
                    <dd>
                      <strong>
                        {amount(economy.reduceCost)} tokens · ×
                        {amount(economy.reduceMultiplier)} weight
                      </strong>{' '}
                      per step.
                    </dd>
                  </div>
                  <div>
                    <dt>Add place</dt>
                    <dd>
                      <strong>{amount(economy.addPlaceCost)} tokens</strong>.
                      Starts at{' '}
                      <strong>
                        ×{amount(economy.newPlaceMultiplier)} the average active
                        weight
                      </strong>
                      . Adding a previously banished name restores it at this
                      starting weight.
                    </dd>
                  </div>
                  <div>
                    <dt>Banish ×</dt>
                    <dd>
                      <strong>{amount(economy.removePlaceCost)} tokens</strong>.
                      Banishes the place immediately and refunds everyone’s
                      pending boosts, reductions and bets on it. Adding and
                      banishing are final actions.
                    </dd>
                  </div>
                </dl>
                <p>
                  Your signed position is boosts or reductions, never both.
                  Boosting −2 makes it −1 and refunds the original reduction
                  price. Moving away from zero spends tokens; moving toward zero
                  refunds the original cost and reverses that step’s effect. The
                  refund arrow returns all your pending tokens on that place,
                  leaving your bet unchanged.
                </p>
                <p>
                  <strong>Boosts, reductions and bets share a cutoff.</strong>{' '}
                  {market
                    ? `For ${calendarDateLabel(market.localDate)}, changes close ${calendarDateLabel(market.cutoffLocalDate)} at ${market.cutoffLocalTime} (${market.timezone}).`
                    : `New markets close ${preferences.bettingCloseMinutes} minutes before the scheduled draw.`}{' '}
                  After the cutoff, positions lock. After the draw, influence
                  stays in the weights permanently.
                </p>
              </section>
              <section aria-labelledby="rules-health">
                <h3 id="rules-health">Health balance</h3>
                <p>
                  Places are rated{' '}
                  <span className="health-healthy">Healthy</span>, Balanced or{' '}
                  <span className="health-treat">Treat</span>. Choose a rating
                  when adding a place; admins can edit it.
                </p>
                <p>
                  {healthRule?.enabled ? (
                    <>
                      After a Treat place wins, active Healthy places receive{' '}
                      <strong>×{amount(healthRule.multiplier)} weight</strong>.
                      Balanced places get no bonus. Healthy or Balanced wins
                      trigger no health bonus. The winner is still halved.
                    </>
                  ) : healthRule ? (
                    <>
                      <strong>The health bonus is currently disabled.</strong>{' '}
                      Ratings do not currently add a weight bonus. The winner is
                      still halved. Configured bonus: ×
                      {amount(healthRule.multiplier)}.
                    </>
                  ) : (
                    'Current health settings are unavailable.'
                  )}
                </p>
                <p>
                  Weight multipliers change relative chances, not percentage
                  points. No tokens are spent on automatic bonuses.
                </p>
              </section>
              <section aria-labelledby="rules-betting">
                <h3 id="rules-betting">Bets and odds</h3>
                <p>
                  Choose one place and a whole-token stake for the next draw.
                  The stake is reserved immediately. Change or cancel your bet
                  before the cutoff to release the reserved tokens.
                </p>
                <p>
                  A winning bet returns{' '}
                  <strong>stake ÷ winning chance, rounded down</strong>,
                  including your stake. A losing bet loses its stake. Payout
                  uses the exact odds saved at the draw; the estimates change as
                  live odds change.
                </p>
                <p>
                  <strong>Odds</strong> are approximate fractional net odds: 4/1
                  means about 4 tokens profit for each token staked. Hover the
                  displayed odds for the exact percentage chance.
                </p>
              </section>
              <section aria-labelledby="rules-team">
                <h3 id="rules-team">Trading and activity</h3>
                <p>
                  <strong>Trade tokens</strong> transfers available tokens to
                  another active teammate, with no fee. Transfers are immediate
                  and final. Reserved tokens must be refunded or released before
                  you can trade them.
                </p>
                <p>
                  <strong>Activity</strong> shows spending, refunds, who
                  supports or opposes each place, and placed bets. Spending
                  charts show purchases before refunds; positions show the units
                  still held. Team token activity lets you inspect another
                  person’s wallet without changing your selected name.
                </p>
                <p>
                  Schedule changes refund pending influence and bets. Admin
                  weight or percentage overrides refund pending influence first.
                  Completed results and ledger history stay unchanged.
                </p>
              </section>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
