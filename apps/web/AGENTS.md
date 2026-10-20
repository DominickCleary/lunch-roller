# Web lane

Own pages, components, browser behavior, API adapters, and web-specific tests only when assigned. Shared contracts and DB migrations require coordinator assignment.

- Use App Router and `/api/v1`. Validate inputs with `@lunch/contracts`; call shared DB/domain operations.
- Browser identity belongs in `localStorage` under `lunch-roller.participant-id`; treat it as untrusted. Admin sessions are separate HttpOnly cookies verified server-side.
- Keep service-only code and secrets out of client bundles. API errors must not expose connection strings or stack traces.
- The scaffold ships only a landing page and health route. Do not imply that login, spins, purchases, admin access, or push delivery already work.
- Before handoff: lint, typecheck, web build, and affected Playwright tests. Preserve keyboard access, status announcements, reduced-motion support, and small-screen layouts when adding interactions.
