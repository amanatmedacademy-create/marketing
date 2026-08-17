# IMDS Account, Organization, Clinic & Subscription Architecture

Status: implementation baseline
Scope: IMDS Marketing / shared IMDS platform contracts

## 1. Goal

Build a stable SaaS foundation in which one person has one IMDS Account, may belong to multiple organizations/clinics, can switch tenant context safely, and can use products according to role, subscription, entitlements and usage limits.

The foundation must support IMDS Marketing today and IMDS Dashboard / Contracts / future IMDS products later without duplicating accounts, billing or tenant rules.

## 2. Domain hierarchy

```text
IMDS Account
  ├─ Platform role: user | super_admin
  ├─ Security identities / sessions
  ├─ Preferences
  └─ Memberships
       └─ Organization
            ├─ Subscription / products / billing
            ├─ Organization roles and invitations
            └─ Clinics (tenants)
                 ├─ Branches (optional future layer)
                 ├─ Clinic memberships / effective access
                 ├─ CRM / Marketing / Tasks / Analytics
                 └─ Integrations / channels
```

### 2.1 IMDS Account

One global human identity. A user must not receive a new account for every clinic.

Primary data:
- auth user id
- email
- phone
- display name
- avatar
- email verification
- platform role
- locale
- timezone
- preferred/default clinic
- active/revoked sessions

### 2.2 Platform role

`super_admin` is a platform role, not a clinic role.

Rules:
- `super_admin` can inspect and enter any active clinic tenant through an explicitly selected tenant context.
- It must never rely on a fake membership row to gain global access.
- Ordinary users must always pass membership checks.
- Tenant roles must never grant platform-wide access.

### 2.3 Organization

Commercial/customer account, e.g. `Amanat Medical Group`.

Owns:
- billing relationship
- product subscriptions
- legal/billing data
- clinic collection
- organization invitations
- organization-level limits
- organization-level audit stream

### 2.4 Clinic / tenant

Existing `crm_companies` remains the canonical runtime tenant for Marketing compatibility.

A clinic owns tenant-scoped operational data such as CRM, integrations, advertising connections, tasks, telephony, WhatsApp and analytics.

Migration rule: do not rename or destructively replace `crm_companies`. Add `organization_id`, backfill existing clinics one-to-one into organizations, then allow future organizations to own multiple clinics.

### 2.5 Branch

Optional future child of Clinic. Do not make current tenant isolation depend on it. It can later represent physical locations inside one legal/operational clinic.

### 2.6 Membership

A membership links an IMDS user to a clinic/organization and carries role/status.

Tenant role vocabulary:
- owner
- administrator
- manager
- marketer
- operator
- analyst
- viewer

Owner is distinct from administrator.

Owner-only actions:
- ownership transfer
- archive/delete clinic
- billing/legal settings
- destructive access administration

Administrator may manage normal clinic configuration and users, but cannot implicitly become Owner.

## 3. Tenant isolation invariants

1. Every tenant-scoped API request must resolve one clinic id.
2. Ordinary users may resolve only clinics with an active membership.
3. `super_admin` may resolve any active clinic but only after explicit tenant selection.
4. A client-supplied clinic id is never trusted without server verification.
5. Switching clinics changes the tenant context only; it does not change account identity.
6. Current full-page reload after tenant switch is acceptable until all product stores are proven tenant-reactive.
7. Integration credentials, CRM records, analytics, tasks and communications remain clinic-scoped.

## 4. Clinic switcher UX

Replace the native disabled `<select>` with an always-clickable custom menu.

Header:

```text
[Search] [Clinic: Amanat Clinic ▼] [Theme] [Notifications] [Profile ▼]
```

Menu requirements:
- current clinic with check mark
- search/filter when more than 5 clinics
- clinic name
- role
- subscription/plan badge when available
- membership/status badge when relevant
- action: `+ Добавить клинику`
- action: `+ Присоединиться по коду`
- action: `Настройки текущей клиники`

If only one clinic exists, the menu still opens and explains that no other clinics are available.

