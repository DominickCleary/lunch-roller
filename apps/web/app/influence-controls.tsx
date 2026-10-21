'use client';

import { useEffect, useState } from 'react';
import type {
  BettingWindow,
  InfluencePosition,
  HealthLevel,
} from '@lunch/contracts';
import './influence-controls.css';
import { HealthBadge } from './health-label';

type InfluenceAction = 'boost' | 'reduce';
type Props = {
  placeId: string;
  placeName: string;
  healthLevel?: HealthLevel;
  position: InfluencePosition | undefined;
  window: BettingWindow | null;
  balance: number;
  boostCost: number;
  reduceCost: number;
  busy: boolean;
  identityReady: boolean;
  onChange: (placeId: string, action: InfluenceAction, change: 1 | -1) => void;
  onRefund: (placeId: string) => void;
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
  healthLevel,
  position,
  window,
  balance,
  boostCost,
  reduceCost,
  busy,
  identityReady,
  onChange,
  onRefund,
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
  const net = yourBoosts - yourReductions;
  const paused = window?.opensAt && now.getTime() < Date.parse(window.opensAt);
  const lockedTitle = paused
    ? `Opens at ${new Intl.DateTimeFormat('en-GB', { timeZone: window.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(window.opensAt!))} (${window.timezone})`
    : 'Locked';
  function control(action: InfluenceAction) {
    const cost = action === 'boost' ? boostCost : reduceCost;
    const towardZero = action === 'boost' ? net < 0 : net > 0;
    const title = closed
      ? lockedTitle
      : towardZero
        ? `Refund ${action === 'boost' ? 'reduction' : 'boost'} on ${placeName}`
        : `${action === 'boost' ? 'Boost' : 'Reduce'} ${placeName} for ${cost} tokens`;
    return (
      <IconAction
        kind={action}
        label={`${action === 'boost' ? 'Boost' : 'Reduce'} ${placeName}`}
        title={title}
        disabled={
          !identityReady || busy || closed || (!towardZero && balance < cost)
        }
        onClick={() => onChange(placeId, action, 1)}
      />
    );
  }

  return (
    <div
      className="influence-controls"
      aria-label={`${placeName} market positions`}
    >
      <div className="influence-place-heading">
        <div className="influence-place-title">
          <span className="odds-name" title={placeName}>
            {placeName}
          </span>
          <HealthBadge level={healthLevel} />
        </div>
        <div className="influence-market-counts" aria-label="Market positions">
          <span
            className="market-count team-count"
            title="Team boosts and reductions"
          >
            <span aria-label={`${boosts} boosts`}>↑{boosts}</span>{' '}
            <span aria-label={`${reductions} reductions`}>↓{reductions}</span>
          </span>
        </div>
      </div>
      <div
        className={`influence-stepper ${net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'}`}
        role="group"
        aria-label={`Your position on ${placeName}`}
        title={
          closed ? lockedTitle : `Your position: ${net > 0 ? '+' : ''}${net}`
        }
      >
        <div className="influence-position-buttons">
          {control('reduce')}
          <span
            className="influence-net"
            aria-live="polite"
            aria-label={`Your position: ${net > 0 ? '+' : ''}${net}`}
          >
            <strong className="influence-net-value">
              {net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '0'}
            </strong>
          </span>
          {control('boost')}
          <IconAction
            kind="refund"
            label={`Refund tokens for ${placeName}`}
            title="Refund tokens"
            disabled={
              !identityReady ||
              busy ||
              closed ||
              yourBoosts + yourReductions === 0
            }
            onClick={() => onRefund(placeId)}
          />
        </div>
      </div>
    </div>
  );
}

function IconAction({
  kind,
  label,
  title,
  disabled,
  onClick,
}: {
  kind: 'boost' | 'reduce' | 'refund';
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`influence-position-control icon-control ${kind}`}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {kind === 'refund' ? (
          <>
            <path d="M3 10a9 9 0 1 1 1 8" />
            <path d="M3 4v6h6" />
          </>
        ) : kind === 'boost' ? (
          <>
            <path d="m6 11 6-6 6 6M12 5v14" />
          </>
        ) : (
          <>
            <path d="m6 13 6 6 6-6M12 19V5" />
          </>
        )}
      </svg>
    </button>
  );
}
