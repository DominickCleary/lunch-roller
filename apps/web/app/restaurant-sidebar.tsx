'use client'

import type {
  BettingWindow,
  EconomySettings,
  HealthLevel,
  InfluencePosition,
  Place,
  TodayResponse,
} from '@lunch/contracts'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
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
  participantId?: string
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
  participantId = '',
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
  const [archivedPlaces, setArchivedPlaces] = useState<Place[]>([])
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [archivedError, setArchivedError] = useState('')
  const [selectedArchivedId, setSelectedArchivedId] = useState('')
  const [searchAttempt, setSearchAttempt] = useState(0)
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
  useEffect(() => {
    void searchAttempt
    if (!newPlaceName.trim() || !identityReady || !participantId) {
      setArchivedLoading(false)
      setArchivedPlaces([])
      setArchivedError('')
      return
    }
    const controller = new AbortController()
    let current = true
    setArchivedLoading(true)
    setArchivedError('')
    const timer = globalThis.setTimeout(() => {
      void fetch('/api/v1/places/archived', {
        headers: { 'X-Participant-Id': participantId },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Could not search removed places.')
          return (await response.json()) as { places: Place[] }
        })
        .then(({ places }) => {
          if (current) setArchivedPlaces(places)
        })
        .catch((error: unknown) => {
          if (current)
            setArchivedError(
              error instanceof Error
                ? error.message
                : 'Could not search removed places.',
            )
        })
        .finally(() => {
          if (current) setArchivedLoading(false)
        })
    }, 180)
    return () => {
      globalThis.clearTimeout(timer)
      current = false
      controller.abort()
    }
  }, [newPlaceName, searchAttempt, identityReady, participantId])
  const matchingArchivedPlaces = archivedPlaces.filter((place) =>
    place.name
      .toLocaleLowerCase()
      .includes(newPlaceName.trim().toLocaleLowerCase()),
  )
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
      setSelectedArchivedId('')
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
        <label htmlFor="place-name">Add or restore a lunch place</label>
        <div className="inline-form">
          <input
            id="place-name"
            name="place"
            placeholder={`Add a lunch place · ${economy.addPlaceCost} tokens`}
            maxLength={100}
            required
            value={newPlaceName}
            onChange={(event) => {
              setNewPlaceName(event.target.value)
              setSelectedArchivedId('')
            }}
            disabled={!identityReady || busy || Boolean(pausedMessage)}
          />
          <button
            type="submit"
            className="button button-light"
            disabled={!identityReady || busy || Boolean(pausedMessage)}
          >
            {selectedArchivedId ? 'Restore place' : 'Add place'}
          </button>
          <HealthSelect
            label="New spot health level"
            value={newPlaceHealth}
            onChange={setNewPlaceHealth}
            disabled={!identityReady || busy || Boolean(pausedMessage)}
          />
        </div>
        {newPlaceName.trim() && (
          <div className="archived-place-search" aria-live="polite">
            <p className="muted">
              Search removed places to restore their saved record.
            </p>
            {archivedLoading && <p role="status">Searching removed places…</p>}
            {archivedError && (
              <p role="status">
                {archivedError}{' '}
                <button
                  type="button"
                  className="ledger-toggle"
                  onClick={() => setSearchAttempt((attempt) => attempt + 1)}
                >
                  Retry search
                </button>
              </p>
            )}
            {!archivedLoading &&
              !archivedError &&
              matchingArchivedPlaces.length > 0 && (
                <ul aria-label="Removed places matching your search">
                  {matchingArchivedPlaces.map((place) => (
                    <li key={place.id}>
                      <button
                        type="button"
                        disabled={
                          !identityReady || busy || Boolean(pausedMessage)
                        }
                        aria-pressed={selectedArchivedId === place.id}
                        onClick={() => {
                          setNewPlaceName(place.name)
                          setNewPlaceHealth(place.healthLevel)
                          setSelectedArchivedId(place.id)
                        }}
                      >
                        Restore {place.name} · {economy.addPlaceCost} tokens
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            {!archivedLoading &&
              !archivedError &&
              matchingArchivedPlaces.length === 0 && (
                <p className="muted">
                  No removed places match. You can add this as a new place.
                </p>
              )}
          </div>
        )}
      </form>
    </div>
  )
}
