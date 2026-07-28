# Tech stack

- Node.js 24 LTS runtime target; local Node 26 may run tooling but CI/container pins Node 24.
- TypeScript strict mode, pnpm workspaces.
- NestJS 11 with Fastify adapter for HTTP/webhooks.
- PostgreSQL 17; Drizzle ORM/migrations.
- Durable jobs/outbox in PostgreSQL initially; no Redis dependency until measured need.
- Vitest plus fast-check for unit/property tests; Testcontainers or GitHub Actions PostgreSQL for DB integration tests.
- OpenAPI and Zod/JSON Schema at provider boundaries.
- Docker/Compose artifacts are maintained even if Docker is unavailable on the current workstation.
- GitHub Actions provides lint, typecheck, tests, migration checks, secret scanning, dependency/SBOM/container scanning.