;(function initializeTheme() {
  let theme
  try {
    theme = localStorage.getItem('lunch-roller.theme')
  } catch {}
  document.documentElement.dataset.theme =
    theme === 'light' || theme === 'dark'
      ? theme
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
})()
