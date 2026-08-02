# Security baseline

## Tenant isolation

- Never accept `company_id` from the browser as proof of access.
- Resolve company membership from the authenticated user.
- Enforce tenant filters in repository queries and RLS.
- Test cross-tenant reads and writes explicitly.

## Secrets

- Store secrets in platform secret storage.
- Never expose service-role keys to the frontend.
- Encrypt integration credentials at rest.
- Record credential rotation and revocation.

## Webhooks

- Verify provider signatures.
- Store provider event IDs and reject duplicates.
- Process events through a queue.
- Use bounded retries and a dead-letter state.

## Audit

Record actor, company, action, entity, previous value, new value, source IP, user agent, request ID, and timestamp for sensitive changes.
