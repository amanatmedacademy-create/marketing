# Branch Inbox Bootstrap Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore branch creation and Unified Inbox for clinics that currently have no branches, while making future clinic creation bootstrap a valid primary branch automatically.

**Architecture:** Keep the hotfix bounded to the current Beles runtime. Preserve the sanitized request body before creating the trusted downstream request, make first-branch creation self-healing, bypass integration credential hydration only for the read-only Inbox workspace endpoint, and add an idempotent PostgreSQL migration plus deployment wiring that backfills zero-branch clinics and installs an AFTER INSERT clinic bootstrap trigger.

**Tech Stack:** TypeScript, Cloudflare/Web Fetch API, Node.js 22 test runner, PostgreSQL 17, GitHub Actions, VPS deployment.

**Spec:** Production incident reproduced on 2026-08-19: `POST /api/branches` always returns `400 {"error":"Укажите название филиала"}`; `GET /api/callcenter/workspace?limit=200` returns `500` with `Основной филиал клиники не определён`; current clinic has `GET /api/branches -> items: []`.

## Global Constraints

- Do not merge this hotfix with the larger App Shell / repository-splitting architecture work.
- Keep `crm_companies` as the tenant boundary and `crm_branches` as the operational scope.
- Do not weaken branch authorization or tenant scoping.
- Do not make integration credentials globally optional; bypass hydration only for the read-only workspace endpoint that does not consume provider secrets.
- SQL must be idempotent and safe to re-run on the production PostgreSQL 17 database.
- Every production behavior change must have a regression test that is observed failing before the implementation is added.

---

### Task 1: Preserve branch mutation request bodies

**Files:**
- Modify: `tests/branchHierarchy.test.mjs`
- Modify: `worker/securedMain.ts`

**Interfaces:**
- Consumes: authenticated `Request` passed through `sanitizedRequest` and `trustedRequest`.
- Produces: `cleanRequest` remains readable by `handleBranchManagementRequest`, while `forwardedRequest` carries trusted identity headers downstream.

- [ ] **Step 1: Write the failing test**

Add a regression assertion requiring `trustedRequest` to receive `cleanRequest.clone()` before branch management reads `cleanRequest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:branches`
Expected: FAIL because current `securedMain.ts` passes `cleanRequest` directly into `trustedRequest`.

- [ ] **Step 3: Write minimal implementation**

Change only the trusted forwarding construction so it consumes a clone, not the handler's request object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:branches`
Expected: PASS for the request-body regression.

---

### Task 2: Make first branch creation self-healing

**Files:**
- Modify: `tests/branchHierarchy.test.mjs`
- Modify: `worker/branchManagement.ts`

**Interfaces:**
- Consumes: `POST /api/branches` payload after JSON parsing.
- Produces: a new branch with `is_primary=true` only when the company currently has zero non-archived branches.

- [ ] **Step 1: Write the failing test**

Assert that branch creation checks for an existing non-archived branch and sends `is_primary: existingBranches.length === 0` in the insert payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:branches`
Expected: FAIL because current insert payload never sets `is_primary`.

- [ ] **Step 3: Write minimal implementation**

Before the insert, query one non-archived branch for the current company. Add `is_primary: existingBranches.length === 0` to the new row.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:branches`
Expected: PASS.

---

### Task 3: Let empty Inbox workspace render without provider credentials

**Files:**
- Modify: `tests/branchHierarchy.test.mjs`
- Modify: `worker/main.ts`

**Interfaces:**
- Consumes: `GET /api/callcenter/workspace` after tenant/auth resolution.
- Produces: the workspace handler receives tenant-scoped base env without forcing `hydrateIntegrationEnv` when no primary branch exists.

- [ ] **Step 1: Write the failing test**

Assert that only `GET /api/callcenter/workspace` uses `requestEnv` directly and all other routes still call `hydrateIntegrationEnv(requestEnv)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:branches`
Expected: FAIL because hydration is currently unconditional.

- [ ] **Step 3: Write minimal implementation**

Use a conditional `runtimeEnv` assignment for the workspace GET endpoint; leave all other route behavior unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:branches`
Expected: PASS.

---

### Task 4: Backfill and bootstrap primary branches in PostgreSQL

**Files:**
- Create: `supabase/migrations/20260819234500_branch_bootstrap_hardening.sql`
- Modify: `.github/workflows/apply-branch-hierarchy-vps.yml`
- Modify: `tests/branchHierarchy.test.mjs`

**Interfaces:**
- Consumes: existing `crm_companies` and `crm_branches` schema.
- Produces: every zero-branch company receives an active primary `MAIN` branch; every future `crm_companies` insert gets one automatically.

- [ ] **Step 1: Write the failing test**

Assert the migration contains an idempotent zero-branch backfill, `imds_bootstrap_company_primary_branch()` trigger function, and an AFTER INSERT trigger on `crm_companies`. Assert the branch-schema workflow uploads/applies/removes the new migration.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:branches`
Expected: FAIL because the migration does not exist and the workflow does not reference it.

- [ ] **Step 3: Write minimal implementation**

Create the SQL migration with the same `MAIN`/active/primary semantics used by the original branch hierarchy migration. Wire it into the dedicated VPS branch-schema workflow.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:branches`
Expected: PASS.

---

### Task 5: Verify the complete hotfix

**Files:**
- No additional production files expected.

**Interfaces:**
- Produces: a reviewable PR with CI evidence.

- [ ] **Step 1: Run focused regression suite**

Run: `npm run test:branches`
Expected: PASS.

- [ ] **Step 2: Run full CI-equivalent checks**

Run all commands from `.github/workflows/ci.yml`, including typecheck and production build.
Expected: PASS with zero failed checks.

- [ ] **Step 3: Review diff**

Confirm no changes outside the bounded hotfix files and plan.

- [ ] **Step 4: Open/update draft PR**

PR must document the two reproduced API failures, root causes, migration behavior, and post-deploy smoke checks:
`GET /api/branches`, `POST /api/branches`, `GET /api/branches`, `GET /api/callcenter/workspace?limit=200`.
