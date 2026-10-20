'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import type {
  Participant,
  Place,
  Schedule,
  TodayResponse,
  WalletResponse,
} from '@lunch/contracts';
import { Readiness } from './readiness';

type ApiError = { error?: { code?: string; message?: string } };
type Pending = {
  key: string;
  route: string;
  body: unknown;
  participantId?: string;
  createdAt: number;
};
const storageKey = 'lunch-roller.participant-id';
const pendingKey = 'lunch-roller.pending-action';
const colors = [
  '#f4c85b',
  '#b7cf9a',
  '#e8a18a',
  '#96c4bd',
  '#dfa9c7',
  '#efb56f',
  '#b8b4df',
  '#d4d1a2',
];

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(
  route: string,
  options: RequestInit = {},
  participantId?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (participantId) headers.set('X-Participant-Id', participantId);
  const response = await fetch(`/api/v1${route}`, {
    ...options,
    headers,
    cache: 'no-store',
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json()) as T & ApiError;
  if (!response.ok)
    throw new ApiRequestError(
      data.error?.message ?? 'The request could not be completed.',
      response.status,
      data.error?.code,
    );
  return data;
}

function json(body: unknown): string {
  return JSON.stringify(body);
}
function uuid() {
  return crypto.randomUUID();
}
function moneyLabel(delta: number) {
  return `${delta > 0 ? '+' : ''}${delta} tokens`;
}

export default function Home() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [participantId, setParticipantId] = useState('');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pollingError, setPollingError] = useState('');
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [spin, setSpin] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [editingPersonId, setEditingPersonId] = useState('');
  const [editingPersonName, setEditingPersonName] = useState('');
  const [editingPlaceId, setEditingPlaceId] = useState('');
  const [editingPlaceName, setEditingPlaceName] = useState('');
  const [schedule, setSchedule] = useState<Schedule>({
    timezone: 'Europe/Dublin',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5],
  });
  const [correction, setCorrection] = useState({
    participantId: '',
    delta: 1,
    reason: '',
  });
  const [pushOn, setPushOn] = useState(false);

  const refresh = useCallback(
    async (selected = participantId) => {
      try {
        const [roster, todayResult] = await Promise.all([
          request<{ participants: Participant[] }>('/participants'),
          request<TodayResponse>('/today'),
        ]);
        setParticipants(roster.participants);
        setToday(todayResult);
        if (selected) {
          try {
            setWallet(await request<WalletResponse>('/wallet', {}, selected));
          } catch (caught) {
            if (
              caught instanceof ApiRequestError &&
              [401, 403, 404].includes(caught.status) &&
              (caught.code === 'IDENTITY_REQUIRED' ||
                caught.code?.includes('PARTICIPANT') ||
                caught.code?.includes('IDENTITY'))
            ) {
              localStorage.removeItem(storageKey);
              setParticipantId('');
              setWallet(null);
            } else throw caught;
          }
        } else setWallet(null);
        setPollingError('');
      } catch (caught) {
        setPollingError(
          'Could not refresh the lunch wheel. It will retry shortly.',
        );
        throw caught;
      }
    },
    [participantId],
  );

  const refreshAdmin = useCallback(async () => {
    const [people, locations, savedSchedule] = await Promise.all([
      request<{ participants: Participant[] }>('/admin/participants'),
      request<{ places: Place[] }>('/admin/places'),
      request<Schedule>('/admin/schedule'),
    ]);
    setAllParticipants(people.participants);
    setPlaces(locations.places);
    setSchedule(savedSchedule);
    setAdmin(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem(storageKey) ?? '';
      setParticipantId(saved);
      void refresh(saved).catch(() => undefined);
    }, 0);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register('/service-worker.js')
        .then(async () => {
          const registration = await navigator.serviceWorker.ready;
          const hasSubscription = Boolean(
            await registration.pushManager.getSubscription(),
          );
          const linkedParticipant = localStorage.getItem(
            'lunch-roller.push-participant-id',
          );
          const selectedParticipant = localStorage.getItem(storageKey);
          setPushOn(
            hasSubscription && linkedParticipant === selectedParticipant,
          );
        })
        .catch(() => undefined);
    }
    void request<{ publicKey: string | null }>('/push-config').catch(
      () => undefined,
    );
    const interval = window.setInterval(
      () => void refresh().catch(() => undefined),
      30000,
    );
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const odds = useMemo(() => today?.odds ?? [], [today]);
  const wheelOptions = today?.result?.snapshot ?? odds;
  const gradient = useMemo(() => {
    if (!wheelOptions.length) return '#d9ddd1';
    let at = 0;
    const stops = wheelOptions.map((option, index) => {
      const start = at;
      at += option.probability * 360;
      return `${colors[index % colors.length]} ${start}deg ${at}deg`;
    });
    return `conic-gradient(${stops.join(',')})`;
  }, [wheelOptions]);

  useEffect(() => {
    const result = today?.result;
    if (!result || spin) return;
    const index = result.snapshot.findIndex(
      (option) => option.placeId === result.placeId,
    );
    if (index < 0) return;
    const total = result.snapshot.reduce(
      (sum, option) => sum + option.probability,
      0,
    );
    let before = 0;
    for (let cursor = 0; cursor < index; cursor++)
      before += result.snapshot[cursor]!.probability;
    const span = result.snapshot[index]!.probability;
    const center = ((before + span / 2) / (total || 1)) * 360;
    const current = ((rotation % 360) + 360) % 360;
    const target = (360 - center + 360) % 360;
    const frame = window.requestAnimationFrame(() => {
      setSpin(true);
      setRotation(rotation + 5 * 360 + ((target - current + 360) % 360));
    });
    const timer = window.setTimeout(() => setSpin(false), 4700);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // A result is committed and immutable; run once when its ID arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today?.result?.id]);

  async function selectParticipant(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const selected = await request<Participant>('/identity/select', {
        method: 'POST',
        body: json({ participantId: nameDraft }),
      });
      localStorage.setItem(storageKey, selected.id);
      setParticipantId(selected.id);
      setPushOn(
        localStorage.getItem('lunch-roller.push-participant-id') ===
          selected.id,
      );
      setNameDraft('');
      await refresh(selected.id);
      setNotice(`You’re in as ${selected.name}.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not select that name.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    route: string,
    payload: unknown,
    message: string,
  ): Promise<boolean> {
    if (!participantId) {
      setError('Choose your name before using tokens.');
      return false;
    }
    let pending: Pending;
    try {
      const previous = localStorage.getItem(pendingKey);
      const candidate = previous ? (JSON.parse(previous) as Pending) : null;
      pending =
        candidate &&
        candidate.route === route &&
        candidate.participantId === participantId &&
        JSON.stringify(candidate.body) === JSON.stringify(payload) &&
        Date.now() - candidate.createdAt < 86400000
          ? candidate
          : {
              key: uuid(),
              route,
              body: payload,
              participantId,
              createdAt: Date.now(),
            };
      localStorage.setItem(pendingKey, JSON.stringify(pending));
    } catch {
      pending = {
        key: uuid(),
        route,
        body: payload,
        participantId,
        createdAt: Date.now(),
      };
    }
    setBusy(true);
    setError('');
    try {
      await request(
        route,
        {
          method: 'POST',
          body: json(payload),
          headers: { 'Idempotency-Key': pending.key },
        },
        participantId,
      );
      await refresh();
      localStorage.removeItem(pendingKey);
      setNotice(message);
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The action could not be completed.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/admin/session', {
        method: 'POST',
        body: json({ password: adminPassword }),
      });
      setAdminPassword('');
      await refreshAdmin();
      setNotice('Administrator tools unlocked.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  async function adminSave(
    route: string,
    method: string,
    payload: unknown,
    done: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let headers: HeadersInit | undefined;
      if (route === '/admin/token-corrections') {
        const key = 'lunch-roller.admin-correction';
        const prior = sessionStorage.getItem(key);
        const candidate = prior ? (JSON.parse(prior) as Pending) : null;
        const pending =
          candidate &&
          JSON.stringify(candidate.body) === JSON.stringify(payload) &&
          Date.now() - candidate.createdAt < 86400000
            ? candidate
            : { key: uuid(), route, body: payload, createdAt: Date.now() };
        sessionStorage.setItem(key, JSON.stringify(pending));
        headers = { 'Idempotency-Key': pending.key };
      }
      await request(route, { method, body: json(payload), headers });
      await refreshAdmin();
      await refresh();
      setNotice(done);
      if (route === '/admin/token-corrections')
        sessionStorage.removeItem('lunch-roller.admin-correction');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save changes.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function togglePush() {
    setError('');
    try {
      if (
        !('Notification' in window) ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        throw new Error(
          'Push notifications are not supported by this browser.',
        );
      }
      const registration = await navigator.serviceWorker.ready;
      if (!registration.pushManager)
        throw new Error(
          'Push notifications are not supported by this browser.',
        );
      const config = await request<{ publicKey: string | null }>(
        '/push-config',
      );
      if (!config.publicKey || !participantId)
        throw new Error('Push notifications are not configured yet.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error(
          'Notifications were not enabled. You can still play without them.',
        );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(
          atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')),
          (c) => c.charCodeAt(0),
        ),
      });
      const result = await request<{ id: string }>(
        '/push-subscriptions',
        { method: 'POST', body: json(subscription.toJSON()) },
        participantId,
      );
      localStorage.setItem('lunch-roller.push-subscription', result.id);
      localStorage.setItem('lunch-roller.push-participant-id', participantId);
      setPushOn(true);
      setNotice('Lunch notifications enabled for this browser.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not enable notifications.',
      );
    }
  }

  async function disablePush() {
    try {
      const id = localStorage.getItem('lunch-roller.push-subscription');
      if (id && participantId)
        await request(
          `/push-subscriptions/${id}`,
          { method: 'DELETE' },
          participantId,
        );
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.pushManager
          ?.getSubscription()
          .then((subscription) => subscription?.unsubscribe());
      }
      localStorage.removeItem('lunch-roller.push-subscription');
      localStorage.removeItem('lunch-roller.push-participant-id');
      setPushOn(false);
      setNotice('Lunch notifications disabled.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not disable notifications.',
      );
    }
  }

  const currentName = participants.find(
    (person) => person.id === participantId,
  )?.name;
  const drawnPlace = today?.result?.placeName;

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Lunch Roller home">
          <span className="brand-mark">✳</span> LUNCH ROLLER
        </a>
        <div className="top-actions">
          <span className="date-chip">
            {today?.localDate ?? 'TODAY'} ·{' '}
            {today?.schedule.timezone ?? 'Europe/Dublin'}
          </span>
          <a href="#admin" className="quiet-link">
            Admin
          </a>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-dot" /> THE DAILY LUNCH DECIDER
          </p>
          <h1>
            One team.
            <br />
            <em>One wheel.</em>
            <br />
            Lunch sorted.
          </h1>
          <p className="hero-lede">
            A little chance. A little friendly persuasion. Your next lunch spot
            is in good hands.
          </p>
          <Readiness />
          {pollingError && (
            <p className="refresh-error" role="status" aria-live="polite">
              {pollingError}
            </p>
          )}
        </div>
        <div className="wheel-card">
          <div
            className="wheel-wrap"
            aria-label={
              drawnPlace
                ? `Today's committed result is ${drawnPlace}`
                : 'Lunch wheel'
            }
          >
            <div className="pointer" aria-hidden="true">
              ▼
            </div>
            <div
              className={`wheel ${spin ? 'wheel-spinning' : ''}`}
              style={{
                background: gradient,
                transform: `rotate(${rotation}deg)`,
              }}
              role="img"
              aria-label={
                wheelOptions.length
                  ? `Wheel with ${wheelOptions.length} lunch places, sized by the ${today?.result ? 'committed draw snapshot' : 'current odds'}`
                  : 'Empty lunch wheel'
              }
            >
              {wheelOptions.length
                ? wheelOptions
                    .map((option, index) => ({ option, index }))
                    .filter(({ option }) => option.probability >= 0.005)
                    .map(({ option, index }) => (
                      <span
                        className="wheel-label"
                        key={option.placeId}
                        title={option.name}
                        aria-label={option.name}
                        style={{
                          transform: `rotate(${(wheelOptions.slice(0, index).reduce((sum, item) => sum + item.probability, 0) + option.probability / 2) * 360}deg) translateY(-126px) rotate(-${(wheelOptions.slice(0, index).reduce((sum, item) => sum + item.probability, 0) + option.probability / 2) * 360}deg)`,
                        }}
                      >
                        {option.name.length > 14
                          ? `${option.name.slice(0, 13)}…`
                          : option.name}
                      </span>
                    ))
                : null}
              <div className="wheel-hub">
                <span>
                  LET’S
                  <br />
                  EAT
                </span>
              </div>
            </div>
          </div>
          <div className="wheel-footer">
            <span className="wheel-state">
              {today?.status === 'drawn'
                ? 'TODAY’S PICK'
                : today?.status === 'not-scheduled'
                  ? 'NO DRAW TODAY'
                  : today?.status === 'no-options'
                    ? 'ADD A PLACE TO BEGIN'
                    : 'NEXT DRAW'}
            </span>
            <strong>
              {drawnPlace ??
                (today?.status === 'not-scheduled'
                  ? 'Rest day'
                  : 'The wheel is waiting')}
            </strong>
          </div>
        </div>
      </section>

      <section
        className="play-grid"
        aria-label="Lunch wheel and member controls"
      >
        <div className="panel roster-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / YOUR SEAT AT THE TABLE</p>
              <h2>Who’s hungry?</h2>
            </div>
            <span className="mini-icon">↗</span>
          </div>
          <p className="muted">
            Pick your name to check in and see your token balance.
          </p>
          <form className="inline-form" onSubmit={selectParticipant}>
            <label className="sr-only" htmlFor="member-select">
              Your name
            </label>
            <select
              id="member-select"
              value={currentName ? participantId : nameDraft}
              onChange={(event) =>
                currentName
                  ? (localStorage.removeItem(storageKey),
                    setParticipantId(''),
                    setWallet(null),
                    setNameDraft(event.target.value))
                  : setNameDraft(event.target.value)
              }
            >
              <option value="">Choose your name</option>
              {participants.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <button
              className="button button-dark"
              disabled={busy || !nameDraft}
            >
              {currentName ? 'Change' : 'Join in'}
            </button>
          </form>
          <div className="member-status">
            <div>
              <span className="status-label">SELECTED NAME</span>
              <strong>{currentName ?? 'No one yet'}</strong>
            </div>
            <div className="balance">
              <span className="status-label">YOUR TOKENS</span>
              <strong>
                {wallet?.balance ?? '—'} <span>✳</span>
              </strong>
            </div>
          </div>
          <div className="button-row">
            <button
              className="button button-yellow"
              disabled={busy || !participantId || !today?.result}
              onClick={() =>
                today?.result &&
                void mutate(
                  '/attendance',
                  { drawId: today.result.id },
                  'Check-in complete — 10 tokens added.',
                )
              }
            >
              Check in <span>+10 ✳</span>
            </button>
            <button
              className="button button-light"
              disabled={
                !participantId ||
                (!pushOn &&
                  (typeof window === 'undefined' ||
                    !('Notification' in window) ||
                    !('serviceWorker' in navigator) ||
                    !('PushManager' in window)))
              }
              onClick={() => (pushOn ? void disablePush() : void togglePush())}
            >
              {pushOn ? 'Turn alerts off' : 'Get lunch alerts'}
            </button>
          </div>
          <div className="ledger">
            <div className="ledger-heading">
              <h3>Recent token activity</h3>
              {wallet && wallet.ledger.length > 5 ? (
                <button
                  className="ledger-toggle"
                  aria-expanded={showAllLedger}
                  aria-controls="token-ledger"
                  onClick={() => setShowAllLedger((showing) => !showing)}
                >
                  {showAllLedger ? 'Show recent' : 'Show all'}
                </button>
              ) : (
                <span>YOUR WALLET</span>
              )}
            </div>
            {wallet?.ledger.length ? (
              <div id="token-ledger">
                {wallet.ledger
                  .slice(0, showAllLedger ? undefined : 5)
                  .map((entry) => (
                    <div className="ledger-row" key={entry.id}>
                      <span>
                        {entry.reason ?? entry.kind.replaceAll('-', ' ')}
                      </span>
                      <span className="ledger-date">
                        <time dateTime={entry.createdAt}>
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }).format(new Date(entry.createdAt))}
                        </time>
                      </span>
                      <strong className={entry.delta > 0 ? 'positive' : ''}>
                        {moneyLabel(entry.delta)}
                      </strong>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="empty-note">
                Your token activity will show up here.
              </p>
            )}
          </div>
        </div>

        <div className="panel odds-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">02 / THE ODDS</p>
              <h2>Where could we go?</h2>
            </div>
            <span className="odds-total">{odds.length} PLACES</span>
          </div>
          <p className="muted">
            Current chances for the next draw. More tokens can nudge the odds.
          </p>
          <div className="odds-list">
            {odds.map((option, index) => {
              const placeId = 'placeId' in option ? option.placeId : '';
              return (
                <div className="odds-row" key={placeId}>
                  <span
                    className="odds-color"
                    style={{ background: colors[index % colors.length] }}
                  />
                  <span className="odds-name">{option.name}</span>
                  <span className="odds-bar">
                    <span
                      style={{
                        width: `${Math.max(option.probability * 100, option.probability > 0 ? 0.5 : 0)}%`,
                        background: colors[index % colors.length],
                      }}
                    />
                  </span>
                  <strong>{(option.probability * 100).toFixed(1)}%</strong>
                  <div className="influence-buttons">
                    <button
                      title="Boost place (5 tokens)"
                      disabled={busy || !participantId}
                      onClick={() =>
                        void mutate(
                          '/purchases',
                          { placeId, action: 'boost' },
                          'Place boosted for the next draw.',
                        )
                      }
                    >
                      + ↗
                    </button>
                    <button
                      title="Reduce place (5 tokens)"
                      disabled={busy || !participantId}
                      onClick={() =>
                        void mutate(
                          '/purchases',
                          { placeId, action: 'reduce' },
                          'Place reduced for the next draw.',
                        )
                      }
                    >
                      − ↘
                    </button>
                  </div>
                </div>
              );
            })}
            {!odds.length && (
              <p className="empty-note">
                The admin can add places to get the wheel rolling.
              </p>
            )}
          </div>
          <form
            className="add-place"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const input = new FormData(form).get('place')?.toString().trim();
              if (input)
                void mutate(
                  '/places',
                  { name: input },
                  'New lunch place added for 20 tokens.',
                ).then((saved) => {
                  if (saved) form.reset();
                });
            }}
          >
            <label htmlFor="place-name">Have a new spot in mind?</label>
            <div className="inline-form">
              <input
                id="place-name"
                name="place"
                placeholder="Add a lunch place · 20 tokens"
                maxLength={100}
                required
                disabled={!participantId || busy}
              />
              <button
                className="button button-light"
                disabled={!participantId || busy}
              >
                Add place
              </button>
            </div>
          </form>
          {today?.result && (
            <div className="result-note">
              <span>✳</span>
              <p>
                The team picked <strong>{today.result.placeName}</strong>.
                Winner’s weight is halved for next time.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rules-strip" aria-label="How the game works">
        <article>
          <span>01</span>
          <div>
            <h3>THE EDICT</h3>
            <p>
              {today?.schedule.time ?? '11:30'} local time. One shared choice on
              scheduled days.
            </p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <h3>THE TWIST</h3>
            <p>The winning place loses half its weight after every draw.</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <h3>THE INFLUENCE</h3>
            <p>Check in for 10 tokens. Spend 5 to nudge the odds.</p>
          </div>
        </article>
      </section>

      <section className="admin-section" id="admin">
        <div className="admin-intro">
          <p className="eyebrow">THE BACK OFFICE</p>
          <h2>Admin corner</h2>
          <p>Keep the roster, lunch spots and schedule in good order.</p>
        </div>
        {!admin ? (
          <form className="admin-login" onSubmit={login}>
            <label htmlFor="admin-password">Administrator password</label>
            <div className="inline-form">
              <input
                id="admin-password"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button
                className="button button-dark"
                disabled={busy || !adminPassword}
              >
                Unlock
              </button>
            </div>
          </form>
        ) : (
          <div className="admin-tools">
            <div className="admin-tool-card">
              <h3>People</h3>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (newName.trim())
                    void adminSave(
                      '/admin/participants',
                      'POST',
                      { name: newName },
                      'Person added.',
                    ).then(() => setNewName(''));
                }}
              >
                <input
                  aria-label="New team member name"
                  placeholder="New team member"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  maxLength={100}
                />
                <button
                  className="button button-light"
                  disabled={busy || !newName.trim()}
                >
                  Add
                </button>
              </form>
              {allParticipants.map((person) => (
                <div className="admin-row" key={person.id}>
                  {editingPersonId === person.id ? (
                    <form
                      className="inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void adminSave(
                          `/admin/participants/${person.id}`,
                          'PATCH',
                          { name: editingPersonName },
                          'Name updated.',
                        ).then(() => setEditingPersonId(''));
                      }}
                    >
                      <input
                        aria-label={`Rename ${person.name}`}
                        value={editingPersonName}
                        onChange={(event) =>
                          setEditingPersonName(event.target.value)
                        }
                        maxLength={100}
                      />
                      <button
                        className="button button-light"
                        disabled={busy || !editingPersonName.trim()}
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <span>{person.name}</span>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingPersonId(person.id);
                      setEditingPersonName(person.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void adminSave(
                        `/admin/participants/${person.id}`,
                        'PATCH',
                        { active: !person.active },
                        person.active ? 'Person archived.' : 'Person restored.',
                      )
                    }
                  >
                    {person.active ? 'Archive' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
            <div className="admin-tool-card">
              <h3>Places</h3>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget)
                    .get('admin-place')
                    ?.toString()
                    .trim();
                  if (name)
                    void adminSave(
                      '/admin/places',
                      'POST',
                      { name },
                      'Place added.',
                    );
                }}
              >
                <input
                  name="admin-place"
                  aria-label="New lunch place"
                  placeholder="New lunch place"
                  maxLength={100}
                />
                <button className="button button-light" disabled={busy}>
                  Add
                </button>
              </form>
              {places.map((place) => (
                <div className="admin-row" key={place.id}>
                  {editingPlaceId === place.id ? (
                    <form
                      className="inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void adminSave(
                          `/admin/places/${place.id}`,
                          'PATCH',
                          { name: editingPlaceName },
                          'Name updated.',
                        ).then(() => setEditingPlaceId(''));
                      }}
                    >
                      <input
                        aria-label={`Rename ${place.name}`}
                        value={editingPlaceName}
                        onChange={(event) =>
                          setEditingPlaceName(event.target.value)
                        }
                        maxLength={100}
                      />
                      <button
                        className="button button-light"
                        disabled={busy || !editingPlaceName.trim()}
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <span>
                      {place.name}{' '}
                      <small>
                        {place.active
                          ? `${Math.exp(place.logWeight).toFixed(2)}× weight`
                          : 'archived'}
                      </small>
                    </span>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingPlaceId(place.id);
                      setEditingPlaceName(place.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void adminSave(
                        `/admin/places/${place.id}`,
                        'PATCH',
                        { active: !place.active },
                        place.active ? 'Place archived.' : 'Place restored.',
                      )
                    }
                  >
                    {place.active ? 'Archive' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
            <div className="admin-tool-card">
              <h3>Draw schedule</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void adminSave(
                    '/admin/schedule',
                    'PUT',
                    schedule,
                    'Schedule saved.',
                  );
                }}
              >
                <label>
                  Time
                  <input
                    type="time"
                    value={schedule.time}
                    onChange={(event) =>
                      setSchedule({ ...schedule, time: event.target.value })
                    }
                  />
                </label>
                <label>
                  Timezone
                  <input
                    value={schedule.timezone}
                    onChange={(event) =>
                      setSchedule({ ...schedule, timezone: event.target.value })
                    }
                  />
                </label>
                <div className="weekdays">
                  {'MTWTFSS'.split('').map((label, index) => (
                    <label key={`${label}${index}`}>
                      <input
                        type="checkbox"
                        checked={schedule.weekdays.includes(index + 1)}
                        onChange={(event) =>
                          setSchedule({
                            ...schedule,
                            weekdays: event.target.checked
                              ? [...schedule.weekdays, index + 1].sort()
                              : schedule.weekdays.filter(
                                  (day) => day !== index + 1,
                                ),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button
                  className="button button-dark"
                  disabled={busy || !schedule.weekdays.length}
                >
                  Save schedule
                </button>
              </form>
            </div>
            <div className="admin-tool-card">
              <h3>Token correction</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void adminSave(
                    '/admin/token-corrections',
                    'POST',
                    correction,
                    'Token correction recorded.',
                  );
                }}
              >
                <label>
                  Team member
                  <select
                    required
                    value={correction.participantId}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        participantId: event.target.value,
                      })
                    }
                  >
                    <option value="">Choose a person</option>
                    {allParticipants.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Token change
                  <input
                    type="number"
                    required
                    value={correction.delta}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        delta: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Reason
                  <input
                    required
                    maxLength={500}
                    value={correction.reason}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        reason: event.target.value,
                      })
                    }
                  />
                </label>
                <button
                  className="button button-dark"
                  disabled={
                    busy ||
                    !correction.participantId ||
                    !correction.reason.trim()
                  }
                >
                  Record correction
                </button>
              </form>
            </div>
            <button
              className="quiet-link logout"
              onClick={async () => {
                await request('/admin/session', { method: 'DELETE' });
                setAdmin(false);
                setPlaces([]);
              }}
            >
              Lock admin tools
            </button>
          </div>
        )}
      </section>

      <footer className="footer">
        <span className="brand">
          <span className="brand-mark">✳</span> LUNCH ROLLER
        </span>
        <span>Make room for a good lunch.</span>
        <Link href="/api/v1/health">Service health ↗</Link>
      </footer>
      <div className="announcement" aria-live="polite" role="status">
        {error || notice}
      </div>
    </main>
  );
}
