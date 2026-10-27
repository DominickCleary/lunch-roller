'use client'
import { healthResponse } from '@lunch/contracts'
import { useEffect, useState } from 'react'

export function Readiness() {
  const [state, setState] = useState<'checking' | 'ready' | 'unavailable'>(
    'checking',
  )
  useEffect(() => {
    const controller = new AbortController()
    async function refresh() {
      try {
        const response = await fetch('/api/v1/health', {
          signal: controller.signal,
          cache: 'no-store',
        })
        const result = healthResponse.parse(await response.json())
        setState(
          response.ok && result.status === 'ok' ? 'ready' : 'unavailable',
        )
      } catch {
        if (!controller.signal.aborted) setState('unavailable')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 flex items-center gap-3 text-sm"
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${state === 'ready' ? 'bg-green-700' : state === 'checking' ? 'bg-amber-500' : 'bg-red-600'}`}
      />
      {state === 'ready'
        ? 'Web + database ready'
        : state === 'checking'
          ? 'Checking database…'
          : 'Database unavailable — run migrations and seed, then check the connection.'}
    </div>
  )
}
