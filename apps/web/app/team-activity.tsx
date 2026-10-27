'use client'

import type { Participant, WalletResponse } from '@lunch/contracts'
import { walletResponse } from '@lunch/contracts'
import { useEffect, useState } from 'react'
import {
  combineInfluenceEntries,
  TokenEntryDescription,
  WalletBets,
} from './token-history'

type Result = {
  participantId: string
  wallet?: WalletResponse
  error?: string
}
export function TeamActivity({
  participants,
  currentParticipantId,
  timezone,
}: {
  participants: Participant[]
  currentParticipantId: string
  timezone: string
}) {
  const [open, setOpen] = useState(false)
  const [viewedId, setViewedId] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [retry, setRetry] = useState(0)
  const people = participants.filter(
    (person) => person.active && person.id !== currentParticipantId,
  )
  const viewed = people.find((person) => person.id === viewedId)
  const targetId = viewed?.id

  useEffect(() => {
    if (!open || !targetId) return
    const participantId = targetId
    const controller = new AbortController()
    let latestRequest = 0
    async function refresh() {
      const requestId = ++latestRequest
      try {
        const response = await fetch('/api/v1/wallet', {
          headers: { 'X-Participant-Id': participantId },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok)
          throw new Error(
            [403, 404].includes(response.status)
              ? 'This person is no longer available. Choose another name.'
              : 'Could not load token activity. Please retry.',
          )
        const wallet = walletResponse.parse(await response.json())
        if (!controller.signal.aborted && requestId === latestRequest)
          setResult({ participantId: participantId, wallet })
      } catch (error) {
        if (!controller.signal.aborted && requestId === latestRequest)
          setResult({
            participantId: participantId,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load token activity.',
          })
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [open, retry, targetId])

  const current = result?.participantId === targetId ? result : null
  const wallet = current?.wallet
  return (
    <details
      className="team-activity"
      onToggle={(event) => {
        const expanded = event.currentTarget.open
        if (expanded) setResult(null)
        setOpen(expanded)
      }}
    >
      <summary>Team token activity</summary>
      {open && (
        <div className="team-activity-content">
          <p className="muted">
            View another person’s balance and token history.
          </p>
          {people.length ? (
            <>
              <label htmlFor="activity-person">View activity for</label>
              <select
                id="activity-person"
                value={targetId ?? ''}
                onChange={(event) => {
                  setViewedId(event.target.value)
                  setResult(null)
                  setShowAll(false)
                }}
              >
                <option value="">Choose a person</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              {viewed && (
                <section
                  className="team-wallet"
                  aria-label={`${viewed.name}'s token activity`}
                  aria-busy={!current}
                >
                  <h3>{viewed.name}</h3>
                  {!current ? (
                    <p role="status">Loading token activity…</p>
                  ) : current.error ? (
                    <div>
                      <p role="alert">{current.error}</p>
                      <button
                        type="button"
                        className="button button-light"
                        onClick={() => {
                          setResult(null)
                          setRetry((value) => value + 1)
                        }}
                      >
                        Retry activity
                      </button>
                    </div>
                  ) : (
                    wallet && (
                      <>
                        <p className="team-balance">
                          <strong>{wallet.balance}</strong> tokens
                        </p>
                        {wallet.ledger.length ? (
                          <>
                            <div id="team-token-ledger">
                              {combineInfluenceEntries(wallet.ledger)
                                .slice(0, showAll ? undefined : 5)
                                .map((entry) => (
                                  <div
                                    className="team-activity-entry"
                                    key={entry.id}
                                  >
                                    <div>
                                      <TokenEntryDescription entry={entry} />
                                      <time dateTime={entry.createdAt}>
                                        {new Intl.DateTimeFormat('en-GB', {
                                          dateStyle: 'medium',
                                          timeStyle: 'short',
                                          timeZone: timezone,
                                        }).format(new Date(entry.createdAt))}
                                      </time>
                                    </div>
                                    <strong
                                      className={
                                        entry.delta > 0
                                          ? 'positive'
                                          : 'negative'
                                      }
                                    >
                                      {entry.delta > 0 ? '+' : ''}
                                      {entry.delta} tokens
                                    </strong>
                                  </div>
                                ))}
                            </div>
                            {combineInfluenceEntries(wallet.ledger).length >
                              5 && (
                              <button
                                type="button"
                                className="ledger-toggle"
                                aria-expanded={showAll}
                                aria-controls="team-token-ledger"
                                onClick={() => setShowAll((value) => !value)}
                              >
                                {showAll
                                  ? 'Show recent activity'
                                  : 'Show all activity'}
                              </button>
                            )}
                          </>
                        ) : (
                          <p className="empty-note">No token activity yet.</p>
                        )}
                        <WalletBets bets={wallet.bets ?? []} />
                      </>
                    )
                  )}
                </section>
              )}
            </>
          ) : (
            <p className="empty-note">No other people on the roster yet.</p>
          )}
        </div>
      )}
    </details>
  )
}
