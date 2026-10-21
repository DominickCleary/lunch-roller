'use client';

import { useState } from 'react';
import type { BetView, TokenActivityEntry } from '@lunch/contracts';
import './token-history.css';

const entryLabels: Record<string, string> = {
  attendance: 'Lunch check-in',
  boost: 'Boosted',
  reduce: 'Anti-boosted',
  'boost-refund': 'Boost refunded',
  'reduce-refund': 'Reduction refunded',
  'add-place': 'Added a restaurant',
  'remove-place': 'Removed a restaurant',
  correction: 'Admin correction',
  'bet-stake': 'Reserved bet stake',
  'bet-release': 'Released bet stake',
  'bet-payout': 'Bet payout',
};

export function TokenEntryDescription({
  entry,
}: {
  entry: TokenActivityEntry;
}) {
  const label = entryLabels[entry.kind] ?? entry.kind.replaceAll('-', ' ');
  return (
    <span className="token-entry-description">
      <span className="token-entry-title">{label}</span>
      {entry.placeName && (
        <span className="token-entry-place">{entry.placeName}</span>
      )}
      {entry.betLocalDate && (
        <span className="token-entry-date">
          Draw {formatDrawDate(entry.betLocalDate)}
        </span>
      )}
      {entry.influenceLocalDate && (
        <span className="token-entry-date">
          Draw {formatDrawDate(entry.influenceLocalDate)}
        </span>
      )}
      {entry.reason && (
        <span className="token-entry-reason">{entry.reason}</span>
      )}
    </span>
  );
}

const betStatuses: Record<BetView['status'], string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function WalletBets({ bets }: { bets: BetView[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleBets = showAll ? bets : bets.slice(0, 5);

  return (
    <section className="token-bets" aria-label="Restaurant bets">
      <div className="token-bets-heading">
        <h4>Bets placed</h4>
        {bets.length > 5 && (
          <button
            type="button"
            className="ledger-toggle"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? 'Show recent bets' : 'Show all bets'}
          </button>
        )}
      </div>
      {bets.length ? (
        <ul className="token-bet-list">
          {visibleBets.map((bet) => (
            <li className="token-bet" key={bet.id}>
              <div className="token-bet-main">
                <strong>{bet.placeName}</strong>
                <span>{formatDrawDate(bet.localDate)}</span>
              </div>
              <div className="token-bet-detail">
                <span>
                  {bet.stake} token{bet.stake === 1 ? '' : 's'} staked
                </span>
                <span className={`token-bet-status token-bet-${bet.status}`}>
                  {betStatuses[bet.status]}
                </span>
                {bet.payout !== null && (
                  <span>
                    {bet.payout} token{bet.payout === 1 ? '' : 's'} paid out
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">No bets placed yet.</p>
      )}
    </section>
  );
}

function formatDrawDate(localDate: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00.000Z`));
}
