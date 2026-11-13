'use client'

import type { Participant, TransferRequest } from '@lunch/contracts'
import { useEffect, useRef, useState } from 'react'
import { ConfirmationDialog } from './confirmation-dialog'

export function TokenTransfer({
  participantId,
  participants,
  balance,
  busy,
  onSend,
}: {
  participantId: string
  participants: Participant[]
  balance: number
  busy: boolean
  onSend: (body: TransferRequest, message: string) => Promise<boolean>
}) {
  const [recipientId, setRecipientId] = useState('')
  const [amount, setAmount] = useState('1')
  const [review, setReview] = useState<TransferRequest | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [sendError, setSendError] = useState('')
  const submitting = useRef(false)
  const recipientField = useRef<HTMLSelectElement | null>(null)
  const wasReview = useRef(false)
  const recipients = participants.filter(
    (person) => person.active && person.id !== participantId,
  )
  const recipient = recipients.find(
    (person) => person.id === (review?.recipientId ?? recipientId),
  )
  const valid =
    recipient &&
    Number.isInteger(Number(amount)) &&
    Number(amount) > 0 &&
    Number(amount) <= Math.min(balance, 2147483647)
  useEffect(() => {
    if (!review && wasReview.current)
      recipientField.current?.focus({ preventScroll: true })
    wasReview.current = Boolean(review)
  }, [review])
  async function send() {
    if (!review || !recipient || submitting.current) return
    submitting.current = true
    setSending(true)
    setSendError('')
    try {
      const message = `Traded ${review.amount} token${review.amount === 1 ? '' : 's'} to ${recipient.name}.`
      if (await onSend(review, message)) {
        setSent(message)
        setReview(null)
        setAmount('1')
        setRecipientId('')
      } else {
        setSendError('The trade could not be confirmed. Please try again.')
      }
    } finally {
      submitting.current = false
      setSending(false)
    }
  }
  return (
    <details className="token-transfer">
      <summary>Trade tokens</summary>
      {sent && (
        <p className="transfer-feedback" role="status" aria-live="polite">
          {sent}
        </p>
      )}
      {review ? (
        <ConfirmationDialog
          labelledBy="trade-heading"
          describedBy="trade-summary trade-balance"
          onDismiss={() => {
            if (!busy && !sending) setReview(null)
          }}
        >
          <h2 id="trade-heading">Confirm trade</h2>
          <p id="trade-summary">
            Trade <strong>{review.amount} tokens</strong> to{' '}
            <strong>{recipient?.name ?? 'this person'}</strong>?
          </p>
          <p id="trade-balance">
            Your balance after the trade: {balance - review.amount} tokens.
          </p>
          {sendError && (
            <p className="setup-error" role="alert">
              {sendError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button button-light"
              type="button"
              disabled={busy || sending}
              onClick={() => setReview(null)}
            >
              Edit trade
            </button>
            <button
              type="button"
              className="button button-yellow"
              disabled={
                busy || sending || !recipient || balance < review.amount
              }
              onClick={() => void send()}
            >
              {sending ? 'Trading…' : 'Confirm trade'}
            </button>
          </div>
          <p className="trade-final-note">Trades are immediate and final.</p>
        </ConfirmationDialog>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) {
              setSent('')
              setSendError('')
              setReview({ recipientId, amount: Number(amount) })
            }
          }}
        >
          <label>
            Recipient
            <select
              ref={recipientField}
              aria-label="Recipient"
              value={recipientId}
              required
              disabled={busy || !recipients.length}
              onChange={(event) => setRecipientId(event.target.value)}
            >
              <option value="">Choose a person</option>
              {recipients.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tokens to trade
            <input
              aria-label="Tokens to trade"
              aria-describedby="transfer-availability"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={1}
              max={Math.min(balance, 2147483647)}
              step={1}
              required
              value={amount}
              disabled={busy}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <p className="muted" id="transfer-availability">
            {balance > 0
              ? `Available: ${balance} tokens. You can trade up to ${Math.min(balance, 2147483647)}; tokens reserved for bets or boosts are already excluded.`
              : 'No tokens are available to trade right now. Release an open bet or pending boost to make tokens available.'}
          </p>
          <button
            type="submit"
            className="button button-light"
            disabled={busy || !valid}
          >
            Review trade
          </button>
          {!recipients.length && (
            <p>No other active people are available yet.</p>
          )}
        </form>
      )}
    </details>
  )
}
