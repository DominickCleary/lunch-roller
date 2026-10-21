'use client';

import { useEffect, useMemo, useState } from 'react';
import { dailyActivityResponse, tokenOverviewResponse } from '@lunch/contracts';
import type {
  DailyActivityResponse,
  TokenActivityEntry,
  TokenOverviewResponse,
} from '@lunch/contracts';
import './daily-activity.css';
import { HealthBonusSummary } from './health-label';
import { DrawPositions } from './draw-positions';
import { approximateOdds } from '../lib/odds';

type ActivityResult = {
  key: string;
  data?: DailyActivityResponse;
  error?: string;
  refreshing: boolean;
};

export function TokenOverview({ participantId }: { participantId: string }) {
  const [data, setData] = useState<TokenOverviewResponse | null>(null);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!participantId) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/v1/token-overview', {
          headers: { 'X-Participant-Id': participantId },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Could not load token overview.');
        const next = tokenOverviewResponse.parse(await response.json());
        if (!controller.signal.aborted) {
          setData(next);
          setError('');
        }
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load token overview.',
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [participantId, retryCount]);

  return (
    <section
      className="activity-panel token-overview"
      aria-label="Token overview"
      aria-busy={!data}
    >
      <div className="activity-panel-heading">
        <div>
          <h3>Token standings</h3>
          <p>
            Current balances, ranked · net change today
            {data ? ` · ${data.localDate} ${data.timezone}` : ''}
          </p>
        </div>
        <span className="activity-live-indicator">Live · 30 sec</span>
      </div>
      {error && (
        <div className="activity-error" role="alert">
          <span>
            {error}
            {data ? ' Showing the last successful update.' : ''}
          </span>
          {!data && (
            <button
              className="button button-light"
              type="button"
              onClick={() => setRetryCount((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!data ? (
        <p className="activity-loading" role="status">
          {error
            ? 'Token overview is unavailable.'
            : 'Loading token standings…'}
        </p>
      ) : (
        <div className="token-overview-table-wrap">
          <table className="token-overview-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Member</th>
                <th scope="col">Tokens</th>
                <th scope="col">Today</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={row.participantId}>
                  <th scope="row" className="token-overview-rank">
                    {index + 1}
                  </th>
                  <td>{row.participantName}</td>
                  <td className="token-overview-balance">
                    {tokenCount(row.balance)}
                  </td>
                  <td>
                    <span
                      className={`token-overview-change ${row.todayDelta > 0 ? 'positive' : row.todayDelta < 0 ? 'negative' : 'neutral'}`}
                      aria-label={
                        row.todayDelta > 0
                          ? `Gained ${tokenCount(row.todayDelta)} tokens today`
                          : row.todayDelta < 0
                            ? `Lost ${tokenCount(Math.abs(row.todayDelta))} tokens today`
                            : 'No net token change today'
                      }
                    >
                      {row.todayDelta > 0
                        ? `↑ +${tokenCount(row.todayDelta)}`
                        : row.todayDelta < 0
                          ? `↓ −${tokenCount(Math.abs(row.todayDelta))}`
                          : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && (
            <p className="activity-empty">No active members yet.</p>
          )}
        </div>
      )}
    </section>
  );
}

type ActionEntry = DailyActivityResponse['entries'][number];
const emptyEntries: ActionEntry[] = [];

const actionLabel: Record<string, string> = {
  'transfer-sent': 'Sent tokens',
  'transfer-received': 'Received tokens',
  attendance: 'Check-in reward',
  boost: 'Boosted',
  reduce: 'Anti-boosted',
  'boost-refund': 'Withdrew a boost',
  'reduce-refund': 'Withdrew a reduction',
  'add-place': 'Added a restaurant',
  'remove-place': 'Banished a restaurant',
  correction: 'Balance correction',
  'bet-stake': 'Reserved a bet',
  'bet-release': 'Bet stake returned',
  'bet-payout': 'Winning payout',
};

const tokenCount = (value: number) =>
  new Intl.NumberFormat('en-GB').format(value);

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function kindTitle(entry: TokenActivityEntry) {
  return actionLabel[entry.kind] ?? entry.kind.replaceAll('-', ' ');
}

function ActivityTrend({
  entries,
  timezone,
}: {
  entries: ActionEntry[];
  timezone: string;
}) {
  const purchases = entries
    .filter((entry) => entry.kind === 'boost' || entry.kind === 'reduce')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!purchases.length)
    return (
      <p className="activity-empty">
        No influence purchases for this selection.
      </p>
    );
  const start = new Date(purchases[0]!.createdAt).getTime();
  const end = Math.max(
    start + 60_000,
    new Date(purchases[purchases.length - 1]!.createdAt).getTime(),
  );
  const points = [{ boost: 0, reduce: 0, time: start }];
  for (const entry of purchases) {
    const prior = points[points.length - 1]!;
    points.push({
      boost: prior.boost + (entry.kind === 'boost' ? Math.abs(entry.delta) : 0),
      reduce:
        prior.reduce + (entry.kind === 'reduce' ? Math.abs(entry.delta) : 0),
      time: new Date(entry.createdAt).getTime(),
    });
  }
  const timestamp = (time: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(time));
  const peak = Math.max(
    1,
    ...points.flatMap((point) => [point.boost, point.reduce]),
  );
  const x = (time: number) => 54 + ((time - start) / (end - start)) * 620;
  const y = (value: number) => 174 - (value / peak) * 142;
  const path = (key: 'boost' | 'reduce') =>
    points
      .map((point, index) =>
        index
          ? `H ${x(point.time)} V ${y(point[key])}`
          : `M ${x(point.time)} ${y(point[key])}`,
      )
      .join(' ') + ' H 674';

  return (
    <div className="activity-chart-scroll">
      <svg
        className="activity-trend-chart"
        viewBox="0 0 700 224"
        role="img"
        aria-labelledby="trend-title trend-desc"
      >
        <title id="trend-title">
          Cumulative boost and anti-boost tokens spent
        </title>
        <desc id="trend-desc">
          The lines show tokens spent in timestamp order for this selection,
          before refunds. They describe token actions, not restaurant odds or
          outstanding positions.
        </desc>
        {[0, 1, 2, 3].map((step) => {
          const value = Math.round((peak * step) / 3);
          const yPosition = y(value);
          return (
            <g key={step} className="activity-gridline">
              <line x1="54" x2="674" y1={yPosition} y2={yPosition} />
              <text x="46" y={yPosition + 4} textAnchor="end">
                {tokenCount(value)}
              </text>
            </g>
          );
        })}
        <text
          className="activity-axis-title"
          transform="translate(14 104) rotate(-90)"
          textAnchor="middle"
        >
          Tokens spent
        </text>
        {[0, 1, 2, 3, 4].map((step) => (
          <g key={step} className="activity-axis-label">
            <line
              x1={x(start + ((end - start) * step) / 4)}
              x2={x(start + ((end - start) * step) / 4)}
              y1="32"
              y2="176"
            />
            <text
              x={x(start + ((end - start) * step) / 4)}
              y="198"
              textAnchor={step === 0 ? 'start' : step === 4 ? 'end' : 'middle'}
            >
              {timestamp(start + ((end - start) * step) / 4)}
            </text>
          </g>
        ))}
        <path d={path('boost')} className="trend-boost-line" />
        <path d={path('reduce')} className="trend-reduce-line" />
      </svg>
      <p className="activity-chart-note">
        Cumulative tokens spent · workplace local time · boost and anti-boost
        purchases before refunds
      </p>
      <div className="activity-trend-legend" aria-hidden="true">
        <span>
          <i className="legend-boost" />
          Boosted
        </span>
        <span>
          <i className="legend-reduce" />
          Anti-boosted
        </span>
      </div>
      <table className="visually-hidden">
        <caption>
          Cumulative boost and anti-boost tokens spent after each purchase
        </caption>
        <thead>
          <tr>
            <th>Action time</th>
            <th>Boosted tokens</th>
            <th>Anti-boosted tokens</th>
          </tr>
        </thead>
        <tbody>
          {points.slice(1).map((point, index) => (
            <tr key={index}>
              <th>{timestamp(point.time)}</th>
              <td>{point.boost}</td>
              <td>{point.reduce}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RestaurantChart({ entries }: { entries: ActionEntry[] }) {
  const totals = new Map<
    string,
    { name: string; boost: number; reduce: number }
  >();
  for (const entry of entries) {
    if ((entry.kind !== 'boost' && entry.kind !== 'reduce') || !entry.placeId)
      continue;
    const current = totals.get(entry.placeId) ?? {
      name: entry.placeName ?? 'Archived restaurant',
      boost: 0,
      reduce: 0,
    };
    current[entry.kind] += Math.abs(entry.delta);
    totals.set(entry.placeId, current);
  }
  const rows = [...totals.entries()]
    .map(([placeId, totals]) => ({ placeId, ...totals }))
    .sort((a, b) => b.boost + b.reduce - a.boost - a.reduce);
  const peak = Math.max(1, ...rows.flatMap((row) => [row.boost, row.reduce]));
  if (!rows.length)
    return (
      <p className="activity-empty">
        No restaurant influence purchases for this day.
      </p>
    );
  return (
    <div
      className="restaurant-chart"
      role="group"
      aria-label="Boost and anti-boost tokens spent by restaurant"
    >
      {rows.map((row) => (
        <div className="restaurant-chart-row" key={row.placeId}>
          <span className="restaurant-chart-name" title={row.name}>
            {row.name}
          </span>
          <span className="restaurant-bars" aria-hidden="true">
            <span
              className="restaurant-bar restaurant-bar-boost"
              style={{ width: `${(row.boost / peak) * 100}%` }}
            />
            <span
              className="restaurant-bar restaurant-bar-reduce"
              style={{ width: `${(row.reduce / peak) * 100}%` }}
            />
          </span>
          <span className="restaurant-values">
            +{tokenCount(row.boost)} / −{tokenCount(row.reduce)}
          </span>
        </div>
      ))}
      <div className="restaurant-chart-legend">
        <span>
          <i className="legend-boost" />
          Boost tokens
        </span>
        <span>
          <i className="legend-reduce" />
          Anti-boost tokens
        </span>
      </div>
      <table className="visually-hidden">
        <caption>Influence tokens spent per restaurant</caption>
        <thead>
          <tr>
            <th>Restaurant</th>
            <th>Boost tokens</th>
            <th>Anti-boost tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.placeId}>
              <th>{row.name}</th>
              <td>{row.boost}</td>
              <td>{row.reduce}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoalitionMatrix({ entries }: { entries: ActionEntry[] }) {
  const restaurants = new Map<string, string>();
  const people = new Map<string, string>();
  const cells = new Map<string, { boost: number; reduce: number }>();
  for (const entry of entries) {
    if ((entry.kind !== 'boost' && entry.kind !== 'reduce') || !entry.placeId)
      continue;
    restaurants.set(entry.placeId, entry.placeName ?? 'Archived restaurant');
    people.set(entry.participantId, entry.participantName);
    const key = `${entry.participantId}:${entry.placeId}`;
    const cell = cells.get(key) ?? { boost: 0, reduce: 0 };
    cell[entry.kind] += Math.abs(entry.delta);
    cells.set(key, cell);
  }
  const restaurantRows = [...restaurants.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => {
      const sum = (placeId: string) =>
        [...cells.entries()].reduce(
          (n, [key, cell]) =>
            key.endsWith(`:${placeId}`) ? n + cell.boost + cell.reduce : n,
          0,
        );
      return sum(b.id) - sum(a.id);
    });
  const personRows = [...people.entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  if (!restaurantRows.length)
    return <p className="activity-empty">No group influence to compare yet.</p>;
  return (
    <div className="matrix-scroll">
      <table className="coalition-matrix">
        <caption>
          Each cell shows a person’s boost and anti-boost spend for a restaurant
        </caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            {restaurantRows.map((restaurant) => (
              <th scope="col" key={restaurant.id}>
                {restaurant.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {personRows.map(([personId, name]) => (
            <tr key={personId}>
              <th scope="row">{name}</th>
              {restaurantRows.map((restaurant) => {
                const cell = cells.get(`${personId}:${restaurant.id}`);
                return (
                  <td
                    key={restaurant.id}
                    className={cell ? 'matrix-active' : ''}
                  >
                    {cell ? (
                      <>
                        <span className="matrix-boost">
                          +{tokenCount(cell.boost)}
                        </span>
                        <span className="matrix-reduce">
                          −{tokenCount(cell.reduce)}
                        </span>
                      </>
                    ) : (
                      <span className="matrix-none">·</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="activity-chart-note">
        + = boost tokens · − = anti-boost tokens · blank dot = no action
      </p>
    </div>
  );
}

function formatInstant(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
}

function formatBetStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function DailyActivity({
  participantId,
  localDate,
  nextDrawDate,
}: {
  participantId: string;
  localDate: string;
  nextDrawDate: string;
}) {
  const [scope, setScope] = useState<'day' | 'draw'>('draw');
  const [selectedDate, setSelectedDate] = useState(nextDrawDate);
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [personFilter, setPersonFilter] = useState('all');
  const [placeFilter, setPlaceFilter] = useState('all');
  const requestKey = `${participantId}:${scope}:${selectedDate}`;

  useEffect(() => {
    setSelectedDate(scope === 'draw' ? nextDrawDate : localDate);
  }, [scope, nextDrawDate, localDate]);

  useEffect(() => {
    if (!participantId || !selectedDate) return;
    const controller = new AbortController();
    let requestSequence = 0;
    const refresh = async () => {
      const sequence = ++requestSequence;
      setResult((previous) =>
        previous?.key === requestKey
          ? { ...previous, refreshing: true, error: undefined }
          : { key: requestKey, refreshing: true },
      );
      try {
        const loadDay = async (date: string) => {
          const response = await fetch(
            `/api/v1/activity?date=${encodeURIComponent(date)}&scope=${scope}`,
            {
              headers: { 'X-Participant-Id': participantId },
              cache: 'no-store',
              signal: controller.signal,
            },
          );
          if (!response.ok)
            throw new Error(
              response.status === 403 || response.status === 404
                ? 'Your selected name is no longer available. Choose an active name and try again.'
                : 'Could not load daily activity. Check your connection and retry.',
            );
          const data = dailyActivityResponse.parse(await response.json());
          if (data.localDate !== date)
            throw new Error(
              'The server returned a different day. Please retry.',
            );
          return data;
        };
        const data = await loadDay(selectedDate);
        if (!controller.signal.aborted && sequence === requestSequence)
          setResult({
            key: requestKey,
            data,
            refreshing: false,
          });
      } catch (error) {
        if (controller.signal.aborted || sequence !== requestSequence) return;
        setResult((previous) =>
          previous?.key === requestKey
            ? {
                ...previous,
                refreshing: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Could not load daily activity.',
              }
            : {
                key: requestKey,
                refreshing: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Could not load daily activity.',
              },
        );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [participantId, requestKey, retryCount, selectedDate, scope]);

  const current = result?.key === requestKey ? result : null;
  const data = current?.data;
  const board = data;
  const timezone = data?.timezone ?? 'UTC';
  const entries = data?.entries ?? emptyEntries;
  const boosts = entries
    .filter((entry) => entry.kind === 'boost')
    .reduce((sum, entry) => sum + Math.abs(entry.delta), 0);
  const reduces = entries
    .filter((entry) => entry.kind === 'reduce')
    .reduce((sum, entry) => sum + Math.abs(entry.delta), 0);
  const activePeople = new Set(
    entries
      .filter((entry) => ['boost', 'reduce'].includes(entry.kind))
      .map((entry) => entry.participantId),
  ).size;
  const people = useMemo(
    () =>
      [
        ...new Map(
          entries.map((entry) => [entry.participantId, entry.participantName]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [entries],
  );
  const places = useMemo(
    () =>
      [
        ...new Map(
          entries
            .filter((entry) => entry.placeId)
            .map((entry) => [
              entry.placeId!,
              entry.placeName ?? 'Archived restaurant',
            ]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [entries],
  );
  const filteredEntries = entries
    .filter(
      (entry) =>
        (personFilter === 'all' || entry.participantId === personFilter) &&
        (placeFilter === 'all' || entry.placeId === placeFilter),
    )
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const drawDateLabel = data ? dateLabel(selectedDate) : selectedDate;

  return (
    <section
      className="daily-activity"
      aria-label="Daily token activity"
      aria-busy={!current || current.refreshing}
    >
      <header className="daily-activity-header">
        <div>
          <p className="activity-eyebrow">
            {scope === 'draw'
              ? 'Activity for one draw'
              : 'Actions by calendar day'}
          </p>
          <h2>Activity room</h2>
          <p className="activity-date-caption">
            {drawDateLabel}
            {data ? ` · ${timezone}` : ''}
          </p>
        </div>
        <div className="activity-date-controls">
          <label htmlFor="activity-scope">View</label>
          <select
            id="activity-scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as 'day' | 'draw');
              setPersonFilter('all');
              setPlaceFilter('all');
            }}
          >
            <option value="draw">Draw activity</option>
            <option value="day">Calendar day</option>
          </select>
          <label htmlFor="activity-date">
            {scope === 'draw' ? 'Draw date' : 'Activity date'}
          </label>
          <input
            id="activity-date"
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setPersonFilter('all');
              setPlaceFilter('all');
            }}
          />
          <div className="activity-date-shortcuts">
            <button
              type="button"
              className={selectedDate === localDate ? 'selected' : ''}
              onClick={() => setSelectedDate(localDate)}
            >
              Today
            </button>
            <button
              type="button"
              className={selectedDate === nextDrawDate ? 'selected' : ''}
              onClick={() => setSelectedDate(nextDrawDate)}
            >
              Next draw · {nextDrawDate}
            </button>
          </div>
        </div>
      </header>

      {current?.error && (
        <div className="activity-error" role="alert">
          <span>
            {current.error}
            {data ? ' Showing the last successful update.' : ''}
          </span>
          <button
            className="button button-light"
            type="button"
            onClick={() => {
              setResult(null);
              setRetryCount((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!data ? (
        current?.error ? (
          <div className="activity-loading">Activity is unavailable.</div>
        ) : (
          <div className="activity-loading" role="status">
            Loading activity for {selectedDate}…
          </div>
        )
      ) : (
        <>
          <p className="activity-chart-note">
            {scope === 'draw'
              ? `Boosts, reductions, refunds and bets targeting ${selectedDate}, including actions made on earlier days.`
              : `Token actions made on ${selectedDate}. The bet board shows bets targeting that date; draw dates are shown on individual actions.`}
          </p>
          <div className="activity-summary" aria-label="Daily activity summary">
            <article>
              <span>Boosted</span>
              <strong>
                {tokenCount(boosts)} <small>tokens</small>
              </strong>
              <p>purchased before refunds</p>
            </article>
            <article>
              <span>Anti-boosted</span>
              <strong>
                {tokenCount(reduces)} <small>tokens</small>
              </strong>
              <p>purchased before refunds</p>
            </article>
            <article>
              <span>People active</span>
              <strong>{tokenCount(activePeople)}</strong>
              <p>made at least one influence move</p>
            </article>
            <article>
              <span>Bet slips</span>
              <strong>{tokenCount(board?.bets.length ?? 0)}</strong>
              <p>on the draw dated {selectedDate}</p>
            </article>
          </div>
          {scope === 'draw' && data.positions && (
            <DrawPositions
              positions={data.positions}
              localDate={selectedDate}
            />
          )}
          {scope === 'draw' &&
            data.healthBonuses?.map((event) => (
              <HealthBonusSummary
                key={event.drawId}
                bonus={event.bonus}
                winner={event.placeName}
              />
            ))}
          <div className="activity-dashboard-grid">
            <section className="activity-panel activity-trend-panel">
              <div className="activity-panel-heading">
                <div>
                  <h3>Influence over time</h3>
                  <p>When the group spent tokens to move restaurant weights</p>
                </div>
                <span className="activity-live-indicator">
                  {current?.refreshing ? 'Updating' : 'Live · 30 sec'}
                </span>
              </div>
              <ActivityTrend entries={entries} timezone={timezone} />
            </section>
            <section className="activity-panel">
              <div className="activity-panel-heading">
                <div>
                  <h3>Restaurants in the crossfire</h3>
                  <p>
                    Purchases before refunds; current positions are shown above
                  </p>
                </div>
              </div>
              <RestaurantChart entries={entries} />
            </section>
          </div>
          <section className="activity-panel activity-coalition-panel">
            <div className="activity-panel-heading">
              <div>
                <h3>Who backed each restaurant?</h3>
                <p>
                  Compare purchase activity before refunds; outstanding
                  positions are shown above
                </p>
              </div>
            </div>
            <CoalitionMatrix entries={entries} />
          </section>

          <section className="activity-panel bet-board-panel">
            <div className="activity-panel-heading">
              <div>
                <h3>Bet board</h3>
                <p>
                  Open and settled bets for the draw dated {selectedDate}. Win
                  payouts include the stake and use current odds until the draw.
                </p>
              </div>
            </div>
            {board?.bets.length ? (
              <div className="activity-table-scroll">
                <table className="bet-board">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Restaurant</th>
                      <th>Stake</th>
                      <th>Odds</th>
                      <th>Est. win payout</th>
                      <th>Status</th>
                      <th>Payout</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.bets
                      .slice()
                      .sort((a, b) =>
                        a.participantName.localeCompare(b.participantName),
                      )
                      .map((bet) => (
                        <tr key={bet.id}>
                          <td>{bet.participantName}</td>
                          <td>{bet.placeName}</td>
                          <td>{tokenCount(bet.stake)} tokens</td>
                          <td
                            title={
                              bet.status === 'open'
                                ? 'Current odds; may change before the draw'
                                : 'Final odds at settlement'
                            }
                          >
                            {(() => {
                              const probability =
                                bet.status === 'open'
                                  ? bet.currentProbability
                                  : bet.probability;
                              return probability == null
                                ? '—'
                                : `${approximateOdds(probability)} · ${(probability * 100).toFixed(1)}%`;
                            })()}
                          </td>
                          <td>
                            {bet.estimatedWinPayout == null
                              ? '—'
                              : `${tokenCount(bet.estimatedWinPayout)} tokens`}
                          </td>
                          <td>
                            <span
                              className={`bet-status bet-status-${bet.status}`}
                            >
                              {formatBetStatus(bet.status)}
                            </span>
                          </td>
                          <td>
                            {bet.payout === null
                              ? '—'
                              : `${tokenCount(bet.payout)} tokens`}
                          </td>
                          <td>
                            <time dateTime={bet.updatedAt}>
                              {formatInstant(bet.updatedAt, timezone)}
                            </time>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="activity-empty">
                No bets are recorded for this draw date.
              </p>
            )}
          </section>

          <section className="activity-panel event-timeline-panel">
            <div className="activity-panel-heading">
              <div>
                <h3>Token actions</h3>
                <p>
                  {scope === 'draw'
                    ? 'Actions targeting the draw on'
                    : 'Actions recorded on'}{' '}
                  {drawDateLabel}, in {timezone}. Times show when each action
                  happened.
                </p>
              </div>
              <span className="timeline-count">
                {tokenCount(entries.length)} events
              </span>
            </div>
            <div className="timeline-filters">
              <label>
                <span id="activity-person-label">Person</span>
                <select
                  aria-labelledby="activity-person-label"
                  value={personFilter}
                  onChange={(event) => setPersonFilter(event.target.value)}
                >
                  <option value="all">Everyone</option>
                  {people.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span id="activity-restaurant-label">Restaurant</span>
                <select
                  aria-labelledby="activity-restaurant-label"
                  value={placeFilter}
                  onChange={(event) => setPlaceFilter(event.target.value)}
                >
                  <option value="all">All activity</option>
                  {places.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {filteredEntries.length ? (
              <ol className="activity-timeline">
                {filteredEntries.map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={`timeline-mark timeline-mark-${entry.kind}`}
                      aria-hidden="true"
                    />
                    <div className="timeline-event-copy">
                      <strong>
                        {entry.participantName} <span>{kindTitle(entry)}</span>
                        {entry.placeName ? (
                          <>
                            {' '}
                            <span>at</span> {entry.placeName}
                          </>
                        ) : null}
                      </strong>
                      {entry.reason && <p>{entry.reason}</p>}
                      {entry.betLocalDate && (
                        <p>Bet for draw date {entry.betLocalDate}</p>
                      )}
                      {entry.influenceLocalDate && (
                        <p>
                          Influence for draw date {entry.influenceLocalDate}
                        </p>
                      )}
                    </div>
                    <time dateTime={entry.createdAt}>
                      {formatInstant(entry.createdAt, timezone)}
                    </time>
                    <strong
                      className={
                        entry.delta > 0
                          ? 'timeline-positive'
                          : 'timeline-negative'
                      }
                    >
                      {entry.delta > 0 ? '+' : '−'}
                      {tokenCount(Math.abs(entry.delta))}
                    </strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="activity-empty">No actions match these filters.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
