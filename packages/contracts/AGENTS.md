# Contract lane (coordinator owned)

Shared Zod schemas and inferred wire types only. No persistence, environment access, or framework imports. Both API and clients consume these exports.

Contract changes must update `docs/api.md`, tests, and affected consumers together. Freeze interfaces before parallel dependent tasks. `/api/v1/health` is the only implemented API in this scaffold; all other documented endpoints are planned.
