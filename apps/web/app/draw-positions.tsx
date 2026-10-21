'use client';

import type { DrawInfluencePosition } from '@lunch/contracts';
import './draw-positions.css';

export function DrawPositions({
  positions,
  localDate,
}: {
  positions: DrawInfluencePosition[];
  localDate: string;
}) {
  const restaurants = new Map<
    string,
    { name: string; boosts: number; reductions: number }
  >();
  for (const position of positions) {
    const current = restaurants.get(position.placeId) ?? {
      name: position.placeName,
      boosts: 0,
      reductions: 0,
    };
    current.boosts += position.boosts;
    current.reductions += position.reductions;
    restaurants.set(position.placeId, current);
  }
  const rows = [...restaurants.entries()].sort(
    (a, b) => b[1].boosts + b[1].reductions - a[1].boosts - a[1].reductions,
  );
  const peak = Math.max(
    1,
    ...rows.map(([, row]) => row.boosts + row.reductions),
  );
  const status = positions.some((position) => position.status === 'staged')
    ? 'staged'
    : positions.some((position) => position.status === 'locked')
      ? 'locked'
      : 'committed';
  return (
    <section
      className="activity-panel draw-positions"
      aria-label="Draw influence positions"
    >
      <div className="activity-panel-heading">
        <div>
          <h3>Positions for the draw</h3>
          <p>
            Boosts and reductions still backing each restaurant for {localDate}.
            Withdrawn and refunded requests are excluded.
          </p>
        </div>
        {positions.length > 0 && (
          <span className={`position-state position-state-${status}`}>
            {status === 'staged'
              ? 'Staged · editable'
              : status === 'locked'
                ? 'Locked for draw'
                : 'Committed'}
          </span>
        )}
      </div>
      {positions.length ? (
        <>
          <div className="draw-position-bars">
            {rows.map(([id, row]) => (
              <div className="draw-position-row" key={id}>
                <strong>{row.name}</strong>
                <div className="draw-position-track" aria-hidden="true">
                  <span
                    className="position-support"
                    style={{ width: `${(row.boosts / peak) * 100}%` }}
                  />
                  <span
                    className="position-opposition"
                    style={{ width: `${(row.reductions / peak) * 100}%` }}
                  />
                </div>
                <span>
                  <b className="position-boost-count">↑ {row.boosts}</b> boosts{' '}
                  <b className="position-reduce-count">↓ {row.reductions}</b>{' '}
                  reductions
                </span>
              </div>
            ))}
          </div>
          <details className="draw-position-people">
            <summary>Who holds these positions?</summary>
            <div className="activity-table-scroll">
              <table className="bet-board">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Restaurant</th>
                    <th>Boosts</th>
                    <th>Reductions</th>
                    <th>Tokens</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {positions
                    .slice()
                    .sort(
                      (a, b) =>
                        a.participantName.localeCompare(b.participantName) ||
                        a.placeName.localeCompare(b.placeName),
                    )
                    .map((position) => (
                      <tr
                        key={`${position.participantId}:${position.placeId}:${position.status}`}
                      >
                        <td>{position.participantName}</td>
                        <td>{position.placeName}</td>
                        <td>{position.boosts}</td>
                        <td>{position.reductions}</td>
                        <td>
                          {position.boostTokens + position.reductionTokens}
                        </td>
                        <td>
                          {position.status === 'staged'
                            ? 'Staged'
                            : position.status === 'locked'
                              ? 'Locked'
                              : 'Committed'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="activity-empty">
          No outstanding boosts or reductions for this draw. The activity below
          retains purchases and refunds.
        </p>
      )}
      <p className="activity-chart-note">
        Staged positions resize the live wheel. They can be withdrawn until the
        betting cutoff, then lock in. Adding or banning a restaurant is final; a
        ban refunds its pending requests.
      </p>
    </section>
  );
}
