import type { Draw } from '@lunch/contracts'

export const wheelColors = [
  '#ba7868',
  '#cbb36f',
  '#7fa487',
  '#819dba',
  '#b49bba',
  '#a5a384',
] as const

export function wheelSliceColor(
  options: readonly Pick<Draw['snapshot'][number], 'probability'>[],
  rotation: number,
  palette: readonly string[] = wheelColors,
) {
  if (!options.length) return '#d9ddd1'
  const angle = (((90 - (rotation % 360)) % 360) + 360) % 360
  let end = 0
  for (let index = 0; index < options.length; index += 1) {
    end += (options[index]?.probability ?? 0) * 360
    if (angle < end || index === options.length - 1)
      return palette[index % palette.length] ?? '#d9ddd1'
  }
  return palette[0] ?? '#d9ddd1'
}

/** Keep the current winner under the pointer as live slices resize. */
export function wheelRestingRotation(
  options: readonly Pick<Draw['snapshot'][number], 'placeId' | 'probability'>[],
  winnerId: string | undefined,
) {
  let before = 0
  for (const option of options) {
    if (option.placeId === winnerId && option.probability > 0)
      return (
        (((90 - (before + option.probability / 2) * 360) % 360) + 360) % 360
      )
    before += option.probability
  }
  return 0
}
