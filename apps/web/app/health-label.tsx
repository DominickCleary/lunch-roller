'use client'

import type { HealthBonus, HealthLevel } from '@lunch/contracts'

const labels: Record<HealthLevel, string> = {
  treat: 'Treat',
  balanced: 'Balanced',
  healthy: 'Healthy',
}
export function HealthBadge({ level }: { level?: HealthLevel }) {
  return level ? (
    <span className={`health-badge health-${level}`}>{labels[level]}</span>
  ) : null
}
export function HealthSelect({
  label = 'Health level',
  name = 'healthLevel',
  value,
  onChange,
  disabled,
}: {
  label?: string
  name?: string
  value?: HealthLevel
  onChange?: (value: HealthLevel) => void
  disabled?: boolean
}) {
  return (
    <label className="health-select">
      Health level
      <select
        name={name}
        aria-label={label}
        value={value}
        defaultValue={value === undefined ? 'balanced' : undefined}
        disabled={disabled}
        onChange={
          onChange
            ? (event) => onChange(event.target.value as HealthLevel)
            : undefined
        }
      >
        <option value="treat">Treat</option>
        <option value="balanced">Balanced</option>
        <option value="healthy">Healthy</option>
      </select>
    </label>
  )
}
export function HealthBonusSummary({
  bonus,
  winner,
}: {
  bonus: HealthBonus
  winner: string
}) {
  return (
    <section
      className="health-bonus-summary"
      aria-label="Automatic health bonus"
    >
      <h3>Health balance bonus</h3>
      <p>
        {winner} was a Treat place. Healthy alternatives received ×
        {bonus.multiplier} weight for future draws.
      </p>
      <ul>
        {bonus.places.map((place) => (
          <li key={place.placeId}>
            <strong>{place.name}</strong>
            <span>
              {(place.probabilityBefore * 100).toFixed(1)}% →{' '}
              {(place.probabilityAfter * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        Chances immediately before and after the automatic bonus, following the
        winner’s normal halving. No tokens spent.
      </p>
    </section>
  )
}
