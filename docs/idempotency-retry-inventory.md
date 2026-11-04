# Idempotency and Retry-Safety Inventory

## Purpose

This document is the living inventory of production HTTP mutation endpoints and their request-level idempotency / retry-safety characteristics, together with the downstream durable-work safety boundaries that matter to those endpoints.

Update it whenever a mutating production endpoint, its durable jobs, or its retry / redrive behavior changes.

## Boundary: HTTP mutation safety, same-key success replay, and downstream delivery safety

`Current HTTP mutation retry-safe` describes whether repeating the same logical HTTP request can apply the same request-level business mutation more than once.

For #18-selected PostgreSQL-backed mutations, request-level idempotency also provides **same-key success replay** within the retained idempotency window:

- after the PostgreSQL mutation commits successfully, `same key + same fingerprint` must return the endpoint's original success semantics;
- the business mutation, audit, and durable jobs must not run again;
- full HTTP response snapshots are not stored;
- replay uses the endpoint contract and only the minimum stable metadata required to reconstruct the success response;
- `204` endpoints require no response metadata beyond the committed idempotency operation;
- `POST /job-operations/dead-letter/redrive` stores only the original `operationId`.

This replay guarantee does not bypass current rate limiting, authentication, or authorization.

#18 does not force response replay where reproducing the original success response would require storing sensitive credentials/tokens, a generic response blob, or coordinating unresolved post-commit Redis/session state.

HTTP request idempotency does **not** mean that:

- a durable pg-boss job executes exactly once;
- a queue consumer cannot retry;
- a DLQ redrive reuses the same physical pg-boss job ID;
- an external provider effect is exactly-once;
- an email cannot be physically sent again after the provider's idempotency retention expires.

For endpoints that create durable work, HTTP idempotency and downstream consumer delivery safety are classified separately.

## Issue Ownership

- **#18** — HTTP → PostgreSQL mutation safety, ambiguous outcomes, and selected same-key success replay.
- **#29** — HTTP → Redis idempotency and ambiguous outcomes.
- **#16** — Redis mutation → mandatory PostgreSQL / pg-boss durable follow-up.
- **#30** — Avatar upload-proof lifecycle and stale cleanup / reselection race.

An endpoint may be tracked by more than one issue when it crosses more than one boundary.

## Verification ownership

- `Current natural idempotency` and `Current HTTP mutation retry-safe` describe current behavior.
- Request-level protection decisions are finalized only by the issue that owns the corresponding HTTP mutation boundary.
- During #18, only the HTTP → PostgreSQL boundary of rows whose `Tracked by` field includes `#18` is finalized.
- If a #18 endpoint crosses another unresolved boundary, #18's decision is recorded separately from that boundary's pending decision.
- `#N: Pending` means the owning issue has not finalized that boundary's request-level protection.
- Rows outside #18 remain inventory entries for coverage and ownership only.

## Classification

### Naturally idempotent

Repeating the same logical request leaves the authoritative state equivalent to applying it once.

### Current HTTP mutation retry-safe

Repeating the same logical HTTP request does not apply the same request-level business mutation more than once, even if the retry may currently return a different response.

`Current HTTP mutation retry-safe: Yes` is **not** a downstream exactly-once guarantee.

### Required `Idempotency-Key`

#18 requires explicit request-level identity when either:

1. repeating the logical request can create another valid request-level mutation/delivery/operation; or
2. a committed PostgreSQL mutation can currently be followed by a retry that loses the original success outcome (`404`, `409`, or another conflicting result), and the original success semantics can be replayed without a full response snapshot or sensitive token storage.

`Required Idempotency-Key (decision only)` records the design decision, not implemented header support.

HTTP `Idempotency-Key` is distinct from queue `deliveryId`.

## Durable delivery identity and redrive semantics

pg-boss has two different identities:

- **Physical job ID** — one persisted pg-boss job row / attempt.
- **Logical `deliveryId`** — the logical application delivery carried in job data.

For queued email delivery:

```text
provider idempotency key = ${queueName}/${deliveryId}
```

The same logical email retry / redrive keeps the same `deliveryId`, provider key, and semantic payload. A different logical email gets a new `deliveryId`.

Provider idempotency retention is bounded. Delayed retry / redrive may physically send the same logical email again after provider deduplication expires. Email delivery is **at-least-once**, not exactly-once.

## Avatar safety boundary

#30 remains open for the broader upload-proof and stale-cleanup lifecycle.

