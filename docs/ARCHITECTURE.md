# Architecture

## Principles

1. Every business area is an isolated module with its own routes, services, repository layer, schemas, permissions, and tests.
2. Frontend navigation is URL-based. Refresh, browser history, and direct links must work.
3. Shared API contracts live in `packages/contracts`; frontend and backend must not duplicate payload types manually.
4. Tenant identity comes from the authenticated user. A global `DEFAULT_COMPANY_ID` is prohibited.
5. Service-role credentials are never used as a substitute for user authorization.
6. Integrations are asynchronous and idempotent. Webhooks require signature checks, deduplication, retries, and dead-letter handling.
7. UI must not display hard-coded business metrics or connection states as real data.

## Backend module shape

```text
modules/<module>/
  routes.ts
  schemas.ts
  service.ts
  repository.ts
  permissions.ts
  events.ts
  tests/
```

## Required platform layers

- Authentication and session verification.
- Tenant and membership resolution.
- Role-based and permission-based authorization.
- Audit log.
- Domain event outbox.
- Background job queue.
- Integration credential vault.
- Observability and structured errors.

## Data access rule

Every tenant-owned table must contain `company_id`, have indexes beginning with `company_id`, and enforce RLS policies. Backend checks supplement RLS; they do not replace it.
