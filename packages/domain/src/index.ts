export const RULES = Object.freeze({
  attendanceReward: 10,
  influenceCost: 5,
  addPlaceCost: 20,
});
export type WeightedPlace = Readonly<{ id: string; logWeight: number }>;
export type Influence = 'boost' | 'reduce';

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Weight must be finite');
  return value;
}

function logMean(weights: readonly number[]): number {
  if (weights.length === 0) return 0;
  const max = Math.max(...weights.map(finite));
  return (
    max +
    Math.log(weights.reduce((sum, weight) => sum + Math.exp(weight - max), 0)) -
    Math.log(weights.length)
  );
}

export function probabilities(
  places: readonly WeightedPlace[],
): { id: string; probability: number }[] {
  if (places.length === 0) return [];
  if (new Set(places.map((place) => place.id)).size !== places.length)
    throw new Error('Duplicate place ID');
  const max = Math.max(...places.map((place) => finite(place.logWeight)));
  const relative = places.map((place) => Math.exp(place.logWeight - max));
  const total = relative.reduce((sum, weight) => sum + weight, 0);
  return places.map((place, index) => ({
    id: place.id,
    probability: relative[index]! / total,
  }));
}

/** Supply a uniform sample in [0, 1), from server-side crypto in production. */
export function selectPlace(
  places: readonly WeightedPlace[],
  sample: number,
): string | null {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error('Sample must be in [0, 1)');
  const odds = probabilities(places);
  let cumulative = 0;
  let lastPositive: string | null = null;
  for (const place of odds) {
    if (place.probability <= 0) continue;
    lastPositive = place.id;
    cumulative += place.probability;
    if (sample < cumulative) return place.id;
  }
  return lastPositive;
}

export function halveWeight(logWeight: number): number {
  return finite(logWeight) - Math.LN2;
}

export function influenceWeight(logWeight: number, action: Influence): number {
  if (action !== 'boost' && action !== 'reduce')
    throw new Error('Unknown influence action');
  return finite(logWeight) + Math.log(action === 'boost' ? 1.25 : 0.8);
}

export function newPlaceLogWeight(places: readonly WeightedPlace[]): number {
  return logMean(places.map((place) => place.logWeight));
}

export function spendTokens(
  balance: number,
  action: Influence | 'add-place',
): number {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error('Invalid token balance');
  if (!['boost', 'reduce', 'add-place'].includes(action))
    throw new Error('Unknown purchase');
  const cost =
    action === 'add-place' ? RULES.addPlaceCost : RULES.influenceCost;
  if (balance < cost) throw new Error('Insufficient tokens');
  return balance - cost;
}
