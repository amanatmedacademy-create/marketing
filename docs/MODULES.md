# Module contracts

| Module | Must provide | Not considered complete without |
|---|---|---|
| Authentication | Login, refresh, logout, memberships, sessions | JWT verification, revoked sessions, audit, rate limits |
| Team | Invitations, roles, departments, status | Permission editor, ownership transfer, deactivation workflow |
| CRM | Contacts, companies, deals, pipelines, activities | Deduplication, stage history, lost reasons, custom fields |
| Tasks | CRUD, assignees, deadlines, links to entities | Reminders, recurrence, comments, attachments, overdue rules |
| Projects | Multiple projects, boards, tasks, budgets | Permissions, dependencies, progress, files, activity history |
| Inbox | WhatsApp, Instagram, email, telephony | Webhooks, realtime, assignment, SLA, media, delivery states |
| Ads | Accounts, campaigns, spend, forms, audiences | OAuth, sync cursors, currency/timezone normalization, retries |
| Analytics | Funnel, attribution, revenue, cost metrics | Stable stage types, event dates, first/last touch, cohorts |
| Finance | Accounts, transactions, transfers, AR/AP | Reconciliation, approvals, payment calendar, closing periods |
| Files | Upload, versions, access, links | Antivirus, quotas, retention, audit, signed URLs |
| Meetings | Calendar and video meeting lifecycle | Permissions, reminders, results, CRM links, timezone handling |
| Integrations | Credentials, status, logs, reconnect | Health checks, scoped secrets, webhook status, error recovery |
| Automation | Triggers and actions | Idempotency, queues, retries, versioning, execution log |
| AI | Search and recommendations | Permission-aware retrieval, confirmations, action audit |
| Gamification | Goals, points, achievements | Transparent rules, anti-gaming controls, recalculation history |

A frontend page alone is not a module. Static values and disabled controls are not implementation.