- replayable upload proofs must not be described as consumed / single-use until #30 implements that guarantee;
- `UserAvatarReplaceConsumer` and `AdminAvatarReplaceConsumer` are not globally retry-safe while the stale `SUPERSEDED` cleanup / reselection race remains open;
- #18 request replay does not imply global avatar-lifecycle exactly-once behavior.

## Inventory

### Auth

| Endpoint                 | Command / Handler                                      | PostgreSQL mutation                       | Redis mutation / effect | Current natural idempotency | Current HTTP mutation retry-safe | Required `Idempotency-Key` (decision only) | HTTP retry behavior (current / planned)                                     | Current downstream safety / limitations                        | Tracked by   |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------- | ----------------------- | --------------------------- | -------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| `POST /auth/user/login`  | `LoginUserCommand` / `LoginUserCommandHandler`         | Login audit                               | Session open            | No                          | No                               | #29: Pending                               | Retry may create a new session                                              | Primary mutation boundary is Redis                             | `#29`        |
| `POST /auth/admin/login` | `LoginAdminCommand` / `LoginAdminCommandHandler`       | Login audit                               | Session open            | No                          | No                               | #29: Pending                               | Retry may create a new session                                              | Primary mutation boundary is Redis                             | `#29`        |
| `POST /auth/refresh`     | `RefreshTokensCommand` / `RefreshTokensCommandHandler` | On reuse: audit + pg-boss remediation job | Token rotation          | No                          | Depends on Redis semantics       | #29: Pending                               | Existing refresh replay / reuse semantics apply                             | Redis → PostgreSQL handoff remains #16; email is at-least-once | `#29`, `#16` |
| `POST /auth/logout`      | `LogoutCommand` / `LogoutCommandHandler`               | None                                      | Session delete          | Yes                         | Yes                              | #29: Pending                               | Repeated close remains `204`                                                | Redis boundary                                                 | `#29`        |
| `POST /auth/logout-all`  | `LogoutAllCommand` / `LogoutAllCommandHandler`         | Audit + pg-boss revocation job            | None in request path    | No                          | No                               | **#18: Yes**                               | Planned: same-key replay returns `204`; no second revocation delivery/audit | Downstream queue execution remains independently retryable     | `#18`        |

### User

