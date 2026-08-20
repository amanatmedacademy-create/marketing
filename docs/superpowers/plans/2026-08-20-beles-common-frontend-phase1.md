# BELES Common Frontend Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move BELES onto the canonical IMDS frontend boundary without rewriting the current UI, using compatibility adapters for session/context and a manifest-driven product registry with CRM as the first registered product slice.

**Architecture:** Keep `AuthGate` and existing `MarketingPlatform` behavior operational, but introduce a focused `src/platform/` boundary that represents user, organization, branch, permissions, entitlements, products, and access scopes through one frontend abstraction. Because `@imds/platform-sdk` is currently a private unpublished workspace package, Phase 1 mirrors its public contract shape locally behind adapters so adoption can later be swapped to the published SDK without changing consumers. Navigation begins moving from hardcoded ownership to product registrations, starting with CRM.

**Tech Stack:** React 18, TypeScript 5.8, React Router 7, Node 22 test runner, existing BELES worker/API runtime.

**Spec:** `docs/superpowers/specs/2026-08-19-beles-platform-integration-design.md`

## Global Constraints

- Preserve existing user-visible BELES functionality; no frontend rewrite.
- Backend authorization remains authoritative and deny-by-default.
- Switching organization clears branch context.
- Selected branch must belong to the active organization and user access scope.
- No browser-to-database access.
- No product repository submodules or copied backend code.
- Existing `/api/*` flows remain compatible during Phase 1; new platform-facing code must use the new boundary.
- `@imds/platform-sdk` is not yet consumable as a registry package dependency; Phase 1 must not introduce a broken package install.
- CRM is the first product registration; Schedule, Omnichannel, Analytics, Finance remain legacy routes for now.

---

### Task 1: Add frontend platform contract boundary

**Files:**
- Create: `src/platform/types.ts`
- Create: `src/platform/context.ts`
- Test: `tests/platformFrontendBoundary.test.mjs`

**Interfaces:**
- Produces `PlatformFrontendContext`, `PlatformBranch`, `PlatformAccessScope`, `PlatformProductRegistration`, and `buildPlatformFrontendContext()`.

- [ ] **Step 1: Write failing contract tests**

Test that the new platform boundary exports organization, branch, product, and access-scope concepts, and that organization changes clear branch selection.

- [ ] **Step 2: Verify RED**

Run `node --test tests/platformFrontendBoundary.test.mjs`; expected failure because `src/platform/context.ts` does not exist.

- [ ] **Step 3: Implement minimal types and adapter**

Create types aligned with the canonical SDK concepts:

```ts
export type AccessScopeType = 'organization' | 'branch' | 'product' | 'branch_product';
export type PlatformBranch = { id: string; code: string; name: string; status: string };
export type PlatformAccessScope = { id: string; role: string; type: AccessScopeType; branchId?: string; productCode?: string; permissions: string[] };
export type PlatformProductRegistration = { code: string; name: string; routePrefix: string; requiredPermission?: string; requiredEntitlement?: string; legacyRoutes?: string[] };
```

`buildPlatformFrontendContext()` adapts existing `AppUser`, active company id, active branch id, and `PlatformEntitlements` into one read-only context object.

- [ ] **Step 4: Verify GREEN**

Run the new test and existing account/platform tests.

### Task 2: Add organization/branch context adapter

**Files:**
- Create: `src/platform/selection.ts`
- Modify: `src/services/auth.ts`
- Test: `tests/platformFrontendBoundary.test.mjs`

**Interfaces:**
- Produces `activeBranchId()`, `setActiveBranchId()`, `switchOrganizationContext()`.

- [ ] **Step 1: Extend failing tests**

Assert that `switchOrganizationContext(nextOrganizationId)` clears the branch key and that branch selection goes through exported helpers instead of direct localStorage access outside the adapter.

- [ ] **Step 2: Verify RED**

Run the targeted test; expected failure on missing selection helpers.

- [ ] **Step 3: Implement adapter**

Move branch-key reads/writes behind exported helpers while preserving storage keys for backward compatibility. Keep `setActiveCompanyId()` behavior compatible by delegating to the new organization switch helper.

- [ ] **Step 4: Verify GREEN**

Run targeted tests plus branch hierarchy and integration routing regressions.

### Task 3: Introduce product registry with Marketing and CRM

**Files:**
- Create: `src/platform/productRegistry.ts`
- Modify: `src/MarketingPlatform.tsx`
- Test: `tests/platformFrontendBoundary.test.mjs`

**Interfaces:**
- Produces `productRegistry`, `marketingProduct`, `crmProduct`, `canAccessRegisteredProduct()`.

- [ ] **Step 1: Extend failing tests**

Assert registry contains unique `marketing` and `crm` product codes, CRM owns `/crm`, `/leads`, `/customers`, `/pipeline`, and Marketing does not claim those routes.

- [ ] **Step 2: Verify RED**

Run targeted test; expected failure because registry does not exist.

- [ ] **Step 3: Implement registry**

Register:

```text
marketing -> /marketing
crm -> /crm with legacy routes /leads /customers /pipeline
```

Use existing permission/entitlement keys. The registry is metadata only and must not import backend code.

- [ ] **Step 4: Adapt navigation ownership**

`MarketingPlatform.tsx` may continue rendering current components, but CRM navigation metadata must be sourced from the registry rather than duplicated product identity constants.

- [ ] **Step 5: Verify GREEN**

Run targeted test, fail-closed entitlement tests, typecheck, and build.

### Task 4: Wire CI gate for common frontend boundary

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces `npm run test:platform-frontend` and a required CI step.

- [ ] **Step 1: Add script**

```json
"test:platform-frontend": "node --test tests/platformFrontendBoundary.test.mjs"
```

- [ ] **Step 2: Add CI step before typecheck**

Run `npm run test:platform-frontend`.

- [ ] **Step 3: Verify full CI**

All existing regression tests, new platform frontend tests, typecheck, and production build must succeed.

### Task 5: Stop at Phase 1 boundary

Do not remove `AuthGate`, do not relocate CRM backend code, do not move Schedule/Omnichannel/Analytics yet, and do not change production deployment topology in this PR. Phase 2 starts only after this compatibility boundary is green and reviewed.
