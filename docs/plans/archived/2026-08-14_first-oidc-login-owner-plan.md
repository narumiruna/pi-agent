## Goal

Remove `OIDC_OWNER_SUB` and `OIDC_OWNER_EMAIL` configuration and atomically make the first successfully verified OIDC identity the single Pi Agent administrator.

## Architecture

Store one immutable owner record keyed by OIDC issuer and `sub` in SQLite or PostgreSQL.

The first verified login claims the empty owner record atomically.

Later logins succeed only when issuer and `sub` match that record.

Pocket ID client user/group restrictions remain the protection against first-login takeover during bootstrap.

## Plan

- [x] Add failing config, storage, and auth tests for owner-free startup, atomic first claim, and rejection of later identities; focused Vitest failed on the previous owner allowlist behavior.
- [x] Add the owner storage contract and dialect migrations, invalidating pre-migration Web sessions once; SQLite contract passes and PostgreSQL verification is included below.
- [x] Replace environment allowlisting with first-login owner claiming after signed-token verification; focused auth and HTTP tests pass.
- [x] Remove owner variables from Compose, examples, local `.env`, and documentation, and document first-login security and owner reset recovery; repository search only finds this migration plan.
- [x] Run formatting, full CI, PostgreSQL contract, and container startup smoke tests; `npm run ci`, the 11-test PostgreSQL contract, `just smoke`, and `just postgres-smoke` pass.

## Risks

- Anyone allowed by the Pocket ID client who reaches an unclaimed public instance can become administrator.
- Losing access to the claimed Pocket ID identity requires an explicit database reset procedure.

## Rollback / Recovery

Restore the previous release and its environment allowlist before any first-login claim.

After migration, reset ownership only during maintenance by deleting the singleton owner and all Web sessions from the application database.

## Completion Checklist

- [x] OIDC mode starts without owner environment variables and still fails closed without issuer/client credentials, verified by `tests/server/config.test.ts`.
- [x] Exactly one verified OIDC identity can claim an unowned instance under concurrent-safe storage semantics, verified by the shared storage contract.
- [x] Different identities are rejected after ownership is claimed, verified by `tests/server/auth.test.ts`.
- [x] SQLite, PostgreSQL, full CI, and Docker smoke verification pass with the commands recorded above.
- [x] Deployment documentation explains Pocket ID restrictions, first login, and recovery in `README.md`.