| Endpoint                           | Command / Handler                                                            | PostgreSQL mutation                                    | Redis mutation / effect                 | Other external effect             | Current natural idempotency | Current HTTP mutation retry-safe                   | Required `Idempotency-Key` (decision only) | HTTP retry behavior (current / planned)                                                                                                                                                  | Current downstream safety / limitations                                                                                              | Tracked by   |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | --------------------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `DELETE /user/me`                  | `DeleteUserCommand` / `DeleteUserCommandHandler`                             | Soft delete + audit + durable jobs                     | Best-effort version update after commit | None                              | State-idempotent            | Yes                                                | **#18: Yes**, #29: Pending                 | Current retry may return `404`; planned same-key replay returns original `204`                                                                                                           | Redis reconciliation remains #29-owned                                                                                               | `#18`, `#29` |
| `PATCH /user/me`                   | `UpdateUserCommand` / `UpdateUserCommandHandler`                             | Profile / avatar state + audit + durable jobs          | None                                    | S3 `HEAD` before transaction      | Partially                   | Conditional — name-only Yes; avatar tracked by #30 | #18: No, #30: Pending                      | Name-only retry already returns `200`; avatar lifecycle remains #30                                                                                                                      | No #18 key solely to mask #30                                                                                                        | `#18`, `#30` |
| `POST /user/me/avatar/initiate`    | `InitiateUserAvatarChangeCommand` / `InitiateUserAvatarChangeCommandHandler` | None                                                   | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                               | Retry may return a fresh upload plan/proof                                                                                                                                               | No PostgreSQL mutation                                                                                                               | `#30`        |
| `POST /user/me/email/initiate`     | `InitiateUserEmailChangeCommand` / `InitiateUserEmailChangeCommandHandler`   | Pending request + audit + delivery job                 | None                                    | None                              | No                          | No                                                 | **#18: Yes**                               | Planned same-key replay returns `204`; pending request/delivery not replaced again                                                                                                       | Email delivery remains at-least-once                                                                                                 | `#18`        |
| `POST /user/me/email/confirm`      | `ConfirmUserEmailChangeCommand` / `ConfirmUserEmailChangeCommandHandler`     | Email change + notification + audit + durable jobs     | Replacement session after commit        | None                              | No                          | Yes                                                | **#18: Yes**, #29: Pending                 | Planned: same-key retry recognizes the committed PostgreSQL operation before re-consuming the proof; final `200` session/token replay remains #29-owned                                  | #18 owns proof/PostgreSQL mutation identity; implementation is deferred until #29 finalizes the cross-boundary session/result replay | `#18`, `#29` |
| `PATCH /user/me/password`          | `ChangeUserPasswordCommand` / `ChangeUserPasswordCommandHandler`             | Password/session-version change + audit + durable jobs | Replacement session after commit        | None                              | No                          | Yes                                                | **#18: Yes**, #29: Pending                 | Planned: same-key retry recognizes the committed password mutation before re-validating the now-stale current-password/session state; final `200` session/token replay remains #29-owned | #18 owns PostgreSQL mutation identity; implementation is deferred until #29 finalizes the cross-boundary session/result replay       | `#18`, `#29` |
| `POST /user/registration/initiate` | `InitiateUserRegistrationCommand` / `InitiateUserRegistrationCommandHandler` | None; availability read only                           | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                               | Retry may return a fresh registration/upload identity                                                                                                                                    | No PostgreSQL mutation                                                                                                               | `#30`        |
| `POST /user/registration/complete` | `RegisterUserCommand` / `RegisterUserCommandHandler`                         | User insert + audit + durable jobs                     | None                                    | S3 `HEAD` before transaction      | No                          | Yes                                                | **#18: Yes**                               | Current retry may return `409`; planned same-key replay returns original `204`                                                                                                           | S3 interaction is read-only in the request path; avatar lifecycle risk remains tracked by #30                                        | `#18`, `#30` |
| `POST /user/activation/complete`   | `ActivateUserCommand` / `ActivateUserCommandHandler`                         | Activation proof consumption + audit                   | Replacement session after commit        | None                              | No                          | Yes                                                | **#18: Yes**, #29: Pending                 | Planned: same-key retry recognizes the committed activation before re-consuming the proof; final `200` session/token replay remains #29-owned                                            | #18 owns proof/PostgreSQL mutation identity; implementation is deferred until #29 finalizes the cross-boundary session/result replay | `#18`, `#29` |
| `POST /user/activation/resend`     | `ResendUserActivationCommand` / `ResendUserActivationCommandHandler`         | New activation identity + audit + delivery job         | None                                    | None                              | No                          | No                                                 | **#18: Yes**                               | Planned same-key replay returns `204`; no second activation identity/delivery                                                                                                            | Anti-enumeration remains unchanged                                                                                                   | `#18`        |
| `POST /user/:id/ban`               | `BanUserCommand` / `BanUserCommandHandler`                                   | Ban + audit + durable jobs                             | Best-effort version update after commit | None                              | Yes                         | Yes                                                | #18: No, #29: Pending                      | Repeated ban is already a no-op and returns `204`                                                                                                                                        | No additional #18 key needed for success replay                                                                                      | `#18`, `#29` |
| `POST /user/:id/unban`             | `UnbanUserCommand` / `UnbanUserCommandHandler`                               | Unban + audit + cache invalidation job                 | None                                    | None                              | Yes                         | Yes                                                | #18: No                                    | Repeated unban is already a no-op and returns `204`                                                                                                                                      | No additional key needed                                                                                                             | `#18`        |
| `PUT /user/:id/permissions`        | `ReplaceUserPermissionsCommand` / `ReplaceUserPermissionsCommandHandler`     | Permission-set replacement + audit + durable jobs      | Best-effort version update after commit | None                              | Yes                         | Yes                                                | #18: No, #29: Pending                      | Reapplying the same complete set is already a no-op and returns `204`                                                                                                                    | No additional #18 key needed                                                                                                         | `#18`, `#29` |

### Admin

