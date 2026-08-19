# BELES Platform Integration Design

## Status

Approved direction from the architecture discussion on 2026-08-19. This document defines how `IMDS-tech/Beles` becomes the primary BELES Web App Shell without absorbing backend bounded contexts.

## Goal

Turn `IMDS-tech/Beles` into the primary BELES web application shell while preserving the existing UI and progressively moving platform concerns to shared contracts and product-specific runtime APIs.

## Architectural Decision

`Beles` remains a standalone frontend repository. It does not embed product repositories as git submodules and does not copy backend service code into the frontend.

The integration model is:

```text
Beles Web App Shell
  -> @imds/platform-sdk / shared contracts
  -> API Gateway
  -> Platform Core and product APIs
     -> CRM
     -> Marketing
     -> Schedule
     -> Omnichannel
     -> Analytics
     -> Finance
     -> other products
```

## Ownership Boundaries

### Beles owns

- application shell and global layout
- authentication and session UX
- organization selection
- branch selection
- product/module navigation
- entitlement-aware client UX
- route guards and app-level error states
- responsive web/tablet behavior
- localization surface
- shared shell-level loading and notification surfaces
- composition of product experiences

### Platform SDK owns

- shared platform context contracts
- authorization/session client primitives
- organization and branch context types
- entitlement and permission contract types
- common API/client helpers where appropriate

### API Gateway owns

- the browser-facing runtime boundary for product APIs
- routing to product services
- propagation and validation of platform context
- consistent cross-service request policy

### Product repositories own

- their backend domain logic
- product-specific authorization enforcement
- persistence and data integrity
- product APIs
- product-specific events/contracts

Examples:

- `crm`: customers, leads, sales, activities
- `marketing`: campaigns, journeys, growth operations
- `schedule`: calendars, appointments, resource scheduling
- `omnichannel`: messaging, WhatsApp, telephony channel orchestration
- `analytics`: reporting and analytics domain
- `Finance`: finance domain

## Existing Beles State

The current application is Vite + React and starts with `AuthGate` wrapping `MarketingPlatform`. The current frontend stores session information locally and adds organization and branch headers itself.

This existing behavior is preserved initially and migrated incrementally instead of being rewritten in one step.

## Migration Strategy

Use staged migration inside `IMDS-tech/Beles`.

### Phase 1: App Shell Foundation

Introduce a platform integration boundary around the current application without removing existing screens.

Create focused modules for:

- platform client
- session/auth adapter
- organization context
- branch context
- entitlements
- product registry
- API gateway client

Existing screens remain functional through adapters.

### Phase 2: Platform SDK Adoption

Replace duplicate frontend platform contracts with imports/adapters based on the shared `platform-sdk` repository.

No browser code may depend directly on backend repository internals.

### Phase 3: API Gateway Runtime Boundary

All new product data access from Beles goes through API Gateway endpoints.

Direct browser-to-database access is forbidden.
Direct browser-to-product-database access is forbidden.
Direct git-level coupling to product repositories is forbidden.

### Phase 4: CRM Vertical Slice

The first end-to-end product slice is:

```text
Login
  -> Organization
  -> Branch
  -> BELES App Shell
  -> CRM
  -> Customers
  -> Sales
  -> Activities
```

The CRM frontend experience may initially reuse existing Beles screens, but runtime data and authorization must come from the CRM product boundary through the gateway.

### Phase 5: Product-by-Product Migration

After CRM, migrate in this order unless operational priorities change:

1. Schedule
2. Omnichannel
3. Marketing
4. Analytics
5. Finance
6. remaining products

## Platform Context

The frontend context must represent at minimum:

- current user
- organization/tenant
- available organizations
- current branch
- available branches
- roles
- permissions
- product entitlements
- module entitlements
- access scopes

Client-side permission checks are UX only. Backend services remain authoritative and must fail closed when required context is missing or invalid.

## Organization and Branch Rules

- A user may belong to multiple organizations.
- An organization may contain multiple branches.
- A user can have access to one branch, several branches, or organization-wide scope.
- Product access may vary by organization and branch.
- Switching organization clears branch context.
- A selected branch must belong to the active organization and be permitted for the current user.

## Product Registry

Beles should use a product registry to drive navigation and module composition.

Each product registration should describe:

- product id
- label
- route prefix
- entitlement key
- navigation entries
- optional feature/module gates
- loading boundary
- unavailable/error behavior

The registry must not contain backend business logic.

## Runtime Data Flow

```text
Browser
  -> Beles App Shell
  -> platform client
  -> API Gateway
  -> product API
  -> product-owned persistence
```

The browser sends authenticated requests with active organization and branch context through the platform client. Gateway and product APIs validate the context. Product services remain the final authorization authority.

## Error Handling

Beles must provide deterministic shell-level states for:

- unauthenticated
- session expired
- organization required
- branch required
- forbidden
- product not entitled
- product temporarily unavailable
- gateway unavailable
- unexpected application error

Product-specific errors remain owned by product modules.

## WhatsApp Session Service

`services/whatsapp-session` inside Beles is considered transitional until audited.

If it contains backend/session runtime responsibilities, it must move to the Omnichannel or Integration boundary. Beles may keep only frontend adapters and UI for WhatsApp functionality.

## Repository Integration Rules

Allowed:

- published/private package dependency on shared SDK/contracts
- API integration through gateway
- generated contract clients derived from shared contracts

Not allowed:

- git submodules for product repositories inside Beles
- copying backend source into Beles
- direct imports from product repository source trees
- direct browser access to product databases

## Testing Strategy

### Unit tests

- organization selection behavior
- branch selection behavior
- context reset rules
- entitlement filtering
- product registry behavior
- API gateway client headers/context

### Integration tests

- authenticated app bootstrap
- organization switch
- branch switch
- forbidden product access
- CRM vertical slice routing and data loading

### Regression tests

Existing Beles screens must remain reachable during the staged migration unless explicitly replaced by a migrated product route.

## Rollout Constraints

- preserve existing user-visible functionality during the foundation phase
- do not perform a full frontend rewrite
- do not merge product backends into Beles
- do not weaken backend authorization
- migration must be reversible by PR/commit boundaries
- each product migration must be independently testable

## Initial Implementation Scope

The first implementation plan covers only the foundation and CRM connection:

1. add platform integration boundary in Beles
2. add gateway client abstraction
3. adapt current auth/session context behind the boundary
4. add organization and branch context adapters
5. add product registry
6. register CRM as the first product
7. connect CRM calls through API Gateway
8. add tests for context and routing behavior
9. keep legacy UI available during migration

Schedule, Omnichannel, Marketing, Analytics, Finance, and other products are explicitly out of scope for the first implementation plan except for registry placeholders where needed.

## Success Criteria

The first phase is complete when:

- Beles has an explicit App Shell/platform boundary
- platform context is consumed through one frontend abstraction
- new CRM traffic goes through API Gateway
- CRM is registered as a product module
- organization and branch selection are preserved
- backend authorization remains authoritative
- current legacy UI continues to function
- tests cover context propagation, fail-closed UI behavior, and CRM routing
