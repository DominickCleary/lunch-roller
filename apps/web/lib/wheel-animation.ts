import type { Draw, WheelAnimation } from '@lunch/contracts';

/** Historical/offline DTO fallback; current server responses always supply a plan. */
export function animationPlan(result: Draw): WheelAnimation {
  if (result.animation) return result.animation;
  let hash = 2166136261;
  for (const char of result.id)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const index = result.snapshot.findIndex(
    (place) => place.placeId === result.placeId,
  );
  const before = result.snapshot
    .slice(0, Math.max(0, index))
    .reduce((sum, place) => sum + place.probability, 0);
  const probability = result.snapshot[index]?.probability ?? 0;
  const total =
    result.snapshot.reduce((sum, place) => sum + place.probability, 0) || 1;
  const fraction = 0.02 + ((hash % 10001) / 10000) * 0.96;
  return {
    version: 1,
    rotation:
      (((90 - ((before + probability * fraction) / total) * 360) % 360) + 360) %
      360,
    turns: 9 + (hash % 4),
    durationMs: 18000 + (hash % 4) * 1000,
    startsAt: new Date(Date.parse(result.drawnAt) + 3000).toISOString(),
  };
}

/** Cubic friction: fast early turns, then several seconds crossing the last few degrees. */
export function spinRotation(plan: WheelAnimation, elapsedMs: number): number {
  const progress = Math.max(0, Math.min(1, elapsedMs / plan.durationMs));
  return (plan.turns * 360 + plan.rotation) * (1 - (1 - progress) ** 3);
}
export function spinIsLive(plan: WheelAnimation, serverNow: number): boolean {
  return (
    serverNow >= Date.parse(plan.startsAt) - 4000 &&
    serverNow < Date.parse(plan.startsAt) + plan.durationMs
  );
}

/** Estimate server time at the network midpoint, then advance on a monotonic clock. */
export function serverClockAnchor(
  serverTime: string | undefined,
  requestedAt: number,
  receivedAt: number,
  fallbackNow: number,
) {
  const parsed = serverTime ? Date.parse(serverTime) : NaN;
  return {
    serverMs: Number.isFinite(parsed) ? parsed : fallbackNow,
    clientMs: Number.isFinite(parsed)
      ? (requestedAt + receivedAt) / 2
      : receivedAt,
  };
}
