# CRM Kanban Platform Runtime

This repository acts as the CRM product runtime and the Marketing host shell for `crm.kanban`.

## Control boundary

- IMDS Platform owns pricing, entitlement, installation, lifecycle and authorization decisions.
- This product owns CRM companies, workspaces, pipelines, stages, deals and UI delivery.
- Central organization IDs and product company IDs are distinct. Provisioning stores the explicit mapping.

## Internal service API

Protected by `CRM_PLATFORM_TOKEN`:

```text
POST /internal/platform/modules/provision
POST /internal/platform/modules/repair
POST /internal/platform/modules/upgrade
POST /internal/platform/modules/suspend
POST /internal/platform/modules/resume
POST /internal/platform/modules/uninstall
GET  /internal/platform/modules/health?installationId=<uuid>
```

The provision operation is idempotent and ensures:

1. one CRM workspace;
2. one default pipeline;
3. five default stages;
4. active owner membership;
5. local installation projection;
6. product health result.

Re-delivery with the same idempotency key does not create duplicate pipelines or stages.

## Marketing Product Shell

`ProductShellRuntime` reads `/api/platform/bootstrap`. Central active installations are merged with local core entitlements.

For `crm.kanban`, the shell:

- adds a dynamic sidebar launcher;
- registers `/crm/kanban` in browser history;
- renders the existing `KanbanBoard` inside the Marketing shell;
- removes the route when bootstrap no longer exposes the installation.

## API authorization

CRM routes are guarded by central Platform authorization:

| CRM route | Permission |
|---|---|
| `GET /api/pipelines` | `crm.pipelines.read` |
| `GET /api/deals` | `crm.deals.read` |
| `POST /api/deals` | `crm.deals.create` |
| `PATCH /api/deals/:id` | `crm.deals.update` |
| `PATCH /api/deals/:id/move` | `crm.deals.move` |

A suspended installation returns `403 MODULE_SUSPENDED`. A read-only installation returns `409 MODULE_READ_ONLY`.

## Required Worker secrets

```text
SUPABASE_SERVICE_ROLE_KEY
CRM_PLATFORM_TOKEN
PLATFORM_API_URL
PLATFORM_SERVICE_TOKEN
```

`PLATFORM_SERVICE_TOKEN` must be a server-side credential accepted by Platform API. It must never be exposed to the browser.

## Database migrations

```text
supabase/migrations/20260802_create_crm_kanban_platform_runtime.sql
supabase/migrations/20260802_link_platform_tenants.sql
```

Apply both migrations before deploying the Worker.