For `super_admin`, show all active clinics, mark them as platform access, and support search.

## 5. Clinic creation / join flows

### 5.1 Create clinic

Authenticated flow:
1. Check account status.
2. Check plan entitlement `limits.clinics` or applicable add-on.
3. Create clinic tenant.
4. Attach it to an organization.
5. Create owner membership for the creator.
6. Provision product trial/entitlements according to platform policy.
7. Emit platform event.
8. Audit the action.
9. Return new tenant and make it selectable.

If the clinic limit is reached, return a structured limit response and UI should offer upgrade/add-on instead of a generic error.

### 5.2 Join clinic

Authenticated user may join through an invitation or organization code without creating a second auth account.

Resulting membership may be `invited` / `pending_approval` until approved.

## 6. Account workspace

Personal account must not contain organization administration.

Personal sections:

### Profile
- avatar
- full name
- phone
- email
- email verification state
- job title for active clinic
- current clinic

### My clinics
- all memberships
- current clinic
- role/status per clinic
- switch clinic
- create clinic
- join by code
- optional default clinic

### Security
- authentication methods
- change password
- forgot/reset password flow
- active sessions
- revoke one session
- log out other sessions
- log out all sessions
- later: MFA/2FA

Security copy must reflect the real auth method. Do not state that IMDS does not support passwords when password auth is enabled.

### Preferences
- theme
- display currency
- locale
- timezone
- notification preferences

### My access
- effective permissions for current clinic
- human-readable module labels
- source of permission (role / position / override)
- administrator/owner should display `Полный доступ` when appropriate

## 7. Organization settings

Move admin functions out of personal account.

Sections:
- Organization / clinic details
- Clinics
- Users
- Invitations
- Positions
- Roles
- Access matrix
- Integrations health
- Audit log
- Subscription & billing
- Legal details

## 8. Subscription architecture

Billing is owned by IMDS Platform / Control Plane. IMDS Marketing consumes entitlements and does not embed provider-specific billing logic into feature code.

### 8.1 Plan catalog

Prices are configurable business data, not constants in authorization logic.

Initial commercial proposal:

| Plan | Target | Reference price |
|---|---|---:|
| Trial | Evaluation | 3 days |
| Start | Small clinic | 49,900 KZT / month / clinic |
| Pro | Main clinic plan | 99,900 KZT / month / clinic |
| Business | Networks | 249,900 KZT / month / organization |
| Enterprise | Large networks | Custom |

`Pro` should be visually recommended.

### 8.2 Entitlements

Feature code consumes keys, not plan names.

Examples:
- `marketing.crm`
- `marketing.tasks`
- `marketing.analytics`
- `marketing.meta-ads`
- `marketing.whatsapp-business`
- `marketing.call-center`
- `marketing.automation`
- `marketing.ai`

Limits:
- `limits.clinics`
- `limits.users`
- `limits.waba_numbers`
- `limits.telephony_numbers`
- `limits.ai_requests`
- `limits.storage_gb`

### 8.3 Add-ons

Use `Plan + Add-ons`, not dozens of plans.

Possible add-ons:
- extra clinic
- extra user pack
- extra WABA channel
- extra telephony channel
- AI request pack
- storage pack
- premium support
- custom integration

### 8.4 Subscription states

Canonical state machine:

```text
trial -> active
trial -> expired
active -> past_due -> grace_period -> active
active -> cancelled -> expired
past_due/grace_period -> suspended
suspended -> active
```

Supported states:
- trial
- active
- past_due
- grace_period
- suspended
- cancelled
- expired

### 8.5 Access mode

Do not immediately erase access after payment failure.

Recommended modes:
- trial / active: full entitlements
- past_due: full access + warnings for short recovery window
- grace_period: configurable limited/full access + persistent billing warning
- expired / suspended: read-only operational data, block side effects
- cancelled before period end: active until `accessEndsAt`, then read-only

Server must enforce side-effect blocking, not only UI.

## 9. Usage metering

Billing/entitlement center should expose current usage:

