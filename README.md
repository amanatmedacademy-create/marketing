# IMDS Marketing

Clean modular foundation for the IMDS Marketing platform.

This branch intentionally contains no legacy CRM implementation, demo metrics, backup code, generated build output, or static integration promises. The previous implementation remains available in Git history and in `main` until this draft pull request is approved.

## Workspace

- `apps/web` — React 18 + TypeScript + Vite frontend.
- `apps/api` — modular Cloudflare Worker API.
- `packages/contracts` — shared module contracts used by frontend and backend.
- `docs` — architecture, module scope, security rules, and delivery roadmap.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

## Current scope

The foundation provides:

- URL-based routing instead of local component state;
- a single module registry shared by frontend and backend;
- separate application and API packages;
- a health endpoint and module-catalog endpoint;
- a documented implementation order;
- no production integrations or fake operational data.

## API endpoints

- `GET /api/health`
- `GET /api/modules`

## Delivery rule

A module is not marked operational until it has database schema, tenant isolation, permissions, backend endpoints, frontend states, audit logging, tests, and monitoring.
