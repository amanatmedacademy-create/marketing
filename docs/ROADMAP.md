# Delivery roadmap

## Phase 1 — Platform safety and CRM core

- Authentication and tenant resolution.
- RLS and permissions.
- Team and membership management.
- Contacts, companies, deals, pipelines, activities, stage history.
- Audit log and shared API error format.

## Phase 2 — Daily operations

- Tasks and notifications.
- Dashboard based on validated metrics.
- Integration credential model and health checks.
- Event outbox, queue, retries, and scheduler.

## Phase 3 — Communications and acquisition

- WhatsApp Cloud API.
- Instagram messaging and comments.
- Email provider integrations.
- Advertising account synchronization.
- Project management.

## Phase 4 — Analytics and finance

- Stable event taxonomy and attribution.
- Spend, CPL, CAC, ROAS, ROMI.
- Accounts, cash flow, AR/AP, reserves, payment calendar.
- Files and meetings.

## Phase 5 — Intelligence

- Permission-aware global search.
- AI recommendations and confirmed actions.
- Gamification after KPI definitions are stable.

Each phase is delivered through small module-specific pull requests. Cross-module rewrites are rejected unless they change shared contracts intentionally.
