# IMDS Marketing Analytics Architecture

## Runtime topology

```mermaid
flowchart LR
  Web[React Web] --> Ingress[Kubernetes Ingress]
  Portal[White-label Portal] --> Ingress
  Ingress --> API[NestJS API]
  API --> PG[(PostgreSQL 16)]
  API --> CH[(ClickHouse)]
  API --> Redis[(Redis)]
  API --> S3[(S3 storage)]
  Redis --> Sync[Connector Sync Workers]
  Redis --> PDF[PDF Workers]
  Sync --> Providers[Ads / Analytics / SEO APIs]
  Sync --> CH
  PDF --> S3
```

## Core entity model

```mermaid
erDiagram
  AGENCIES ||--o{ USERS : has
  AGENCIES ||--o{ CLIENTS : owns
  CLIENTS ||--o{ CLIENT_USERS : grants
  USERS ||--o{ CLIENT_USERS : receives
  CLIENTS ||--o{ DATA_SOURCES : connects
  INTEGRATIONS ||--o{ DATA_SOURCES : implements
  DATA_SOURCES ||--o{ SYNC_JOBS : schedules
  CLIENTS ||--o{ DASHBOARDS : has
  CLIENTS ||--o{ REPORTS : has
  DASHBOARDS ||--o{ REPORT_SECTIONS : contains
  REPORTS ||--o{ REPORT_SECTIONS : contains
  REPORT_SECTIONS ||--o{ WIDGETS : contains
  CLIENTS ||--o{ VIEWS : defines
  CLIENTS ||--o{ CUSTOM_METRICS : defines
  CLIENTS ||--o{ KPIS : tracks
```

## Tenant isolation

- Every mutable business table contains `agency_id`.
- JWT authentication resolves an external auth subject.
- `x-agency-id` is accepted only after `analytics.is_agency_member` validates membership.
- Each transaction executes `set_config('app.agency_id', agencyId, true)` before queries.
- PostgreSQL RLS policies reject rows outside the active tenant.
- ClickHouse queries always bind `agency_id` as a typed parameter; raw string interpolation is prohibited.

## Data path

1. A data source creates a BullMQ synchronization job.
2. A connector fetches paginated provider data with provider-specific backoff.
3. Rows are normalized to canonical metrics.
4. Idempotent inserts use `ReplacingMergeTree(version)`.
5. API queries aggregate current and comparison periods from ClickHouse.
6. Redis caches widget results and invalidates keys after successful sync events.

## Repository migration

- `apps/web`: retained and migrated to the new API.
- `apps/api`: new primary backend.
- `apps/sync-worker`: connector ETL worker.
- `apps/worker`: legacy Cloudflare backend; removal after cutover.
- `infra/postgres`: metadata migrations.
- `infra/clickhouse`: fact schema and materialized views.
- `infra/k8s`: production manifests.
