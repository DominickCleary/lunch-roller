'use client'

import { useSyncExternalStore } from 'react'

const storageKey = 'lunch-roller.theme'
const changeEvent = 'lunch-roller:theme-change'

function storedTheme() {
  try {
    const value = localStorage.getItem(storageKey)
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

function subscribe(onChange: () => void) {
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  const syncPreference = () => {
    document.documentElement.dataset.theme =
      storedTheme() ?? (system.matches ? 'dark' : 'light')
    onChange()
  }
  const syncStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) syncPreference()
  }
  window.addEventListener(changeEvent, onChange)
  window.addEventListener('storage', syncStorage)
  system.addEventListener('change', syncPreference)
  return () => {
    window.removeEventListener(changeEvent, onChange)
    window.removeEventListener('storage', syncStorage)
    system.removeEventListener('change', syncPreference)
  }
}

function snapshot() {
  return document.documentElement.dataset.theme ?? 'light'
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light')
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
      aria-pressed={dark}
      onClick={() => {
        const next = dark ? 'light' : 'dark'
        try {
          localStorage.setItem(storageKey, next)
        } catch {
          // Browsers that block storage can still change the theme for this visit.
        }
        document.documentElement.dataset.theme = next
        window.dispatchEvent(new Event(changeEvent))
      }}
    >
      <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
      <span>{dark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}