```text
Clinics              2 / 3
Users                14 / 20
WABA channels         3 / 5
Telephony channels    4 / 5
AI requests        3520 / 5000
Storage             28 / 50 GB
```

Warn at thresholds such as 80%, 95%, 100%.

## 10. Notifications

Topbar notification center should support:
- trial ending
- payment failure
- grace period / suspension
- usage limit thresholds
- invitation / access request
- integration disconnected
- token expiry
- failed sync
- import complete
- platform maintenance/incident if appropriate

Notification records remain scoped to user + organization/clinic context.

## 11. Audit

Audit critical mutations:
- clinic creation/archive/restore
- ownership transfer
- user invited/removed/blocked
- role/access changes
- subscription changes
- integration connect/disconnect
- credential/channel changes without exposing secrets
- destructive CRM/admin actions

Every audit record should include actor, tenant/organization, action, entity, timestamp and safe metadata.

## 12. Integration connections

Long-term target is a generic multi-connection model:

```text
integration_connection
  id
  company_id
  provider
  external_account_id / channel_id
  display_name
  status
  credentials_ref
  metadata
  created_at
```

WABA already needs multiple phone channels per tenant. Other providers should migrate incrementally to the same concept instead of assuming one provider = one connection.

## 13. Multi-clinic dashboard

Business/Enterprise may use `All clinics` aggregate scope for read-only analytics.

Do not silently reuse a fake tenant id for this. Aggregation must be an explicit organization-level analytics path that verifies user organization access and queries authorized clinic ids.

## 14. Onboarding

After new clinic creation show a setup checklist:
- clinic created
- invite staff
- connect WhatsApp
- connect telephony
- connect Meta Ads
- connect Google Ads
- connect MIS

Track progress but do not block normal usage unless an integration is actually required by a feature.

## 15. Archive / deletion policy

Prefer archive/soft delete for clinics and accounts.

Recommended clinic lifecycle:
- active
- archived
- pending_deletion
- deleted (after retention policy)

Never cascade-delete business data immediately from a normal UI action.

## 16. API target

### Account
- `GET /api/account`
- `PATCH /api/account/profile`
- `PATCH /api/account/preferences`
- `POST /api/account/password/change`
- `POST /api/account/password/forgot`
- `POST /api/account/password/reset`
- `GET /api/account/sessions`
- `DELETE /api/account/sessions/:id`
- `POST /api/account/sessions/revoke-others`
- `POST /api/account/sessions/revoke-all`

### Clinics
- `GET /api/clinics`
- `POST /api/clinics`
- `POST /api/clinics/join`
- `GET /api/clinics/:id`
- `PATCH /api/clinics/:id`
- `POST /api/clinics/:id/archive`
- `POST /api/clinics/:id/restore`
- `POST /api/clinics/:id/transfer-ownership`

Tenant switching continues to use verified `x-imds-company-id`; a dedicated switch endpoint may be added if server-stored defaults/preferences require it.

### Organization administration
- `GET /api/organization`
- `GET /api/organization/users`
- `POST /api/organization/invitations`
- `POST /api/organization/invitations/:id/resend`
- `POST /api/organization/invitations/:id/revoke`
- role/access endpoints reuse the existing access matrix where possible

### Billing consumer
- `GET /api/billing/summary`
- `GET /api/billing/plans`
- `GET /api/billing/usage`
- `GET /api/billing/invoices`
- write operations are delegated to Control Plane/provider adapters

## 17. Migration strategy

Phase 0 principles:
- additive schema only
- no destructive rename of `crm_companies`
- no duplicate account model
- backfill organization 1:1 for every existing clinic
- preserve current company IDs as tenant IDs
- introduce explicit organization relation
- keep existing `crm_company_members` while extending semantics

Later phases may normalize memberships and billing further only after migration coverage exists.

## 18. Rollout phases

### Phase 1 — Foundation / P0
- organization table + clinic link
- profile/preferences foundations
- super_admin global clinic resolution
- authenticated clinic create/join APIs
- custom clinic switcher
- regression tests for tenant isolation

