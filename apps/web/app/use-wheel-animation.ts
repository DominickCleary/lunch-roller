'use client'

import type { Draw } from '@lunch/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { animationPlan, spinIsLive, spinRotation } from '../lib/wheel-animation'
import { wheelSliceColor } from '../lib/wheel-colors'

type Mode = 'result' | 'upcoming' | undefined
type Kind = 'live' | 'replay' | null
export function useWheelAnimation({
  result,
  mode,
  displayKey,
  getServerNow,
  revealPending,
  colors,
}: {
  result: Draw | null | undefined
  mode: Mode
  displayKey: string
  getServerNow: () => number
  revealPending: boolean
  colors: readonly string[]
}) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const listenerRef = useRef<(() => void) | null>(null)
  const runRef = useRef<{ id: string; kind: Kind } | null>(null)
  const viewRef = useRef({ mode, result })
  const celebrationRef = useRef<Draw | null>(null)
  const [celebration, setCelebration] = useState<Draw | null>(null)
  const observedKey = useRef('')
  const [kind, setKind] = useState<Kind>(null)
  const [presentedId, setPresentedId] = useState<string | null | undefined>(
    undefined,
  )
  const [rotation, setRotation] = useState(0)
  const [pointerColor, setPointerColor] = useState<string>(
    colors[0] ?? '#d9ddd1',
  )
  const [snapshot, setSnapshot] = useState<Draw['snapshot'] | null>(null)
  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    listenerRef.current?.()
    listenerRef.current = null
    frameRef.current = null
    timerRef.current = null
    runRef.current = null
  }, [])
  const start = useCallback(
    (draw: Draw, nextKind: Exclude<Kind, null>) => {
      stop()
      const plan = animationPlan(draw)
      const reduced = matchMedia('(prefers-reduced-motion: reduce)')
      const startTime =
        nextKind === 'live' ? Date.parse(plan.startsAt) : performance.now()
      const now = nextKind === 'live' ? getServerNow : () => performance.now()
      const run = { id: draw.id, kind: nextKind }
      runRef.current = run
      setPresentedId(draw.id)
      setKind(nextKind)
      setSnapshot(draw.snapshot)
      setRotation(0)
      setPointerColor(wheelSliceColor(draw.snapshot, 0, colors))
      const finish = () => {
        if (runRef.current !== run) return
        stop()
        setKind(null)
        celebrationRef.current = draw
        setCelebration(draw)
        const angle = plan.rotation
        setRotation(angle)
        setPointerColor(wheelSliceColor(draw.snapshot, angle, colors))
        if (wheelRef.current)
          wheelRef.current.style.transform = `rotate(${angle}deg)`
      }
      const paint = () => {
        if (runRef.current !== run) return
        const elapsed = now() - startTime
        const angle = spinRotation(plan, elapsed)
        if (wheelRef.current)
          wheelRef.current.style.transform = `rotate(${angle}deg)`
        setPointerColor(wheelSliceColor(draw.snapshot, angle, colors))
        if (elapsed >= plan.durationMs) finish()
        else frameRef.current = requestAnimationFrame(paint)
      }
      if (reduced.matches) {
        setRotation(plan.rotation)
        setPointerColor(wheelSliceColor(draw.snapshot, plan.rotation, colors))
        if (wheelRef.current)
          wheelRef.current.style.transform = `rotate(${plan.rotation}deg)`
        timerRef.current = window.setTimeout(
          finish,
          nextKind === 'replay' ? 1500 : 0,
        )
      } else {
        const onReduced = () => {
          if (reduced.matches) finish()
        }
        reduced.addEventListener('change', onReduced)
        listenerRef.current = () =>
          reduced.removeEventListener('change', onReduced)
        frameRef.current = requestAnimationFrame(paint)
        timerRef.current = window.setTimeout(
          finish,
          Math.max(0, plan.durationMs - (now() - startTime)) + 100,
        )
      }
    },
    [colors, getServerNow, stop],
  )

  useEffect(() => {
    viewRef.current = { mode, result }
    if (!mode || celebrationRef.current || runRef.current?.kind === 'replay')
      return
    const key = `${displayKey}:${result?.id ?? ''}`
    if (observedKey.current === key) return
    if (runRef.current?.id === result?.id && runRef.current?.kind === 'live') {
      observedKey.current = key
      return
    }
    stop()
    const plan = result ? animationPlan(result) : null
    const frame = requestAnimationFrame(() => {
      observedKey.current = key
      if (result && plan && spinIsLive(plan, getServerNow()))
        start(result, 'live')
      else {
        setPresentedId(result?.id)
        setKind(null)
        setSnapshot(null)
        setRotation(mode === 'result' && plan ? plan.rotation : 0)
        if (result && mode === 'result')
          setPointerColor(
            wheelSliceColor(result.snapshot, plan?.rotation ?? 0, colors),
          )
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [result, mode, displayKey, getServerNow, start, stop, colors])

  useEffect(() => stop, [stop])
  const joining = revealPending && presentedId !== result?.id
  return {
    wheelRef,
    rotation,
    pointerColor,
    spin: kind !== null || joining,
    live: kind === 'live' || joining,
    snapshot: snapshot ?? (joining ? (result?.snapshot ?? null) : null),
    celebration,
    closeCelebration: () => {
      celebrationRef.current = null
      setCelebration(null)
      const current = viewRef.current
      if (
        current.result &&
        spinIsLive(animationPlan(current.result), getServerNow()) &&
        current.result.id !== celebration?.id
      ) {
        start(current.result, 'live')
        return
      }
      setSnapshot(null)
      const angle =
        current.mode === 'result' && current.result
          ? animationPlan(current.result).rotation
          : 0
      setRotation(angle)
      if (current.result && current.mode === 'result')
        setPointerColor(wheelSliceColor(current.result.snapshot, angle, colors))
      if (wheelRef.current)
        wheelRef.current.style.transform = `rotate(${angle}deg)`
    },
    replay: () => {
      if (result && !runRef.current && !celebrationRef.current)
        start(result, 'replay')
    },
  }
}
