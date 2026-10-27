'use client'

import type { Suggestion } from '@lunch/contracts'
import {
  suggestionListResponse,
  suggestion as suggestionSchema,
} from '@lunch/contracts'
import Link from 'next/link'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import './suggestions.css'

type ApiError = { error?: { message?: string } }

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError
    return body.error?.message || fallback
  } catch {
    return fallback
  }
}

function replaceSuggestion(
  suggestions: Suggestion[],
  updated: Suggestion,
): Suggestion[] {
  return suggestions.map((item) => (item.id === updated.id ? updated : item))
}

export default function SuggestionsPage() {
  const [participantId, setParticipantId] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')

  const loadSuggestions = useCallback(async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/v1/suggestions', {
        headers: id ? { 'X-Participant-Id': id } : undefined,
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Could not load suggestions.'),
        )
      }
      const result = suggestionListResponse.parse(await response.json())
      setSuggestions(result.suggestions)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load suggestions.',
      )
      setSuggestions(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = window.localStorage.getItem('lunch-roller.participant-id') || ''
    const initialize = window.setTimeout(() => {
      setParticipantId(id)
      void loadSuggestions(id)
    }, 0)
    void fetch('/api/v1/admin/session', { cache: 'no-store' })
      .then((response) => setIsAdmin(response.status === 204))
      .catch(() => setIsAdmin(false))
    return () => window.clearTimeout(initialize)
  }, [loadSuggestions])

  async function createSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!participantId || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Participant-Id': participantId,
        },
        body: JSON.stringify({ title, description }),
      })
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Could not submit this request.'),
        )
      }
      const created = suggestionSchema.parse(await response.json())
      setSuggestions((current) =>
        [
          created,
          ...(current || []).filter((item) => item.id !== created.id),
        ].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        ),
      )
      setTitle('')
      setDescription('')
      setNotice('Your request has been added to the board.')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not submit this request.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function castVote(item: Suggestion, value: -1 | 1) {
    if (!participantId || busyId || item.yourVote !== null) return
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(
        `/api/v1/suggestions/${encodeURIComponent(item.id)}/vote`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Participant-Id': participantId,
          },
          body: JSON.stringify({ value }),
        },
      )
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Could not update your vote.'),
        )
      }
      const result = await response.json()
      const updated = suggestionSchema.parse(result.suggestion)
      setSuggestions((current) =>
        current ? replaceSuggestion(current, updated) : current,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update your vote.',
      )
    } finally {
      setBusyId('')
    }
  }

  async function setStatus(item: Suggestion, status: 'approved' | 'denied') {
    if (!isAdmin || busyId) return
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(
        `/api/v1/admin/suggestions/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Could not update this request.'),
        )
      }
      const result = await response.json()
      const updated = suggestionSchema.parse(result.suggestion)
      setSuggestions((current) =>
        current ? replaceSuggestion(current, updated) : current,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update this request.',
      )
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="suggestions-shell">
      <header className="topbar suggestions-topbar">
        <Link className="brand" href="/" aria-label="Gambling about lunch home">
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          <span className="brand-title">Gambling about lunch</span>
        </Link>
        <nav className="top-nav" aria-label="Primary navigation">
          <Link href="/">Wheel</Link>
          <Link href="/suggestions" aria-current="page">
            Suggestion board
          </Link>
        </nav>
      </header>
      <main className="suggestions-page">
        <header className="suggestions-intro">
          <div className="suggestions-eyebrow">Make lunch better together</div>
          <h1>Suggestion board</h1>
          <p>
            Share an idea for the team, then vote on requests you would like to
            see considered.
          </p>
        </header>

        <section
          className="suggestion-compose"
          aria-labelledby="suggestion-form-title"
        >
          <div className="suggestion-compose-heading">
            <span aria-hidden="true" className="suggestion-compose-mark">
              ✦
            </span>
            <div>
              <h2 id="suggestion-form-title">Add a request</h2>
              <p>Keep it clear so everyone can understand the idea.</p>
            </div>
          </div>
          {!participantId ? (
            <p className="suggestion-identity-note" role="status">
              Choose your name on the main page before creating or voting on
              requests.
            </p>
          ) : (
            <form className="suggestion-form" onSubmit={createSuggestion}>
              <label>
                Title
                <input
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  required
                  placeholder="A short name for your idea"
                />
                <span className="suggestion-field-hint">
                  Up to 120 characters
                </span>
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  required
                  rows={4}
                  placeholder="What would you like to change, and why?"
                />
                <span className="suggestion-field-hint">
                  Up to 2,000 characters
                </span>
              </label>
              <div className="suggestion-form-actions">
                <span>Requests are visible to the whole team.</span>
                <button
                  className="suggestion-submit"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? 'Adding request…' : 'Add to board'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section
          className="suggestion-list-section"
          aria-labelledby="suggestions-title"
        >
          <div className="suggestion-list-heading">
            <div>
              <div className="suggestions-eyebrow">The team’s ideas</div>
              <h2 id="suggestions-title">Requests</h2>
            </div>
            {suggestions && (
              <span className="suggestion-count">
                {suggestions.length}{' '}
                {suggestions.length === 1 ? 'request' : 'requests'}
              </span>
            )}
          </div>

          {error && (
            <div className="suggestion-error" role="alert">
              <span>{error}</span>
              {suggestions === null && (
                <button
                  type="button"
                  onClick={() => void loadSuggestions(participantId)}
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {notice && (
            <p className="suggestion-notice" role="status">
              {notice}
            </p>
          )}
          {loading && (
            <p className="suggestion-state" role="status" aria-live="polite">
              Loading requests…
            </p>
          )}
          {!loading && suggestions?.length === 0 && (
            <div className="suggestion-empty" role="status">
              <span aria-hidden="true">☼</span>
              <h3>No requests yet</h3>
              <p>Start the conversation by sharing the first idea.</p>
            </div>
          )}
          {!loading && suggestions && suggestions.length > 0 && (
            <div className="suggestion-list">
              {suggestions.map((item) => (
                <article className="suggestion-card" key={item.id}>
                  <fieldset
                    className="suggestion-votes"
                    aria-label="Request votes"
                  >
                    <button
                      className={`suggestion-vote-button ${item.yourVote === 1 ? 'is-selected' : ''}`}
                      type="button"
                      aria-label={`Upvote ${item.title}; ${item.upvotes} upvotes`}
                      aria-pressed={item.yourVote === 1}
                      disabled={
                        !participantId ||
                        busyId === item.id ||
                        item.yourVote !== null
                      }
                      onClick={() => void castVote(item, 1)}
                    >
                      <span aria-hidden="true">▲</span>
                    </button>
                    <strong aria-live="polite">
                      {item.upvotes - item.downvotes}
                    </strong>
                    <button
                      className={`suggestion-vote-button ${item.yourVote === -1 ? 'is-selected' : ''}`}
                      type="button"
                      aria-label={`Downvote ${item.title}; ${item.downvotes} downvotes`}
                      aria-pressed={item.yourVote === -1}
                      disabled={
                        !participantId ||
                        busyId === item.id ||
                        item.yourVote !== null
                      }
                      onClick={() => void castVote(item, -1)}
                    >
                      <span aria-hidden="true">▼</span>
                    </button>
                  </fieldset>
                  <div className="suggestion-card-content">
                    <div className="suggestion-card-topline">
                      <span
                        className={`suggestion-status status-${item.status}`}
                      >
                        {item.status === 'open'
                          ? 'Under consideration'
                          : item.status === 'approved'
                            ? 'Approved'
                            : 'Denied'}
                      </span>
                      <time dateTime={item.createdAt}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: 'medium',
                        }).format(new Date(item.createdAt))}
                      </time>
                    </div>
                    <h3>{item.title}</h3>
                    <p className="suggestion-description">{item.description}</p>
                    <div className="suggestion-card-footer">
                      <span>Suggested by {item.authorName}</span>
                      {isAdmin && (
                        <fieldset
                          className="suggestion-admin-actions"
                          aria-label={`Admin actions for ${item.title}`}
                        >
                          <button
                            type="button"
                            className="suggestion-approve"
                            disabled={
                              busyId === item.id || item.status === 'approved'
                            }
                            onClick={() => void setStatus(item, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="suggestion-deny"
                            disabled={
                              busyId === item.id || item.status === 'denied'
                            }
                            onClick={() => void setStatus(item, 'denied')}
                          >
                            Deny
                          </button>
                        </fieldset>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