| Endpoint                          | Command / Handler                                                              | PostgreSQL mutation                                    | Redis mutation / effect                 | Other external effect             | Current natural idempotency | Current HTTP mutation retry-safe                   | Required `Idempotency-Key` (decision only) | HTTP retry behavior (current / planned)                                                                                                                                                  | Current downstream safety / limitations                                                                                              | Tracked by   |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------- | --------------------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `DELETE /admin/:id`               | `DeleteAdminCommand` / `DeleteAdminCommandHandler`                             | Soft delete + audit + durable jobs                     | Best-effort version update after commit | None                              | State-idempotent            | Yes                                                | **#18: Yes**, #29: Pending                 | Current retry may return `404`; planned same-key replay returns original `204`                                                                                                           | Redis reconciliation remains #29-owned                                                                                               | `#18`, `#29` |
| `PATCH /admin/me`                 | `UpdateAdminCommand` / `UpdateAdminCommandHandler`                             | Profile / avatar state + audit + durable jobs          | None                                    | S3 `HEAD` before transaction      | Partially                   | Conditional — name-only Yes; avatar tracked by #30 | #18: No, #30: Pending                      | Name-only retry already returns `200`; avatar lifecycle remains #30                                                                                                                      | No #18 key solely to mask #30                                                                                                        | `#18`, `#30` |
| `POST /admin/me/avatar/initiate`  | `InitiateAdminAvatarChangeCommand` / `InitiateAdminAvatarChangeCommandHandler` | None                                                   | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                               | Retry may return a fresh upload plan/proof                                                                                                                                               | No PostgreSQL mutation                                                                                                               | `#30`        |
| `POST /admin/me/email/initiate`   | `InitiateAdminEmailChangeCommand` / `InitiateAdminEmailChangeCommandHandler`   | Pending request + audit + delivery job                 | None                                    | None                              | No                          | No                                                 | **#18: Yes**                               | Planned same-key replay returns `204`; pending request/delivery not replaced again                                                                                                       | Email delivery remains at-least-once                                                                                                 | `#18`        |
| `POST /admin/me/email/confirm`    | `ConfirmAdminEmailChangeCommand` / `ConfirmAdminEmailChangeCommandHandler`     | Email change + notification + audit + durable jobs     | Replacement session after commit        | None                              | No                          | Yes                                                | **#18: Yes**, #29: Pending                 | Planned: same-key retry recognizes the committed PostgreSQL operation before re-consuming the proof; final `200` session/token replay remains #29-owned                                  | #18 owns proof/PostgreSQL mutation identity; implementation is deferred until #29 finalizes the cross-boundary session/result replay | `#18`, `#29` |
| `PATCH /admin/me/password`        | `ChangeAdminPasswordCommand` / `ChangeAdminPasswordCommandHandler`             | Password/session-version change + audit + durable jobs | Replacement session after commit        | None                              | No                          | Yes                                                | **#18: Yes**, #29: Pending                 | Planned: same-key retry recognizes the committed password mutation before re-validating the now-stale current-password/session state; final `200` session/token replay remains #29-owned | #18 owns PostgreSQL mutation identity; implementation is deferred until #29 finalizes the cross-boundary session/result replay       | `#18`, `#29` |
| `POST /admin/invite`              | `InviteAdminCommand` / `InviteAdminCommandHandler`                             | New pending admin + audit + invitation job             | None                                    | None                              | No                          | Yes                                                | **#18: Yes**                               | Current retry may return `409 EMAIL_IN_USE`; planned same-key replay returns original `204`                                                                                              | Invitation email remains at-least-once                                                                                               | `#18`        |
| `POST /admin/activation/initiate` | `InitiateAdminActivationCommand` / `InitiateAdminActivationCommandHandler`     | None                                                   | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                               | Retry may return a fresh upload proof                                                                                                                                                    | No PostgreSQL mutation                                                                                                               | `#30`        |
| `POST /admin/activation/complete` | `ActivateAdminCommand` / `ActivateAdminCommandHandler`                         | Activation + audit + durable jobs                      | None                                    | S3 `HEAD` before transaction      | No                          | Yes                                                | **#18: Yes**                               | Current retry may return `409`; planned same-key replay returns original `204`                                                                                                           | S3 interaction is read-only in the request path; avatar lifecycle risk remains tracked by #30                                        | `#18`, `#30` |
| `POST /admin/:id/re-invite`       | `ReInviteAdminCommand` / `ReInviteAdminCommandHandler`                         | New invitation identity + audit + delivery job         | None                                    | None                              | No                          | No                                                 | **#18: Yes**                               | Planned same-key replay returns `204`; no second invitation identity/delivery                                                                                                            | Invitation email remains at-least-once                                                                                               | `#18`        |
| `POST /admin/:id/ban`             | `BanAdminCommand` / `BanAdminCommandHandler`                                   | Ban + audit + durable jobs                             | Best-effort version update after commit | None                              | Yes                         | Yes                                                | #18: No, #29: Pending                      | Repeated ban is already a no-op and returns `204`                                                                                                                                        | No additional #18 key needed                                                                                                         | `#18`, `#29` |
| `POST /admin/:id/unban`           | `UnbanAdminCommand` / `UnbanAdminCommandHandler`                               | Unban + audit                                          | None                                    | None                              | Yes                         | Yes                                                | #18: No                                    | Repeated unban is already a no-op and returns `204`                                                                                                                                      | No additional key needed                                                                                                             | `#18`        |
| `PUT /admin/:id/permissions`      | `ReplaceAdminPermissionsCommand` / `ReplaceAdminPermissionsCommandHandler`     | Permission-set replacement + audit + durable jobs      | Best-effort version update after commit | None                              | Yes                         | Yes                                                | #18: No, #29: Pending                      | Reapplying the same complete set is already a no-op and returns `204`                                                                                                                    | No additional #18 key needed                                                                                                         | `#18`, `#29` |