### Phase 2 — Account workspace / P1
- new personal account UI
- phone/avatar/profile editing
- correct security information
- password change
- session management
- preferences
- correct My Access
- light/dark token migration

### Phase 3 — Organization settings / P1
- move users/matrix from personal account
- owner role and destructive-action boundaries
- invitations lifecycle
- clinic settings
- audit extensions

### Phase 4 — Subscription / P1-P2
- plan catalog in Control Plane
- entitlement limits
- billing summary UI
- usage meters
- past_due/grace/read-only enforcement
- upgrade/add-on CTA

### Phase 5 — Platform UX / P2
- notifications center
- onboarding checklist
- integration health center
- multi-clinic aggregate dashboard
- archive/restore UX

### Phase 6 — Enterprise / P3
- SSO/MFA
- centralized networks
- advanced billing contracts
- white-label / dedicated environments
- organization-wide API/webhooks

## 19. Acceptance and security tests

Required invariants:
1. User with one clinic can open the clinic menu.
2. User cannot switch into an unrelated clinic by modifying localStorage/header.
3. `super_admin` can explicitly enter any active clinic.
4. Creating a second clinic does not create a second auth account.
5. Creator becomes owner of the new clinic.
6. Join-by-code creates membership against the existing account.
7. Clinic limit returns a structured limit error.
8. Changing clinic never leaks previous clinic data.
9. Owner-only actions reject administrator/marketer/viewer.
10. Suspended/read-only subscription blocks server-side side effects.
11. Password/security UI reflects actual enabled providers.
12. Revoked session cannot authenticate.
13. Audit records never store access tokens/secrets/password hashes.
14. Existing CRM/integration routes continue to use existing company IDs.
15. Typecheck, production build and regression tests are mandatory before merge.

## 20. Master implementation prompt

Use this prompt for implementation agents working in this repository:

> Repository: `amanatmedacademy-create/marketing`.
>
> Implement the IMDS Account / Organization / Clinic / Subscription architecture described in `docs/IMDS_ACCOUNT_CLINIC_SUBSCRIPTION_ARCHITECTURE.md`.
>
> Work from a freshly fetched `main`. Never overwrite parallel changes. Use a dedicated `agent/...` branch. Keep schema changes additive and migration-safe. `crm_companies` remains the Marketing tenant compatibility table and existing company IDs must remain valid.
>
> Core identity rule: one person = one IMDS Account. Never create duplicate auth accounts when adding/joining clinics. `super_admin` is a platform role; `owner`/`administrator` are tenant roles. Ordinary users require active membership for tenant access. Super Admin may enter any active clinic only through explicit selected tenant context and server-side validation.
>
> First deliver P0: organization model/backfill, clinic create/join APIs, safe Super Admin clinic resolution, always-clickable custom Clinic Switcher, tenant-isolation regression tests. Then deliver Account Workspace, Organization Settings, subscription/usage UX and notifications in separate reviewable phases.
>
> Billing belongs to IMDS Platform/Control Plane. Marketing must consume entitlements and limits; do not scatter checks for plan names throughout feature code. Extend the existing `PlatformEntitlements` contract and current trial/billing state rather than introducing a second billing authority.
>
> Subscription states must support trial, active, past_due, grace_period, suspended, cancelled and expired. Expired/suspended customers should retain controlled read-only access according to policy; enforce side-effect blocking on the server, not only in UI.
>
> Refactor the current `UserWorkspaceModal`: personal account contains Profile, My Clinics, Security, Preferences and My Access. Move Users and Access Matrix to Organization Settings. Fix inaccurate Google-only/password copy. Add phone/avatar/profile editing, password change and active session management. Use shared IMDS design tokens for both light and dark themes.
>
> Do not weaken tenant isolation, authorization, encryption or type safety. Do not use `any`, `@ts-ignore`, disabled type checking or client-only security gates.
>
> Before merge run relevant regression tests, TypeScript typecheck and production build. Verify GitHub CI. Verify the deployed current `main` revision, accounting for parallel merges. Do not state completion until checks and deployment for the merged revision are confirmed.
