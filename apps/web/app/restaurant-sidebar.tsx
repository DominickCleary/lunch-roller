'use client'

import type {
  BettingWindow,
  EconomySettings,
  HealthLevel,
  InfluencePosition,
  TodayResponse,
} from '@lunch/contracts'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { approximateOdds } from '../lib/odds'
import { wheelColors } from '../lib/wheel-colors'
import { HealthSelect } from './health-label'
import { InfluenceControls } from './influence-controls'

type Props = {
  odds: TodayResponse['odds']
  checkIns: TodayResponse['restaurantCheckIns']
  positions: InfluencePosition[]
  window: BettingWindow | null
  economy: EconomySettings
  balance: number
  busy: boolean
  influenceBusy: boolean
  influenceError: string
  identityReady: boolean
  pausedMessage: string
  onRetry: () => void
  onChangeInfluence: (
    placeId: string,
    action: 'boost' | 'reduce',
    change: 1 | -1,
  ) => void
  onRefund: (placeId: string) => void
  onBanish: (placeId: string, name: string) => void
  onAddPlace: (name: string, healthLevel: HealthLevel) => Promise<boolean>
}

const sortDelayMs = 2000

function sortedOddsIds(odds: TodayResponse['odds']) {
  return [...odds]
    .sort((a, b) => b.probability - a.probability)
    .map((option) => option.placeId)
}

