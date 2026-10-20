'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import type {
  Participant,
  ParticipantRemoval,
  Place,
  Schedule,
  SetupStatus,
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
const colors = ['#ed3d34', '#ffd326', '#24bc68', '#3478e5'];

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
function resultRotation(result: NonNullable<TodayResponse['result']>) {
  const index = result.snapshot.findIndex(
    (option) => option.placeId === result.placeId,
  );
  if (index < 0) return null;
  const total = result.snapshot.reduce(
    (sum, option) => sum + option.probability,
    0,
  );
  const before = result.snapshot
    .slice(0, index)
    .reduce((sum, option) => sum + option.probability, 0);
  const center =
    ((before + result.snapshot[index]!.probability / 2) / (total || 1)) * 360;
  return (90 - center + 360) % 360;
}

export default function Home() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [entryStage, setEntryStage] = useState<
    'loading' | 'setup' | 'name' | 'game'
  >('loading');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const wheelDisplayKey = today
    ? `${today.wheel.mode}:${today.wheel.localDate}`
    : '';
  const wheelMode = today?.wheel.mode;
  const hasSavedResult = Boolean(today?.result);
  const savedResult = today?.result;
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
  const [replaySnapshot, setReplaySnapshot] = useState<{
    key: string;
    options: NonNullable<TodayResponse['result']>['snapshot'];
  } | null>(null);
  const rotationRef = useRef(0);
  const animationTimer = useRef<number | null>(null);
  const upcomingRef = useRef(false);
  const latestTodayRequest = useRef(0);
  const [nameDraft, setNameDraft] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [setupPlaceName, setSetupPlaceName] = useState('');
  const [finishingSetup, setFinishingSetup] = useState(false);
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
  const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  const cancelRemoval = useRef<HTMLButtonElement | null>(null);
  const confirmRemoval = useRef<HTMLButtonElement | null>(null);
  const adminDisclosure = useRef<HTMLDetailsElement | null>(null);

  const refresh = useCallback(async (selected: string) => {
    const todayRequest = ++latestTodayRequest.current;
    try {
      const [roster, todayResult] = await Promise.all([
        request<{ participants: Participant[] }>('/participants'),
        request<TodayResponse>('/today'),
      ]);
      setParticipants(roster.participants);
      if (todayRequest === latestTodayRequest.current) setToday(todayResult);
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
            setNameDraft('');
            setEntryStage('name');
            return false;
          } else throw caught;
        }
      } else setWallet(null);
      setPollingError('');
      return true;
    } catch (caught) {
      setPollingError(
        'Could not refresh the lunch wheel. It will retry shortly.',
      );
      throw caught;
    }
  }, []);

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

  const loadSetupStatus = useCallback(async () => {
    const status = await request<SetupStatus>('/setup');
    setSetupStatus(status);
    return status;
  }, []);

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const status = await loadSetupStatus();
        if (!mounted) return;
        if (!status.completed) {
          setEntryStage('setup');
          try {
            await refreshAdmin();
          } catch {
            // The setup gate remains available to an administrator who signs in here.
          }
          return;
        }
        const saved = localStorage.getItem(storageKey) ?? '';
        if (saved) {
          try {
            const selected = await request<Participant>('/identity/select', {
              method: 'POST',
              body: json({ participantId: saved }),
            });
            if (!mounted) return;
            setParticipantId(selected.id);
            const valid = await refresh(selected.id);
            if (mounted && valid) setEntryStage('game');
            return;
          } catch (caught) {
            if (
              !(caught instanceof ApiRequestError) ||
              ![400, 401, 403, 404].includes(caught.status)
            )
              throw caught;
            localStorage.removeItem(storageKey);
          }
        }
        if (!mounted) return;
        setParticipantId('');
        setEntryStage('name');
        const roster = await request<{ participants: Participant[] }>(
          '/participants',
        );
        if (mounted) setParticipants(roster.participants);
      } catch {
        if (mounted)
          setPollingError('Could not load setup status. Please retry.');
      }
    };
    void initialize();
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
    return () => {
      mounted = false;
    };
  }, [loadSetupStatus, refresh, refreshAdmin]);

  useEffect(() => {
    if (entryStage !== 'game') return;
    const interval = window.setInterval(
      () => void refresh(participantId).catch(() => undefined),
      30000,
    );
    return () => window.clearInterval(interval);
  }, [entryStage, participantId, refresh]);

  function changeName() {
    localStorage.removeItem(storageKey);
    setParticipantId('');
    setWallet(null);
    setNameDraft('');
    setEntryStage('name');
    void request<{ participants: Participant[] }>('/participants')
      .then((roster) => setParticipants(roster.participants))
      .catch(() => setError('Could not load the active roster.'));
  }

  const odds = useMemo(() => today?.odds ?? [], [today]);
  const baselineOptions =
    today?.wheel.mode === 'result' && today.result
      ? today.result.snapshot
      : odds;
  const activeReplay =
    replaySnapshot?.key === wheelDisplayKey ? replaySnapshot.options : null;
  const wheelOptions = activeReplay ?? baselineOptions;
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

  const animateCommittedResult = useCallback(
    (result: NonNullable<TodayResponse['result']>) => {
      if (animationTimer.current !== null)
        window.clearTimeout(animationTimer.current);
      upcomingRef.current = today?.wheel.mode === 'upcoming';
      setReplaySnapshot({ key: wheelDisplayKey, options: result.snapshot });
      const index = result.snapshot.findIndex(
        (option) => option.placeId === result.placeId,
      );
      if (index < 0) {
        setReplaySnapshot(null);
        return;
      }
      const total = result.snapshot.reduce(
        (sum, option) => sum + option.probability,
        0,
      );
      const before = result.snapshot
        .slice(0, index)
        .reduce((sum, option) => sum + option.probability, 0);
      const center =
        ((before + result.snapshot[index]!.probability / 2) / (total || 1)) *
        360;
      const current = ((rotationRef.current % 360) + 360) % 360;
      const target = (90 - center + 360) % 360;
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      setSpin(true);
      const nextRotation =
        rotationRef.current +
        (reducedMotion ? 0 : 5 * 360) +
        ((target - current + 360) % 360);
      rotationRef.current = nextRotation;
      setRotation(nextRotation);
      if (reducedMotion) {
        animationTimer.current = window.setTimeout(() => {
          animationTimer.current = null;
          setSpin(false);
          setReplaySnapshot(null);
          if (upcomingRef.current) {
            rotationRef.current = 0;
            setRotation(0);
          }
        }, 1500);
      } else {
        animationTimer.current = window.setTimeout(() => {
          animationTimer.current = null;
          setSpin(false);
          setReplaySnapshot(null);
          if (upcomingRef.current) {
            rotationRef.current = 0;
            setRotation(0);
          }
        }, 4700);
      }
    },
    [today?.wheel.mode, wheelDisplayKey],
  );

  useEffect(() => {
    if (!wheelMode) return;
    if (animationTimer.current !== null) {
      window.clearTimeout(animationTimer.current);
      animationTimer.current = null;
    }
    upcomingRef.current = false;
    if (wheelMode === 'result' && hasSavedResult) return;
    const frame = window.requestAnimationFrame(() => {
      setReplaySnapshot(null);
      setSpin(false);
      rotationRef.current = 0;
      setRotation(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [wheelMode, wheelDisplayKey, hasSavedResult]);

  const lastObservedResultId = useRef<string | null | undefined>(undefined);
  const lastObservedWheelMode = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!wheelMode) return;
    let frame: number | null = null;
    const result = savedResult;
    const resultId = result?.id ?? null;
    const previousMode = lastObservedWheelMode.current;
    lastObservedWheelMode.current = wheelMode;
    if (lastObservedResultId.current === undefined) {
      lastObservedResultId.current = resultId;
      if (result && wheelMode === 'result') {
        const settledRotation = resultRotation(result);
        if (settledRotation !== null) {
          frame = window.requestAnimationFrame(() => {
            rotationRef.current = settledRotation;
            setRotation(settledRotation);
          });
        }
      }
      return () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
      };
    }
    if (resultId === lastObservedResultId.current) {
      if (result && wheelMode === 'result' && previousMode !== 'result') {
        const settledRotation = resultRotation(result);
        if (settledRotation !== null) {
          frame = window.requestAnimationFrame(() => {
            rotationRef.current = settledRotation;
            setRotation(settledRotation);
          });
        }
      }
      return () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
      };
    }
    lastObservedResultId.current = resultId;
    if (result && wheelMode === 'result') {
      frame = window.requestAnimationFrame(() =>
        animateCommittedResult(result),
      );
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [savedResult, wheelMode, animateCommittedResult]);

  useEffect(
    () => () => {
      if (animationTimer.current !== null) {
        window.clearTimeout(animationTimer.current);
        animationTimer.current = null;
      }
    },
    [],
  );

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
      if (!(await refresh(selected.id))) return;
      setEntryStage('game');
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
      await refresh(participantId);
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
      await loadSetupStatus();
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
      const status = await loadSetupStatus();
      if (status.completed) await refresh(participantId);
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

  async function completeFirstRunSetup() {
    if (busy || !admin || !setupStatus) return;
    setFinishingSetup(true);
    setBusy(true);
    setError('');
    try {
      const status = await request<SetupStatus>('/admin/setup/complete', {
        method: 'POST',
      });
      setSetupStatus(status);
      setParticipants(
        (await request<{ participants: Participant[] }>('/participants'))
          .participants,
      );
      setEntryStage('name');
      setNotice(
        'Setup is complete. Choose your name to enter the lunch wheel.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not complete setup.',
      );
      await loadSetupStatus().catch(() => undefined);
      await refreshAdmin().catch(() => undefined);
    } finally {
      setFinishingSetup(false);
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
  const wheelTargetDate = today?.wheel.localDate;
  const wheelTargetLabel = wheelTargetDate
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'full',
        timeZone: 'UTC',
      }).format(new Date(`${wheelTargetDate}T00:00:00Z`))
    : '';

  const replayResult = useCallback(() => {
    const result = today?.result;
    if (!result || spin) return;
    animateCommittedResult(result);
  }, [today?.result, spin, animateCommittedResult]);

  useEffect(() => {
    if (!removeTarget) return;
    cancelRemoval.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRemoveTarget(null);
        window.setTimeout(() => removeTrigger.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [removeTarget]);

  async function removeParticipant() {
    if (!removeTarget || busy) return;
    const person = removeTarget;
    setBusy(true);
    setError('');
    try {
      const result = await request<ParticipantRemoval>(
        `/admin/participants/${person.id}`,
        { method: 'DELETE' },
      );
      setRemoveTarget(null);
      await refreshAdmin();
      await refresh(participantId);
      setNotice(
        result.action === 'deleted'
          ? `${person.name} was permanently deleted.`
          : `${person.name} was archived; history was preserved.`,
      );
      window.setTimeout(
        () => document.querySelector<HTMLElement>('.admin-tool-card')?.focus(),
        0,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not remove this person.',
      );
    } finally {
      setBusy(false);
    }
  }

  const activePeople = allParticipants.filter((person) => person.active).length;
  const activePlaces = places.filter((place) => place.active).length;
  const entryGate = (
    <>
      {entryStage === 'loading' ? (
        <section
          className="setup-card"
          data-testid="setup-loading"
          aria-live="polite"
        >
          <p className="eyebrow">WELCOME TO LUNCH ROLLER</p>
          <h2>Checking lunch setup…</h2>
          {pollingError && (
            <>
              <p role="alert">{pollingError}</p>
              <button
                className="button button-light"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </>
          )}
        </section>
      ) : entryStage === 'name' ? (
        <section className="setup-card" data-testid="name-picker">
          <Readiness />
          <p className="eyebrow">YOUR SEAT AT THE TABLE</p>
          <h2>Choose your name</h2>
          <p className="muted">
            Pick your name from the active team roster to enter the lunch wheel.
          </p>
          <form className="setup-form" onSubmit={selectParticipant}>
            <label htmlFor="entry-name">Your name</label>
            <select
              id="entry-name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              required
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
              Enter lunch wheel
            </button>
          </form>
          {error && (
            <p className="setup-error" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section
          className={`setup-card${admin ? ' setup-card-wide' : ''}`}
          data-testid="setup-admin-login"
        >
          <p className="eyebrow">WELCOME TO LUNCH ROLLER</p>
          <h2>Set up your lunch wheel</h2>
          <p className="muted">
            An administrator needs to add the team and lunch places before
            anyone can enter.
          </p>
          {!admin ? (
            <form className="setup-form" onSubmit={login}>
              <label htmlFor="first-run-password">Administrator password</label>
              <input
                id="first-run-password"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                className="button button-dark"
                disabled={busy || !adminPassword}
              >
                Sign in as administrator
              </button>
            </form>
          ) : (
            <div className="setup-admin-content">
              <h3>Build your lunch wheel</h3>
              <div className="setup-counts" aria-live="polite">
                <span>
                  {activePeople} active{' '}
                  {activePeople === 1 ? 'person' : 'people'}
                </span>
                <span>
                  {activePlaces} active{' '}
                  {activePlaces === 1 ? 'place' : 'places'}
                </span>
              </div>
              <div className="setup-columns">
                <section className="setup-step">
                  <h4>People</h4>
                  <form
                    className="setup-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const name = new FormData(form)
                        .get('setup-person')
                        ?.toString()
                        .trim();
                      if (name)
                        void adminSave(
                          '/admin/participants',
                          'POST',
                          { name },
                          'Person added.',
                        ).then(() => form.reset());
                    }}
                  >
                    <label htmlFor="setup-person">New team member name</label>
                    <input
                      id="setup-person"
                      name="setup-person"
                      placeholder="Person’s name"
                      maxLength={100}
                      required
                    />
                    <button className="button button-light" disabled={busy}>
                      Add person
                    </button>
                  </form>
                  <ul className="setup-roster">
                    {allParticipants
                      .filter((person) => person.active)
                      .map((person) => (
                        <li key={person.id}>{person.name}</li>
                      ))}
                  </ul>
                </section>
                <section className="setup-step">
                  <h4>Lunch places</h4>
                  <form
                    className="setup-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = setupPlaceName.trim();
                      if (name)
                        void adminSave(
                          '/admin/places',
                          'POST',
                          { name },
                          'Place added.',
                        ).then(() => setSetupPlaceName(''));
                    }}
                  >
                    <label htmlFor="setup-place">New lunch place</label>
                    <input
                      id="setup-place"
                      value={setupPlaceName}
                      onChange={(event) =>
                        setSetupPlaceName(event.target.value)
                      }
                      placeholder="Lunch place name"
                      maxLength={100}
                      required
                    />
                    <button
                      className="button button-light"
                      disabled={busy || !setupPlaceName.trim()}
                    >
                      Add place
                    </button>
                  </form>
                  <ul className="setup-roster">
                    {places
                      .filter((place) => place.active)
                      .map((place) => (
                        <li key={place.id}>{place.name}</li>
                      ))}
                  </ul>
                </section>
              </div>
              <section className="setup-step setup-schedule">
                <h4>Draw schedule</h4>
                <div className="setup-schedule-fields">
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
                        setSchedule({
                          ...schedule,
                          timezone: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="weekday-options" aria-label="Draw weekdays">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                    (day, index) => {
                      const weekday = index + 1;
                      return (
                        <label key={day}>
                          <input
                            type="checkbox"
                            checked={schedule.weekdays.includes(weekday)}
                            onChange={(event) =>
                              setSchedule({
                                ...schedule,
                                weekdays: event.target.checked
                                  ? [...schedule.weekdays, weekday].sort()
                                  : schedule.weekdays.filter(
                                      (value) => value !== weekday,
                                    ),
                              })
                            }
                          />
                          {day}
                        </label>
                      );
                    },
                  )}
                </div>
                <button
                  className="button button-light"
                  disabled={busy}
                  onClick={() =>
                    void adminSave(
                      '/admin/schedule',
                      'PUT',
                      schedule,
                      'Schedule saved.',
                    )
                  }
                >
                  Save schedule
                </button>
              </section>
              <button
                className="button button-dark setup-finish"
                data-testid="setup-complete"
                disabled={
                  busy || finishingSetup || activePeople < 1 || activePlaces < 1
                }
                onClick={() => void completeFirstRunSetup()}
              >
                {finishingSetup ? 'Finishing setup…' : 'Finish setup'}
              </button>
              <p className="muted setup-hint">
                You need at least one active person and one active lunch place.
              </p>
            </div>
          )}
          {error && (
            <p className="setup-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </>
  );

  return (
    <main
      className={`site-shell${entryStage === 'game' ? '' : ' setup-shell'}`}
    >
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Lunch Roller home">
          <span className="brand-mark">✳</span>{' '}
          <h1 className="brand-title">Lunch Roller</h1>
        </a>
        <div className="top-actions">
          <span className="date-chip">
            {entryStage === 'setup'
              ? 'FIRST-RUN SETUP'
              : (today?.localDate ?? 'TODAY')}{' '}
            · {today?.schedule.timezone ?? 'Europe/Dublin'}
          </span>
          {(entryStage === 'name' || entryStage === 'game') && (
            <a
              href="#admin"
              className="quiet-link"
              onClick={() => adminDisclosure.current?.setAttribute('open', '')}
            >
              Admin
            </a>
          )}
        </div>
      </header>

      {entryStage !== 'game' ? (
        entryGate
      ) : (
        <>
          <section className="hero" id="top" aria-label="Lunch wheel">
            <div className="wheel-card">
              <div
                className="wheel-wrap"
                aria-label={
                  activeReplay
                    ? `Replaying today's saved result for ${today?.result?.localDate ?? ''}`
                    : today?.wheel.mode === 'result'
                      ? `Today's committed result is ${drawnPlace ?? 'saved'} for ${wheelTargetLabel}`
                      : `Live odds for the next scheduled draw on ${wheelTargetLabel}`
                }
              >
                <div className="pointer" aria-hidden="true">
                  ◀
                </div>
                <div
                  className={`wheel ${spin ? 'wheel-spinning' : ''}`}
                  data-testid="lunch-wheel"
                  style={{
                    background: gradient,
                    transform: `rotate(${rotation}deg)`,
                  }}
                  role="img"
                  aria-label={
                    wheelOptions.length
                      ? `Wheel with ${wheelOptions.length} lunch places, sized by ${activeReplay ? "today's saved result snapshot replay" : today?.wheel.mode === 'result' ? "today's committed draw snapshot" : 'live odds for the next scheduled draw'}`
                      : 'Empty lunch wheel'
                  }
                >
                  {wheelOptions.length
                    ? wheelOptions
                        .map((option, index) => ({ option, index }))
                        .filter(({ option }) => option.probability >= 0.05)
                        .map(({ option, index }) => (
                          <span
                            className="wheel-label"
                            key={option.placeId}
                            title={option.name}
                            aria-label={option.name}
                            style={{
                              transform: `rotate(${(wheelOptions.slice(0, index).reduce((sum, item) => sum + item.probability, 0) + option.probability / 2) * 360}deg) translateY(-28cqw) rotate(-90deg)`,
                            }}
                          >
                            {option.name.length > 14
                              ? `${option.name.slice(0, 13)}…`
                              : option.name}
                          </span>
                        ))
                    : null}
                </div>
                <button
                  type="button"
                  className="wheel-hub"
                  disabled={!today?.result || spin}
                  onClick={replayResult}
                  aria-label={
                    today?.result
                      ? 'Replay wheel animation'
                      : 'Waiting for the scheduled draw'
                  }
                  title={
                    today?.result
                      ? 'Replay the saved result'
                      : 'The next draw runs on the schedule'
                  }
                >
                  <span aria-hidden="true">{today?.result ? '↻' : '◷'}</span>
                </button>
              </div>
              <div className="wheel-footer">
                <span className="wheel-state">
                  {activeReplay
                    ? "REPLAYING TODAY'S RESULT"
                    : today?.wheel.mode === 'result'
                      ? "TODAY'S RESULT"
                      : 'LIVE ODDS FOR NEXT DRAW'}
                </span>
                <strong
                  data-testid="wheel-target"
                  data-target-date={
                    activeReplay && today?.result
                      ? today.result.localDate
                      : wheelTargetDate
                  }
                >
                  {activeReplay && today?.result
                    ? `Saved pick · ${today.result.localDate}`
                    : today?.wheel.mode === 'result'
                      ? drawnPlace
                        ? `${drawnPlace} · ${wheelTargetLabel}`
                        : wheelTargetLabel
                      : wheelTargetLabel
                        ? `Scheduled for ${wheelTargetLabel}`
                        : 'Loading schedule'}
                </strong>
                {today?.result && (
                  <button
                    className="replay-button"
                    type="button"
                    onClick={replayResult}
                    disabled={spin}
                    aria-label="Replay today's result"
                  >
                    ↻ Replay today&apos;s result
                  </button>
                )}
              </div>
            </div>
            <div className="wheel-status">
              <Readiness />
              {pollingError && (
                <p className="refresh-error" role="status" aria-live="polite">
                  {pollingError}
                </p>
              )}
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
                  <h2>You</h2>
                </div>
                <span className="mini-icon">↗</span>
              </div>
              <p className="muted">
                Check in and use your tokens to influence future lunches.
              </p>
              {currentName && (
                <button
                  type="button"
                  className="quiet-link change-name"
                  data-testid="change-name"
                  onClick={changeName}
                >
                  Change name
                </button>
              )}
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
                  onClick={() =>
                    pushOn ? void disablePush() : void togglePush()
                  }
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
                  <h2>Places</h2>
                </div>
                <span className="odds-total">{odds.length} PLACES</span>
              </div>
              <p className="muted">
                Current chances for the next draw. More tokens can nudge the
                odds.
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
                  const input = new FormData(form)
                    .get('place')
                    ?.toString()
                    .trim();
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
                <div className="result-note" data-testid="today-result">
                  <span>✳</span>
                  <p>
                    Today&apos;s pick was{' '}
                    <strong>{today.result.placeName}</strong> on{' '}
                    <time dateTime={today.result.localDate}>
                      {new Intl.DateTimeFormat('en-GB', {
                        dateStyle: 'medium',
                        timeZone: 'UTC',
                      }).format(
                        new Date(`${today.result.localDate}T00:00:00Z`),
                      )}
                    </time>
                    . The winner&apos;s weight is halved for next time.
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
      {(entryStage === 'name' || entryStage === 'game') && (
        <details className="admin-disclosure" id="admin" ref={adminDisclosure}>
          <summary>Admin tools</summary>
          <section className="admin-section">
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
                <div className="admin-tool-card" tabIndex={-1}>
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
                            person.active
                              ? 'Person archived.'
                              : 'Person restored.',
                          )
                        }
                      >
                        {person.active ? 'Archive' : 'Restore'}
                      </button>
                      <button
                        ref={removeTrigger}
                        aria-label={`Remove ${person.name}`}
                        disabled={busy}
                        onClick={(event) => {
                          removeTrigger.current = event.currentTarget;
                          setRemoveTarget(person);
                        }}
                      >
                        Remove
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
                            place.active
                              ? 'Place archived.'
                              : 'Place restored.',
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
                          setSchedule({
                            ...schedule,
                            timezone: event.target.value,
                          })
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
        </details>
      )}

      <footer className="footer">
        <span className="brand">
          <span className="brand-mark">✳</span> LUNCH ROLLER
        </span>
        <Link href="/api/v1/health">Service health ↗</Link>
      </footer>
      {removeTarget && (
        <div className="dialog-backdrop">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-person-heading"
            aria-describedby="remove-person-description"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              if (busy) {
                event.preventDefault();
                cancelRemoval.current?.focus();
                return;
              }
              if (
                event.shiftKey &&
                document.activeElement === cancelRemoval.current
              ) {
                event.preventDefault();
                confirmRemoval.current?.focus();
              } else if (
                !event.shiftKey &&
                document.activeElement === confirmRemoval.current
              ) {
                event.preventDefault();
                cancelRemoval.current?.focus();
              } else if (
                document.activeElement !== cancelRemoval.current &&
                document.activeElement !== confirmRemoval.current
              ) {
                event.preventDefault();
                (event.shiftKey
                  ? confirmRemoval.current
                  : cancelRemoval.current
                )?.focus();
              }
            }}
          >
            <h2 id="remove-person-heading">Remove person?</h2>
            <p id="remove-person-description">
              Remove <strong>{removeTarget.name}</strong>? Profiles without
              history are deleted. Profiles with history are archived, with
              their history preserved.
            </p>
            <div className="dialog-actions">
              <button
                ref={cancelRemoval}
                className="button button-light"
                type="button"
                onClick={() => {
                  setRemoveTarget(null);
                  window.setTimeout(() => removeTrigger.current?.focus(), 0);
                }}
              >
                Cancel
              </button>
              <button
                ref={confirmRemoval}
                className="button button-dark"
                type="button"
                disabled={busy}
                onClick={() => void removeParticipant()}
              >
                Remove person
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="announcement" aria-live="polite" role="status">
        {error || notice}
      </div>
    </main>
  );
}
