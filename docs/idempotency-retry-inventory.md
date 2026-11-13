# Idempotency and Retry-Safety Inventory

## Purpose

This file summarizes the idempotency and retry-safety status of production HTTP mutation endpoints.

When an endpoint changes, re-evaluate:

- Can repeating the same logical request apply the mutation again?
- Is the endpoint naturally idempotent?
- Is it retry-safe?
- Is `Idempotency-Key` required?
- How does same-key replay behave?
- Is there an open issue tracking an additional risk?

## Classification

- **Naturally idempotent:** Repeating the same logical request leaves the authoritative state equivalent to applying it once.
- **Retry-safe:** Repeating the same logical HTTP request does not apply the same business mutation again.
- **`Idempotency-Key`:** Required when a retry can create another mutation/session/rotation/delivery, or when a committed success could later be reclassified as a different failure.
- **Replay:** For the same key + same logical request, the mutation is not repeated and the endpoint's success semantics are preserved.
- HTTP retry-safety does not imply exactly-once downstream queue execution or external effects.

## Issue ownership

- **#16** — Redis mutation → mandatory PostgreSQL / pg-boss follow-up.
- **#30** — Avatar upload-proof lifecycle and stale cleanup / reselection race.
- **#3** — PostgreSQL idempotency retention/cleanup.

## Inventory

### Auth

| Endpoint                 | Mutation                                            | Naturally idempotent | Retry-safe                        | `Idempotency-Key` | Replay behavior                                                                            | Tracked by |
| ------------------------ | --------------------------------------------------- | -------------------- | --------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | ---------- |
| `POST /auth/user/login`  | PostgreSQL audit + Redis session open               | No                   | Yes, for the same key within 120s | **Yes**           | Same key reuses the existing live session; no second session is opened.                    | `#16`      |
| `POST /auth/admin/login` | PostgreSQL audit + Redis session open               | No                   | Yes, for the same key within 120s | **Yes**           | Same key reuses the existing live session; no second session is opened.                    | `#16`      |
| `POST /auth/refresh`     | Redis token rotation; PostgreSQL audit/job on reuse | No                   | Yes, for the same key within 120s | **Yes**           | Same key does not rotate again; a different key keeps the existing replay/reuse semantics. | `#16`      |
| `POST /auth/logout`      | Redis session delete                                | Yes                  | Yes                               | **No**            | Repeated close is safe and remains `204`.                                                  | —          |
| `POST /auth/logout-all`  | PostgreSQL audit + revocation job                   | No                   | Yes, same key                     | **Yes**           | Same key replays `204`; mutation/audit/job are not repeated.                               | —          |

### User

| Endpoint                           | Mutation                                                                           | Naturally idempotent | Retry-safe                  | `Idempotency-Key` | Replay behavior                                                                                  | Tracked by |
| ---------------------------------- | ---------------------------------------------------------------------------------- | -------------------- | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| `DELETE /user/me`                  | PostgreSQL soft delete + audit + jobs; best-effort Redis version update            | State-idempotent     | Yes                         | **Yes**           | Same key replays `204`; business mutation and immediate Redis push are not repeated.             | —          |
| `PATCH /user/me`                   | PostgreSQL profile/avatar mutation                                                 | Partially            | Name-only: Yes; avatar: #30 | No                | Name-only retry is safe; avatar lifecycle is tracked separately.                                 | `#30`      |
| `POST /user/me/avatar/initiate`    | S3 upload authorization/signing                                                    | No                   | Yes                         | No                | Retry may return a fresh upload plan/proof.                                                      | `#30`      |
| `POST /user/me/email/initiate`     | PostgreSQL pending request + audit + delivery job                                  | No                   | Yes, same key               | Yes               | Same key replays `204`.                                                                          | —          |
| `POST /user/me/email/confirm`      | PostgreSQL email change + audit + jobs                                             | No                   | Yes, same key               | **Yes**           | First success and replay return `204`; proof and mutation are not repeated.                      | —          |
| `PATCH /user/me/password`          | PostgreSQL password/session-version change + audit + jobs                          | No                   | Yes, same key               | **Yes**           | First success and replay return `204`; password preparation and mutation are not repeated.       | —          |
| `POST /user/registration/initiate` | S3 upload authorization/signing                                                    | No                   | Yes                         | No                | Retry may return a fresh registration/upload identity.                                           | `#30`      |
| `POST /user/registration/complete` | PostgreSQL user insert + audit + jobs                                              | No                   | Yes, same key               | Yes               | Same key replays `204`; proof/S3 validation and mutation are not repeated.                       | `#30`      |
| `POST /user/activation/complete`   | PostgreSQL activation + audit                                                      | No                   | Yes, same key               | **Yes**           | First success and replay return `204`; proof/password preparation and mutation are not repeated. | —          |
| `POST /user/activation/resend`     | PostgreSQL activation identity + audit + delivery job                              | No                   | Yes, same key               | Yes               | Same key replays `204`; no-op outcomes are retained.                                             | —          |
| `POST /user/:id/ban`               | PostgreSQL ban + audit + jobs; best-effort Redis version update                    | Yes                  | Yes                         | **No**            | Repeated ban is a no-op and returns `204`.                                                       | —          |
| `POST /user/:id/unban`             | PostgreSQL unban + audit + cache invalidation job                                  | Yes                  | Yes                         | No                | Repeated unban is a no-op and returns `204`.                                                     | —          |
| `PUT /user/:id/permissions`        | PostgreSQL permission replacement + audit + jobs; best-effort Redis version update | Yes                  | Yes                         | **No**            | Reapplying the same permission set is a no-op and returns `204`.                                 | —          |