export function RestaurantSidebar({
  odds,
  checkIns,
  positions,
  window,
  economy,
  balance,
  busy,
  influenceBusy,
  influenceError,
  identityReady,
  pausedMessage,
  onRetry,
  onChangeInfluence,
  onRefund,
  onBanish,
  onAddPlace,
}: Props) {
  const [showFairOdds, setShowFairOdds] = useState(false)
  const [newPlaceName, setNewPlaceName] = useState('')
  const [newPlaceHealth, setNewPlaceHealth] = useState<HealthLevel>('balanced')
  const [orderedPlaceIds, setOrderedPlaceIds] = useState(() =>
    sortedOddsIds(odds),
  )
  const latestOdds = useRef(odds)
  latestOdds.current = odds
  const oddsSignature = JSON.stringify(
    odds.map(({ placeId, probability }) => [placeId, probability]),
  )
  const hasInitialOrder = useRef(odds.length > 0)
  const maxCheckIns = Math.max(0, ...checkIns.map((entry) => entry.count))
  const topCheckInPlaces = new Set(
    maxCheckIns > 0
      ? checkIns
          .filter((entry) => entry.count === maxCheckIns)
          .map((entry) => entry.placeId)
      : [],
  )
  useEffect(() => {
    if (oddsSignature === '[]') {
      hasInitialOrder.current = false
      setOrderedPlaceIds([])
      return
    }

    if (!hasInitialOrder.current) {
      hasInitialOrder.current = true
      setOrderedPlaceIds(sortedOddsIds(latestOdds.current))
      return
    }

    const timer = globalThis.setTimeout(
      () => setOrderedPlaceIds(sortedOddsIds(latestOdds.current)),
      sortDelayMs,
    )
    return () => globalThis.clearTimeout(timer)
  }, [oddsSignature])

  const orderedOdds = useMemo(() => {
    const byId = new Map(odds.map((option) => [option.placeId, option]))
    const ordered = orderedPlaceIds
      .map((placeId) => byId.get(placeId))
      .filter((option) => option !== undefined)
    const orderedIds = new Set(orderedPlaceIds)
    return [
      ...ordered,
      ...odds.filter((option) => !orderedIds.has(option.placeId)),
    ]
  }, [odds, orderedPlaceIds])

  async function addPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newPlaceName.trim()
    if (!name) return
    if (await onAddPlace(name, newPlaceHealth)) {
      setNewPlaceName('')
      setNewPlaceHealth('balanced')
    }
  }

  return (
    <div className="panel odds-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 / THE ODDS</p>
          <h2>Lunch spot</h2>
        </div>
        <span className="odds-total">{odds.length} PLACES</span>
      </div>
      <p className="muted">Current chances for the next draw.</p>
      {influenceError && (
        <p className="refresh-error" role="status">
          {influenceError}{' '}
          <button className="ledger-toggle" type="button" onClick={onRetry}>
            Retry positions
          </button>
        </p>
      )}
      <fieldset
        className="odds-format-toggle"
        aria-label="Choose how restaurant odds are shown"
      >
        <button
          type="button"
          aria-pressed={!showFairOdds}
          onClick={() => setShowFairOdds(false)}
        >
          Chances
        </button>
        <button
          type="button"
          aria-pressed={showFairOdds}
          onClick={() => setShowFairOdds(true)}
        >
          Odds
        </button>
      </fieldset>
      {pausedMessage && (
        <p className="muted" role="status">
          {pausedMessage}
        </p>
      )}
      <div className="odds-list">
        {orderedOdds.map((option, index) => {
          const position = positions.find(
            (entry) => entry.placeId === option.placeId,
          )
          return (
            <div
              className={`odds-row${topCheckInPlaces.has(option.placeId) ? ' odds-row-most-checkins' : ''}`}
              key={option.placeId}
            >
              <span
                className="odds-color"
                style={{
                  background: wheelColors[index % wheelColors.length],
                }}
              />
              <InfluenceControls
                placeId={option.placeId}
                placeName={option.name}
                healthLevel={option.healthLevel}
                position={position}
                window={window}
                balance={balance}
                boostCost={economy.boostCost}
                reduceCost={economy.reduceCost}
                busy={busy || influenceBusy || Boolean(influenceError)}
                identityReady={identityReady}
                onChange={onChangeInfluence}
                onRefund={onRefund}
              />
              <span className="odds-bar">
                <span
                  style={{
                    width: `${Math.max(option.probability * 100, option.probability > 0 ? 0.5 : 0)}%`,
                    background: wheelColors[index % wheelColors.length],
                  }}
                />
              </span>
              <strong
                title={`${(option.probability * 100).toPrecision(6)}% chance. Odds show approximate net winnings per token staked; payouts use the exact final chance.`}
              >
                {showFairOdds
                  ? approximateOdds(option.probability)
                  : `${(option.probability * 100).toFixed(1)}%`}
              </strong>
              <div className="influence-buttons">
                <button
                  type="button"
                  className="remove-place-control"
                  aria-label={`Banish ${option.name} from the wheel for ${economy.removePlaceCost} tokens`}
                  title={`Banish ${option.name} for ${economy.removePlaceCost} tokens`}
                  disabled={busy || !identityReady || Boolean(pausedMessage)}
                  onClick={() => onBanish(option.placeId, option.name)}
                >
                  ×
                </button>
              </div>
            </div>
          )
        })}
        {!odds.length && (
          <p className="empty-note">
            The admin can add places to get the wheel rolling.
          </p>
        )}
      </div>
      <form className="add-place" onSubmit={(event) => void addPlace(event)}>
        <label htmlFor="place-name">Have a new spot in mind?</label>
        <div className="inline-form">
          <input
            id="place-name"
            name="place"
            placeholder={`Add a lunch place · ${economy.addPlaceCost} tokens`}
            maxLength={100}
            required
            value={newPlaceName}
            onChange={(event) => setNewPlaceName(event.target.value)}
            disabled={!identityReady || busy || Boolean(pausedMessage)}
          />
          <button
            type="submit"
            className="button button-light"
            disabled={!identityReady || busy || Boolean(pausedMessage)}
          >
            Add place
          </button>
          <HealthSelect
            label="New spot health level"
            value={newPlaceHealth}
            onChange={setNewPlaceHealth}
            disabled={!identityReady || busy || Boolean(pausedMessage)}
          />
        </div>
      </form>
    </div>
  )
}
