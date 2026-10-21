import type { Draw } from '@lunch/contracts';

export const wheelColors = [
  '#ba7868',
  '#cbb36f',
  '#7fa487',
  '#819dba',
  '#b49bba',
  '#a5a384',
] as const;

export function wheelSliceColor(
  options: readonly Pick<Draw['snapshot'][number], 'probability'>[],
  rotation: number,
  palette: readonly string[] = wheelColors,
) {
  if (!options.length) return '#d9ddd1';
  const angle = (((90 - (rotation % 360)) % 360) + 360) % 360;
  let end = 0;
  for (let index = 0; index < options.length; index += 1) {
    end += (options[index]?.probability ?? 0) * 360;
    if (angle < end || index === options.length - 1)
      return palette[index % palette.length] ?? '#d9ddd1';
  }
  return palette[0] ?? '#d9ddd1';
}