### Admin

| Endpoint                          | Mutation                                                                           | Naturally idempotent | Retry-safe                  | `Idempotency-Key` | Replay behavior                                                                            | Tracked by |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------- | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | ---------- |
| `DELETE /admin/:id`               | PostgreSQL soft delete + audit + jobs; best-effort Redis version update            | State-idempotent     | Yes                         | **Yes**           | Same key replays `204`; business mutation and immediate Redis push are not repeated.       | —          |
| `PATCH /admin/me`                 | PostgreSQL profile/avatar mutation                                                 | Partially            | Name-only: Yes; avatar: #30 | No                | Name-only retry is safe; avatar lifecycle is tracked separately.                           | `#30`      |
| `POST /admin/me/avatar/initiate`  | S3 upload authorization/signing                                                    | No                   | Yes                         | No                | Retry may return a fresh upload plan/proof.                                                | `#30`      |
| `POST /admin/me/email/initiate`   | PostgreSQL pending request + audit + delivery job                                  | No                   | Yes, same key               | Yes               | Same key replays `204`.                                                                    | —          |
| `POST /admin/me/email/confirm`    | PostgreSQL email change + audit + jobs                                             | No                   | Yes, same key               | **Yes**           | First success and replay return `204`; proof and mutation are not repeated.                | —          |
| `PATCH /admin/me/password`        | PostgreSQL password/session-version change + audit + jobs                          | No                   | Yes, same key               | **Yes**           | First success and replay return `204`; password preparation and mutation are not repeated. | —          |
| `POST /admin/invite`              | PostgreSQL pending admin + audit + invitation job                                  | No                   | Yes, same key               | Yes               | Same key replays `204`.                                                                    | —          |
| `POST /admin/activation/initiate` | S3 upload authorization/signing                                                    | No                   | Yes                         | No                | Retry may return a fresh upload proof.                                                     | `#30`      |
| `POST /admin/activation/complete` | PostgreSQL activation + audit + jobs                                               | No                   | Yes, same key               | Yes               | Same key replays `204`; proof/S3 validation and mutation are not repeated.                 | `#30`      |
| `POST /admin/:id/re-invite`       | PostgreSQL invitation identity + audit + delivery job                              | No                   | Yes, same key               | Yes               | Same key replays `204`.                                                                    | —          |
| `POST /admin/:id/ban`             | PostgreSQL ban + audit + jobs; best-effort Redis version update                    | Yes                  | Yes                         | **No**            | Repeated ban is a no-op and returns `204`.                                                 | —          |
| `POST /admin/:id/unban`           | PostgreSQL unban + audit                                                           | Yes                  | Yes                         | No                | Repeated unban is a no-op and returns `204`.                                               | —          |
| `PUT /admin/:id/permissions`      | PostgreSQL permission replacement + audit + jobs; best-effort Redis version update | Yes                  | Yes                         | **No**            | Reapplying the same permission set is a no-op and returns `204`.                           | —          |

### Job Queue Operations

| Endpoint                                   | Mutation                                     | Naturally idempotent | Retry-safe    | `Idempotency-Key` | Replay behavior                                         | Tracked by |
| ------------------------------------------ | -------------------------------------------- | -------------------- | ------------- | ----------------- | ------------------------------------------------------- | ---------- |
| `POST /job-operations/dead-letter/redrive` | PostgreSQL/pg-boss redrive operation + audit | No                   | Yes, same key | Yes               | Same key replays `202` with the original `operationId`. | —          |
| `POST /job-operations/dead-letter/discard` | PostgreSQL dead-letter deletion + audit      | Effect-idempotent    | Yes, same key | Yes               | Same key replays `204`.                                 | —          |

## Maintenance rules

When a mutating production endpoint is added or changed:

1. Update its mutation type and retry behavior.
2. Evaluate natural idempotency and request-level retry-safety separately.
3. Re-evaluate whether `Idempotency-Key` is required.
4. Keep same-key replay behavior short and explicit.
5. Do not confuse downstream queue/external-effect risk with HTTP retry-safety.
6. Keep open risks in the `Tracked by` column.
