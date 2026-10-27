/** Format a workplace calendar date without converting it to the browser's zone. */
export function calendarDateLabel(localDate: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${localDate}T00:00:00Z`))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('weekday')}, ${value('day')} ${value('month')}`
}
