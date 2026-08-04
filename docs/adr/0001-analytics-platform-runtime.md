# ADR-0001: Replace the edge backend with NestJS, ClickHouse and Kubernetes

- Status: Accepted
- Date: 2026-08-04
- Scope: IMDS Marketing repository

## Context

The existing Cloudflare Worker and Supabase REST handlers are suitable for a compact CRM, but they are not sufficient for connector backfills, attribution re-sync, scheduled reporting, PDF generation, cross-client rollups and high-cardinality metric queries.

## Decision

1. `apps/api` becomes the primary backend and uses NestJS with Fastify.
2. PostgreSQL 16 stores tenant metadata and enforces `agency_id` row isolation.
3. ClickHouse stores normalized time-series facts in `analytics.metrics_daily`.
4. Redis and BullMQ run connector synchronization, report rendering and notification jobs.
5. Kubernetes is the production runtime for API and workers. PostgreSQL, ClickHouse, Redis and object storage should be managed services in production where available.
6. The existing `apps/worker` Cloudflare runtime is treated as legacy during migration. No new analytics capabilities are added there.
7. The React application migrates API calls from `/api/*` Worker handlers to the NestJS API behind a compatibility gateway.

## Consequences

- The platform gains independent scaling for API and background processing.
- Operational complexity increases and requires secrets management, migrations, observability and release automation.
- A staged data migration is mandatory; a one-step switch without dual-read validation risks tenant data loss.
- Supabase Auth can remain the identity provider. JWT verification moves into NestJS.

## Migration gates

1. Deploy PostgreSQL and ClickHouse schemas.
2. Backfill agencies/users/clients from current CRM tables.
3. Run dual-write for clients and integrations.
4. Compare counts and checksums.
5. Switch frontend reads to NestJS.
6. Freeze legacy Worker writes.
7. Remove Worker routes after the rollback window.
