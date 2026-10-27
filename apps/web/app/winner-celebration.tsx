'use client'

import { type CSSProperties, useEffect, useRef } from 'react'
import './winner-celebration.css'

const colours = ['#e7ce8c', '#a33832', '#d7d4c8', '#9c8049', '#737f86']

export function WinnerCelebration({
  winner,
  onClose,
}: {
  winner: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="winner-dialog"
      aria-labelledby="winner-heading"
      aria-describedby="winner-verdict"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="winner-confetti" aria-hidden="true">
        {Array.from({ length: 60 }, (_, index) => ({
          id: `confetti-${index}`,
          index,
        })).map(({ id, index }) => (
          <i
            key={id}
            style={
              {
                '--x': `${(index * 37) % 101}vw`,
                '--drift': `${((index * 19) % 41) - 20}vw`,
                '--delay': `${((index * 13) % 23) / 10}s`,
                '--duration': `${3 + ((index * 7) % 16) / 10}s`,
                '--turn': `${(index % 2 ? 1 : -1) * (360 + index * 17)}deg`,
                background: colours[index % colours.length],
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="winner-card">
        <span className="winner-spark" aria-hidden="true">
          <svg
            aria-hidden="true"
            width="44"
            height="44"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="24" cy="24" r="17" />
            <circle cx="24" cy="24" r="5" />
            <path d="M24 2v17m0 10v17M2 24h17m10 0h17M8 8l12 12m8 8 12 12M8 40l12-12m8-8L40 8" />
          </svg>
        </span>
        <p className="winner-eyebrow">The lunch decree</p>
        <h2 id="winner-heading">The Wheel has spoken</h2>
        <p id="winner-verdict" className="winner-verdict">
          <strong>{winner}</strong> <span>has been chosen.</span>
        </p>
        <button type="button" className="button button-dark" onClick={onClose}>
          Praise the Wheel
        </button>
      </div>
    </dialog>
  )
}
