'use client';

import { useEffect, useState } from 'react';
import type { BettingWindow, InfluencePosition } from '@lunch/contracts';
import { calendarDateLabel } from '../lib/date-label';
import './influence-controls.css';

type InfluenceAction = 'boost' | 'reduce';
type Props = {
  placeId: string;
  placeName: string;
  position: InfluencePosition | undefined;
  window: BettingWindow | null;
  balance: number;
  boostCost: number;
  reduceCost: number;
  busy: boolean;
  identityReady: boolean;
  onChange: (placeId: string, action: InfluenceAction, change: 1 | -1) => void;
};

function localMinute(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

export function InfluenceControls({
  placeId,
  placeName,
  position,
  window,
  balance,
  boostCost,
  reduceCost,
  busy,
  identityReady,
  onChange,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(new Date()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const cutoff = window
    ? `${window.cutoffLocalDate}T${window.cutoffLocalTime}`
    : '';
  const closed =
    !window?.open ||
    !window ||
    (window.cutoffAt
      ? now.getTime() >= new Date(window.cutoffAt).getTime()
      : localMinute(now, window.timezone) >= cutoff);
  const boosts = position?.boosts ?? 0;
  const reductions = position?.reductions ?? 0;
  const yourBoosts = position?.yourBoosts ?? 0;
  const yourReductions = position?.yourReductions ?? 0;
  const cutoffLabel = window
    ? `${calendarDateLabel(window.cutoffLocalDate)} at ${window.cutoffLocalTime} (${window.timezone})`
    : 'the betting cutoff';

  function control(action: InfluenceAction, change: 1 | -1) {
    const label = action === 'boost' ? 'boost' : 'reduction';
    const count = action === 'boost' ? yourBoosts : yourReductions;
    const cost = action === 'boost' ? boostCost : reduceCost;
    const adding = change === 1;
    return (
      <button
        key={`${action}-${change}`}
        type="button"
        className={`influence-position-control ${action}${adding ? '' : ' undo'}`}
        aria-label={
          adding
            ? `${action === 'boost' ? 'Boost' : 'Reduce'} ${placeName}`
            : `Undo ${label} on ${placeName}`
        }
        title={
          adding
            ? `${action === 'boost' ? 'Boost place' : 'Reduce place'} (${cost} tokens)`
            : `Undo ${label} on ${placeName}`
        }
        disabled={
          !identityReady ||
          busy ||
          closed ||
          (adding ? balance < cost : count < 1)
        }
        onClick={() => onChange(placeId, action, change)}
      >
        {adding
          ? action === 'boost'
            ? '+ Boost'
            : '+ Reduce'
          : `Undo ${action === 'boost' ? 'boost' : 'reduce'}`}
      </button>
    );
  }

  return (
    <div
      className="influence-controls"
      aria-label={`${placeName} market positions`}
    >
      <div className="influence-place-heading">
        <span className="odds-name">{placeName}</span>
        <div className="influence-market-counts" aria-label="Market positions">
          <span className="market-count team-count">
            Team <span aria-label={`${boosts} boosts`}>↑{boosts}</span>{' '}
            <span aria-label={`${reductions} reductions`}>↓{reductions}</span>
          </span>
          <span className="market-count your-count">
            You{' '}
            <span aria-label={`${yourBoosts} of your boosts`}>
              ↑{yourBoosts}
            </span>{' '}
            <span aria-label={`${yourReductions} of your reductions`}>
              ↓{yourReductions}
            </span>
          </span>
        </div>
      </div>
      <div className="influence-position-buttons">
        {control('boost', 1)}
        {control('boost', -1)}
        {control('reduce', 1)}
        {control('reduce', -1)}
      </div>
      <p className={`influence-market-state${closed ? ' locked' : ''}`}>
        {!window
          ? 'Loading positions…'
          : closed
            ? `Locked for draw · cutoff ${window.cutoffLocalTime}`
            : `Staged · editable until ${cutoffLabel}`}
      </p>
    </div>
  );
}
