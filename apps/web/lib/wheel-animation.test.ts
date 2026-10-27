import type { Draw } from '@lunch/contracts'
import { expect, it } from 'vitest'
import {
  animationPlan,
  serverClockAnchor,
  spinIsLive,
  spinRotation,
} from './wheel-animation'

const draw: Draw = {
  id: '19317709-907d-4789-9f39-54facb5c1f99',
  localDate: '2026-10-21',
  timezone: 'UTC',
  placeId: 'a',
  placeName: 'A',
  drawnAt: '2026-10-21T11:30:00.000Z',
  snapshot: [
    { placeId: 'a', name: 'A', probability: 0.5, logWeight: 0 },
    { placeId: 'b', name: 'B', probability: 0.5, logWeight: 0 },
  ],
}
it('replays a fixed plan with forward-only friction and a long slow finish', () => {
  const plan = animationPlan(draw)
  expect(animationPlan(structuredClone(draw))).toEqual(plan)
  expect(plan.durationMs).toBeGreaterThanOrEqual(18000)
  expect(spinRotation(plan, -100)).toBe(0)
  expect(spinRotation(plan, 0)).toBe(0)
  const end = spinRotation(plan, plan.durationMs)
  expect(end % 360).toBeCloseTo(plan.rotation)
  expect(spinRotation(plan, plan.durationMs + 5000)).toBe(end)
  let previous = 0
  for (let ms = 0; ms <= plan.durationMs; ms += 100) {
    const current = spinRotation(plan, ms)
    expect(current).toBeGreaterThanOrEqual(previous)
    previous = current
  }
  expect(end - spinRotation(plan, plan.durationMs - 2000)).toBeGreaterThan(0.1)
  expect(end - spinRotation(plan, plan.durationMs - 2000)).toBeLessThan(10)
  expect(spinRotation(plan, 1000)).toBeGreaterThan(360)
  const point = (90 - plan.rotation + 360) % 360
  expect(point).toBeGreaterThan(0)
  expect(point).toBeLessThan(180)
  expect(point).not.toBeCloseTo(90)
})
it('keeps clients with different local clocks on the same absolute phase', () => {
  const serverTime = '2026-10-21T11:30:10.000Z'
  const first = serverClockAnchor(
    serverTime,
    0,
    100,
    Date.parse(serverTime) + 3600000,
  )
  const second = serverClockAnchor(
    serverTime,
    2000,
    2100,
    Date.parse(serverTime) - 7200000,
  )
  const firstNow = first.serverMs + 150 - first.clientMs
  const secondNow = second.serverMs + 2150 - second.clientMs
  expect(firstNow).toBe(secondNow)
  const plan = animationPlan(draw)
  expect(spinRotation(plan, firstNow - Date.parse(plan.startsAt))).toBe(
    spinRotation(plan, secondNow - Date.parse(plan.startsAt)),
  )
  expect(spinIsLive(plan, Date.parse(draw.drawnAt))).toBe(true)
  expect(spinIsLive(plan, Date.parse(plan.startsAt) + plan.durationMs)).toBe(
    false,
  )
  expect(spinIsLive(plan, Date.parse(draw.drawnAt) - 86400000)).toBe(false)
})
