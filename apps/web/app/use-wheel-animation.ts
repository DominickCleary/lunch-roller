'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draw } from '@lunch/contracts';
import {
  animationPlan,
  spinIsLive,
  spinRotation,
} from '../lib/wheel-animation';

type Mode = 'result' | 'upcoming' | undefined;
type Kind = 'live' | 'replay' | null;
export function useWheelAnimation({
  result,
  mode,
  displayKey,
  getServerNow,
  revealPending,
}: {
  result: Draw | null | undefined;
  mode: Mode;
  displayKey: string;
  getServerNow: () => number;
  revealPending: boolean;
}) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const listenerRef = useRef<(() => void) | null>(null);
  const runRef = useRef<{ id: string; kind: Kind } | null>(null);
  const viewRef = useRef({ mode, resultId: result?.id });
  const observedKey = useRef('');
  const [kind, setKind] = useState<Kind>(null);
  const [presentedId, setPresentedId] = useState<string | null | undefined>(
    undefined,
  );
  const [rotation, setRotation] = useState(0);
  const [snapshot, setSnapshot] = useState<Draw['snapshot'] | null>(null);
  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    listenerRef.current?.();
    listenerRef.current = null;
    frameRef.current = null;
    timerRef.current = null;
    runRef.current = null;
  }, []);
  const start = useCallback(
    (draw: Draw, nextKind: Exclude<Kind, null>) => {
      stop();
      const plan = animationPlan(draw);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      const startTime =
        nextKind === 'live' ? Date.parse(plan.startsAt) : performance.now();
      const now = nextKind === 'live' ? getServerNow : () => performance.now();
      const run = { id: draw.id, kind: nextKind };
      runRef.current = run;
      setPresentedId(draw.id);
      setKind(nextKind);
      setSnapshot(draw.snapshot);
      setRotation(0);
      const finish = () => {
        if (runRef.current !== run) return;
        stop();
        setKind(null);
        setSnapshot(null);
        const angle =
          viewRef.current.mode === 'result' &&
          viewRef.current.resultId === draw.id
            ? plan.rotation
            : 0;
        setRotation(angle);
        if (wheelRef.current)
          wheelRef.current.style.transform = `rotate(${angle}deg)`;
      };
      const paint = () => {
        if (runRef.current !== run) return;
        const elapsed = now() - startTime;
        if (wheelRef.current)
          wheelRef.current.style.transform = `rotate(${spinRotation(plan, elapsed)}deg)`;
        if (elapsed >= plan.durationMs) finish();
        else frameRef.current = requestAnimationFrame(paint);
      };
      if (reduced.matches) {
        setRotation(plan.rotation);
        if (wheelRef.current)
          wheelRef.current.style.transform = `rotate(${plan.rotation}deg)`;
        timerRef.current = window.setTimeout(
          finish,
          nextKind === 'replay' ? 1500 : 0,
        );
      } else {
        const onReduced = () => {
          if (reduced.matches) finish();
        };
        reduced.addEventListener('change', onReduced);
        listenerRef.current = () =>
          reduced.removeEventListener('change', onReduced);
        frameRef.current = requestAnimationFrame(paint);
        timerRef.current = window.setTimeout(
          finish,
          Math.max(0, plan.durationMs - (now() - startTime)) + 100,
        );
      }
    },
    [getServerNow, stop],
  );

  useEffect(() => {
    viewRef.current = { mode, resultId: result?.id };
    if (!mode) return;
    const key = `${displayKey}:${result?.id ?? ''}`;
    if (observedKey.current === key) return;
    if (runRef.current?.id === result?.id && runRef.current?.kind === 'live') {
      observedKey.current = key;
      return;
    }
    stop();
    const plan = result ? animationPlan(result) : null;
    const frame = requestAnimationFrame(() => {
      observedKey.current = key;
      if (result && plan && spinIsLive(plan, getServerNow()))
        start(result, 'live');
      else {
        setPresentedId(result?.id);
        setKind(null);
        setSnapshot(null);
        setRotation(mode === 'result' && plan ? plan.rotation : 0);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [result, mode, displayKey, getServerNow, start, stop]);

  useEffect(() => stop, [stop]);
  const joining = revealPending && presentedId !== result?.id;
  return {
    wheelRef,
    rotation,
    spin: kind !== null || joining,
    live: kind === 'live' || joining,
    snapshot: snapshot ?? (joining ? (result?.snapshot ?? null) : null),
    replay: () => {
      if (result && !runRef.current) start(result, 'replay');
    },
  };
}