### Job Queue Operations

| Endpoint                                   | Command / Handler                                                        | PostgreSQL mutation               | Redis mutation / effect | Current natural idempotency | Current HTTP mutation retry-safe | Required `Idempotency-Key` (decision only) | HTTP retry behavior (current / planned)                                                     | Current downstream safety / limitations                            | Tracked by |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------- | ----------------------- | --------------------------- | -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| `POST /job-operations/dead-letter/redrive` | `StartDeadLetterRedriveCommand` / `StartDeadLetterRedriveCommandHandler` | pg-boss redrive operation + audit | None                    | No                          | No                               | **#18: Yes**                               | Planned same-key replay returns `202` with original `operationId`; no new redrive operation | Physical job IDs may change; logical `deliveryId` remains separate | `#18`      |
| `POST /job-operations/dead-letter/discard` | `DiscardDeadLetterJobsCommand` / `DiscardDeadLetterJobsCommandHandler`   | Dead-letter deletion + audit      | None                    | Effect-idempotent           | Yes                              | **#18: Yes**                               | Current retry may return `404`; planned same-key replay returns original `204`              | No consumer redrive occurs                                         | `#18`      |

## #18 Decision Summary

`#18: Yes` applies to 17 endpoints:

### Auth

- `POST /auth/logout-all`

### User

- `DELETE /user/me`
- `POST /user/me/email/initiate`
- `POST /user/me/email/confirm`
- `PATCH /user/me/password`
- `POST /user/registration/complete`
- `POST /user/activation/complete`
- `POST /user/activation/resend`

### Admin

- `DELETE /admin/:id`
- `POST /admin/me/email/initiate`
- `POST /admin/me/email/confirm`
- `PATCH /admin/me/password`
- `POST /admin/invite`
- `POST /admin/activation/complete`
- `POST /admin/:id/re-invite`

### Job Queue Operations

- `POST /job-operations/dead-letter/redrive`
- `POST /job-operations/dead-letter/discard`

Only redrive requires persisted replay response metadata (`operationId`) among the currently self-contained #18 endpoints.

### #29 implementation dependency

Rows marked `#18: Yes, #29: Pending` have their #18 design decision finalized here, but their implementation is deferred until #29 is worked. Their PostgreSQL mutation identity and Redis/session result must be integrated as one cross-boundary retry contract instead of implementing a partial replay now.

This currently includes:

- `DELETE /user/me`
- `POST /user/me/email/confirm`
- `PATCH /user/me/password`
- `POST /user/activation/complete`
- `DELETE /admin/:id`
- `POST /admin/me/email/confirm`
- `PATCH /admin/me/password`

For `204` endpoints not blocked by #29, the committed idempotency operation alone is enough to replay the fixed success status.

## Maintenance Rules

When a mutating production endpoint is added or changed:

1. Update its inventory row from actual controller, handler, persistence, Redis, durable-job, and external-effect behavior.
2. Classify HTTP mutation safety separately from downstream delivery safety.
3. For #18 PostgreSQL mutations, also determine whether a committed success can be replayed with no or minimal stable metadata.
4. Require `Idempotency-Key` when mutation deduplication is needed or when success outcome certainty would otherwise be lost after a committed mutation.
5. Do not add a full response/result blob solely for replay.
6. Do not persist credentials, tokens, raw semantic payloads, or unkeyed secret digests for fingerprint/replay.
7. Do not infer queue exactly-once behavior from HTTP retry safety or same-key success replay.
8. Keep physical pg-boss job identity separate from logical `deliveryId`.
9. Record issue ownership independently for #18, #29, #16, and #30.
10. Revalidate the whole inventory whenever endpoint behavior, durable-job topology, replay semantics, or issue ownership changes.