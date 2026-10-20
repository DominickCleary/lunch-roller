# Domain lane

Pure TypeScript only: no database, environment, HTTP, clock, or random source access. Inject uniform random samples and explicit time inputs when needed. Export behavior through `src/index.ts`.

Preserve log-space weights, exact configured prices, and permanent winner decay. Tests should verify observable rules and numerical boundaries, not mirror the implementation. Run `pnpm test` and domain type checking. Coordinate changes affecting consumers or contracts.
