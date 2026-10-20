# Task: Browser dark mode

- Owner / branch / worktree: coordinator implements in existing checkout; Luna verification agent is read-only and makes no concurrent edits.
- Goal/current behavior: site is light-only. Add a header toggle across setup/name/wheel, follow system by default, persist explicit preference and synchronize browser tabs. Initialize before paint to avoid a light flash.
- Owned files: apps/web/app/layout.tsx, theme-toggle.tsx, page.tsx header, globals.css, tests/e2e/theme.spec.ts, README and verification docs. Reviewer owns no files.
- Frozen interface: html data-theme light/dark; localStorage lunch-roller.theme contains light/dark only; absent/malformed uses prefers-color-scheme. Accessible button names Switch to dark/light mode, aria-pressed indicates dark. No auth/identity/settings/API changes.
- Exclusions: no dependencies, migrations, push/deploy, secret files or commits. Keep wheel segment probabilities, colours and animation unchanged.
- Acceptance/checks: readable dark forms/admin/dialog/pledge/grey disabled check-in, system fallback and dynamic preference, explicit choice persists reload and overrides system, cross-tab changes, blocked storage fallback, responsive header. Run required format/lint/types/unit/build and affected browser checks with disposable DB; visual desktop/mobile inspection.
- Migration/environment effects: none.

## Handoff

Coordinator reviews the diff, records check results and reports local changes. Reviewer reports concrete findings without editing.
