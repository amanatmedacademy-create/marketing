# BELES Platform Context Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move BELES platform context consumption behind one canonical-compatible frontend provider without breaking the current BELES login/session flow while Platform Core Unified Identity remains disabled in production.

**Architecture:** Add a local compatibility client whose runtime contract exactly follows `@imds/platform-sdk` `getMeContext()` and the canonical `MeContext` shape, then compose it with the existing BELES session/entitlement/branch adapters through a single `PlatformContextProvider`. Canonical Platform Core context is trusted only when its tenant matches the active BELES organization; otherwise the provider falls back to the existing server-authorized BELES context. Literal package adoption and CRM gateway cutover remain separate gates because `@imds/platform-sdk` is private/unpublished and Platform Core Unified Identity is `IDENTITY_ENABLED=false` by default.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Node 22 test runner, existing BELES auth/runtime, canonical IMDS Platform Core/SDK contracts.

**Spec:** `docs/superpowers/specs/2026-08-19-beles-platform-integration-design.md`

## Global Constraints

- Preserve existing user-visible BELES functionality; no frontend rewrite.
- Backend authorization remains authoritative and deny-by-default.
- Organization is the tenant boundary; branch/product are access scopes.
- Switching organization clears branch context.
- Never trust a canonical `MeContext` whose `tenant.id` differs from the active BELES organization.
- No browser-to-database access.
- No imports from backend/product repository source trees.
- Do not add `@imds/platform-sdk` as an npm dependency until it is publishable and deploy-time package authentication is configured.
- Do not enable Platform Core Unified Identity in this PR.
- Do not cut CRM traffic to API Gateway until tenant/branch request-scope semantics are explicit and tested.

---

### Task 1: Add canonical SDK compatibility contract and client

**Files:**
- Create: `src/platform/sdkContract.ts`
- Create: `src/platform/client.ts`
- Test: `tests/platformContextPhase2.test.mjs`

**Interfaces:**
- Produces `MeContext`, `ProductEntitlement`, `BranchContext`, `AccessScopeContext`, `PlatformApiError`.
- Produces `createPlatformClient({ baseUrl, tokenProvider, fetchImpl })` with `getMeContext()` calling `/api/platform/me/context`.

- [ ] **Step 1: Write the failing contract test**

Assert the client contains `/api/platform/me/context`, uses `Authorization: Bearer`, and the compatibility contract contains `organization | branch | product | branch_product` access scopes.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platformContextPhase2.test.mjs`
Expected: FAIL because `src/platform/client.ts` and `src/platform/sdkContract.ts` do not exist.

- [ ] **Step 3: Implement the minimal canonical-compatible client**

`src/platform/client.ts` must normalize `baseUrl`, obtain the bearer token from `tokenProvider`, issue GET requests, parse canonical API errors, and expose only `getMeContext()` in this phase.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/platformContextPhase2.test.mjs`
Expected: PASS for client/contract assertions.

### Task 2: Map canonical MeContext into the Phase 1 frontend context

**Files:**
- Modify: `src/platform/context.ts`
- Test: `tests/platformContextPhase2.test.mjs`

**Interfaces:**
- Consumes: `MeContext` from `src/platform/sdkContract.ts`.
- Produces: `buildPlatformFrontendContextFromMeContext(meContext, activeOrganizationId, activeBranchId)`.

- [ ] **Step 1: Extend the failing test**

Assert the mapper:
- rejects tenant mismatch;
- maps canonical permissions directly;
- maps enabled product `marketing` to entitlement `product.marketing`;
- maps enabled module keys such as `marketing.crm`;
- preserves `branches` and `accessScopes`;
- rejects an active branch that is absent or inactive in canonical branch visibility.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platformContextPhase2.test.mjs`
Expected: FAIL because `buildPlatformFrontendContextFromMeContext` is missing.

- [ ] **Step 3: Implement strict mapping**

The mapper throws on tenant mismatch and invalid selected branch. It does not silently rewrite organization or branch selection. Canonical `roles`, `permissions`, branch visibility, and access scopes are preserved.

- [ ] **Step 4: Verify GREEN**

Run the targeted test and `npm run test:platform-frontend`.
Expected: PASS.

### Task 3: Introduce the single PlatformContextProvider

**Files:**
- Create: `src/platform/PlatformContext.tsx`
- Modify: `src/main.tsx`
- Test: `tests/platformContextPhase2.test.mjs`

**Interfaces:**
- Produces `usePlatformContext()`.
- Provider value: `{ context, source, loading, error, canonicalError, refresh }` where `source` is `canonical | legacy`.

- [ ] **Step 1: Extend the failing test**

Assert `main.tsx` mounts `PlatformContextProvider` inside `AuthGate`, and provider source logic attempts canonical context but explicitly falls back to the Phase 1 builder.

- [ ] **Step 2: Verify RED**

Run targeted test; expected FAIL on missing provider.

- [ ] **Step 3: Implement provider**

Provider uses the existing BELES session token for the canonical probe. It concurrently loads legacy entitlements and branches for fallback. Canonical context is accepted only when tenant/branch validation succeeds; HTTP/auth/availability errors become `canonicalError` and do not break the existing application. If both canonical and legacy context construction fail, expose a deterministic provider error.

- [ ] **Step 4: Mount provider**

Wrap `SubscriptionStatusLayer` and `MarketingPlatform` with `PlatformContextProvider` inside the existing `AuthGate` boundary.

- [ ] **Step 5: Verify GREEN**

Run targeted test, Phase 1 frontend tests, branch tests, typecheck, and build.

### Task 4: Make MarketingPlatform consume the unified platform context

**Files:**
- Modify: `src/MarketingPlatform.tsx`
- Test: `tests/platformContextPhase2.test.mjs`

**Interfaces:**
- Consumes: `usePlatformContext()`.
- Removes direct navigation-entitlement ownership from `loadPlatformEntitlements()` in `MarketingPlatform`.

- [ ] **Step 1: Extend the failing test**

Assert `MarketingPlatform.tsx` imports `usePlatformContext`, no longer imports `loadPlatformEntitlements`, and evaluates module entitlement keys against `context.entitlements`.

- [ ] **Step 2: Verify RED**

Run targeted test; expected FAIL because MarketingPlatform still owns its entitlement polling.

- [ ] **Step 3: Migrate navigation gating**

Use unified context permission/entitlement arrays for navigation UX. Keep owner/super-admin billing UX unchanged and keep backend checks authoritative.

- [ ] **Step 4: Verify GREEN**

Run targeted test, fail-closed entitlement tests, account/platform tests, typecheck, and build.

### Task 5: Add CI gate and stop at the safe Phase 2 boundary

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `npm run test:platform-context`.

- [ ] **Step 1: Add script**

Add `"test:platform-context": "node --test tests/platformContextPhase2.test.mjs"`.

- [ ] **Step 2: Add CI step before typecheck**

Run `npm run test:platform-context` after the existing common frontend boundary regression test.

- [ ] **Step 3: Verify full CI**

All existing regression suites, Phase 1 frontend boundary, Phase 2 context tests, typecheck, and production build must succeed.

- [ ] **Step 4: Stop**

Do not publish packages, enable Unified Identity, change login token issuance, or cut CRM runtime to API Gateway in this PR. Those actions require their own verified rollout gates because they affect authentication and production request routing.
