/** Readable theoretical net odds; settlement always uses the exact probability. */
export function approximateOdds(probability: number): string {
  if (!Number.isFinite(probability) || probability <= 0) return '—'
  const against = (1 - probability) / probability
  if (against <= 0) return '0/1'
  if (!Number.isFinite(against)) return 'Long shot'
  const format = (value: number) =>
    new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: 1,
      notation: value >= 10000 ? 'compact' : 'standard',
    }).format(value)
  if (against >= 1) {
    const rounded =
      against < 3 ? Math.round(against * 2) / 2 : Math.round(against)
    return `${Math.abs(rounded - against) < 1e-10 && rounded < 10000 ? '' : '≈ '}${format((rounded * 2) % 2 ? rounded * 2 : rounded)}/${(rounded * 2) % 2 ? 2 : 1}`
  }
  const fractions = [
    [1, 10],
    [1, 8],
    [1, 6],
    [1, 5],
    [1, 4],
    [1, 3],
    [2, 5],
    [1, 2],
    [3, 5],
    [2, 3],
    [3, 4],
    [4, 5],
    [1, 1],
  ] as const
  const [numerator, denominator] =
    against < 0.1
      ? [1, Math.round(1 / against)]
      : fractions.reduce((best, item) =>
          Math.abs(item[0] / item[1] - against) <
          Math.abs(best[0] / best[1] - against)
            ? item
            : best,
        )
  return `${Math.abs(numerator / denominator - against) < 1e-10 && denominator < 10000 ? '' : '≈ '}${numerator}/${format(denominator)}`
}
export function weightInput(logWeight: number): string {
  const weight = Math.exp(logWeight)
  return Number.isFinite(weight) && weight > 0
    ? Number(weight.toPrecision(8)).toString()
    : ''
}
