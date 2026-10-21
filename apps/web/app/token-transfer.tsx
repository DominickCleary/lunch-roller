'use client';

import { useEffect, useRef, useState } from 'react';
import type { Participant, TransferRequest } from '@lunch/contracts';

export function TokenTransfer({
  participantId,
  participants,
  balance,
  busy,
  onSend,
}: {
  participantId: string;
  participants: Participant[];
  balance: number;
  busy: boolean;
  onSend: (body: TransferRequest, message: string) => Promise<boolean>;
}) {
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('1');
  const [review, setReview] = useState<TransferRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  const submitting = useRef(false);
  const recipientField = useRef<HTMLSelectElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const wasReview = useRef(false);
  const recipients = participants.filter(
    (person) => person.active && person.id !== participantId,
  );
  const recipient = recipients.find(
    (person) => person.id === (review?.recipientId ?? recipientId),
  );
  const valid =
    recipient &&
    Number.isInteger(Number(amount)) &&
    Number(amount) > 0 &&
    Number(amount) <= Math.min(balance, 2147483647);
  useEffect(() => {
    if (review) confirmButton.current?.focus();
    else if (wasReview.current)
      recipientField.current?.focus({ preventScroll: true });
    wasReview.current = Boolean(review);
  }, [review, sent]);
  async function send() {
    if (!review || !recipient || submitting.current) return;
    submitting.current = true;
    setSending(true);
    try {
      const message = `Sent ${review.amount} token${review.amount === 1 ? '' : 's'} to ${recipient.name}.`;
      if (await onSend(review, message)) {
        setSent(message);
        setReview(null);
        setAmount('1');
        setRecipientId('');
      }
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  return (
    <details className="token-transfer">
      <summary>Send tokens</summary>
      {sent && (
        <p className="transfer-feedback" role="status" aria-live="polite">
          {sent}
        </p>
      )}
      {review ? (
        <div className="transfer-review" aria-live="polite">
          <p>
            Send <strong>{review.amount} tokens</strong> to{' '}
            <strong>{recipient?.name ?? 'this person'}</strong>?
          </p>
          <p>Your balance after sending: {balance - review.amount} tokens.</p>
          <div className="inline-form">
            <button
              ref={confirmButton}
              type="button"
              className="button button-primary"
              disabled={
                busy || sending || !recipient || balance < review.amount
              }
              onClick={() => void send()}
            >
              {sending ? 'Sending…' : 'Confirm transfer'}
            </button>
            <button
              type="button"
              disabled={busy || sending}
              onClick={() => setReview(null)}
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              setSent('');
              setReview({ recipientId, amount: Number(amount) });
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
            Tokens to send
            <input
              aria-label="Tokens to send"
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
          <p className="muted">
            Available: {balance} tokens. Tokens reserved for bets or boosts are
            already excluded.
          </p>
          <button className="button button-light" disabled={busy || !valid}>
            Review transfer
          </button>
          {!recipients.length && (
            <p>No other active people are available yet.</p>
          )}
        </form>
      )}
    </details>
  );
}
