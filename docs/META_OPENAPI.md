# Meta WhatsApp OpenAPI

IMDS Marketing uses the official Meta OpenAPI specification for WhatsApp Business Messaging as the source for generated TypeScript definitions.

## Pinned source

- Repository: `facebook/openapi`
- Specification: `business-messaging-api_v23.0.yaml`
- Meta commit: `40033862592a6201af195a7fc0853cd197cac653`
- Generator: `openapi-typescript@7.13.0`

The source is pinned to a commit rather than the repository's moving `main` branch. Meta API changes therefore cannot silently alter the generated definitions during a build.

## Commands

```bash
npm run meta:openapi:sync
npm run meta:openapi:check
```

`meta:openapi:sync` downloads the pinned specification and writes:

```text
src/types/generated/meta-business-messaging-v23.ts
```

The generated file is intentionally excluded from Git. It is recreated before `typecheck` and `build`.

`meta:openapi:check` downloads and validates the pinned specification and verifies that TypeScript definitions can be generated. CI executes this command explicitly.

## Updating the API version

1. Review the new specification in the official Meta repository.
2. Update the commit, API version and file name in `scripts/sync-meta-openapi.mjs`.
3. Run `npm run meta:openapi:sync`.
4. Run `npm run typecheck` and `npm run build`.
5. Review changes to WABA requests, webhook payload handling and supported message types before merging.

Use of the Meta APIs remains subject to Meta's applicable platform terms and WhatsApp Business terms.
