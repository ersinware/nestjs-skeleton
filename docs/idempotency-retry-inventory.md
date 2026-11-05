# Idempotency and Retry-Safety Inventory

## Purpose

This document is the living inventory of production HTTP mutation endpoints and their request-level idempotency / retry-safety characteristics, together with the downstream durable-work safety boundaries that matter to those endpoints.

Update it whenever a mutating production endpoint, its durable jobs, or its retry / redrive behavior changes.

## Boundary: HTTP mutation safety, same-key success replay, and downstream delivery safety

`Current HTTP mutation retry-safe` describes whether repeating the same logical HTTP request can apply the same request-level business mutation more than once.

Endpoints with implemented explicit idempotency require a single global UUID v4 `Idempotency-Key` (`400` if missing/invalid). They retain successful operations: same key + same fingerprint replays the original success without repeating mutation, audit, or jobs. Current guards and rate limits still apply. Full responses and credentials are never stored; `204` needs no result identity, redrive retains its original `operationId`.

Post-commit Redis/session result replay remains #29-owned. HTTP replay does not guarantee exactly-once queue execution or external effects: consumers can retry, DLQ/redrive can change physical job IDs, and provider retention can expire.

For endpoints that create durable work, HTTP idempotency and downstream consumer delivery safety are classified separately.

## Issue Ownership

- **#29** — HTTP → Redis idempotency and ambiguous outcomes.
- **#16** — Redis mutation → mandatory PostgreSQL / pg-boss durable follow-up.
- **#30** — Avatar upload-proof lifecycle and stale cleanup / reselection race.
- **#3** — Idempotency retention/cleanup.

An endpoint may be tracked by more than one issue when it crosses more than one boundary.

## Verification ownership

- Natural idempotency and HTTP mutation retry safety describe current behavior.
- Key requirements are design decisions; the current/planned retry column identifies implemented header support.
- PostgreSQL key decisions and unresolved Redis/avatar boundaries are recorded separately.
- `#N: Pending` means the owning issue has not finalized that boundary's request-level protection.

## Classification

### Naturally idempotent

Repeating the same logical request leaves the authoritative state equivalent to applying it once.

### Current HTTP mutation retry-safe

Repeating the same logical HTTP request does not apply the same request-level business mutation more than once, even if the retry may currently return a different response.

`Current HTTP mutation retry-safe: Yes` is **not** a downstream exactly-once guarantee.

### Required `Idempotency-Key`

PostgreSQL mutations require explicit request-level identity when either:

1. repeating the logical request can create another valid request-level mutation/delivery/operation; or
2. a committed PostgreSQL mutation can currently be followed by a retry that loses the original success outcome (`404`, `409`, or another conflicting result), and the original success semantics can be replayed without a full response snapshot or sensitive token storage.

`Idempotency-Key requirement` records the design decision; the current retry behavior column identifies implemented header support.

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
- Request replay does not imply global avatar-lifecycle exactly-once behavior.

## Inventory

### Auth

| Endpoint                 | Command / Handler                                      | PostgreSQL mutation                       | Redis mutation / effect | Current natural idempotency | Current HTTP mutation retry-safe | `Idempotency-Key` requirement | HTTP retry behavior (current / planned)         | Current downstream safety / limitations                        | Tracked by   |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------- | ----------------------- | --------------------------- | -------------------------------- | ----------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ------------ |
| `POST /auth/user/login`  | `LoginUserCommand` / `LoginUserCommandHandler`         | Login audit                               | Session open            | No                          | No                               | #29: Pending                  | Retry may create a new session                  | Primary mutation boundary is Redis                             | `#29`        |
| `POST /auth/admin/login` | `LoginAdminCommand` / `LoginAdminCommandHandler`       | Login audit                               | Session open            | No                          | No                               | #29: Pending                  | Retry may create a new session                  | Primary mutation boundary is Redis                             | `#29`        |
| `POST /auth/refresh`     | `RefreshTokensCommand` / `RefreshTokensCommandHandler` | On reuse: audit + pg-boss remediation job | Token rotation          | No                          | Depends on Redis semantics       | #29: Pending                  | Existing refresh replay / reuse semantics apply | Redis → PostgreSQL handoff remains #16; email is at-least-once | `#29`, `#16` |
| `POST /auth/logout`      | `LogoutCommand` / `LogoutCommandHandler`               | None                                      | Session delete          | Yes                         | Yes                              | #29: Pending                  | Repeated close remains `204`                    | Redis boundary                                                 | `#29`        |
| `POST /auth/logout-all`  | `LogoutAllCommand` / `LogoutAllCommandHandler`         | Audit + pg-boss revocation job            | None in request path    | No                          | Yes (same key)                   | Yes                           | Implemented: keyed `204` replay                 | Downstream queue execution remains independently retryable     | —            |

### User

| Endpoint                           | Command / Handler                                                            | PostgreSQL mutation                                    | Redis mutation / effect                 | Other external effect             | Current natural idempotency | Current HTTP mutation retry-safe                   | `Idempotency-Key` requirement | HTTP retry behavior (current / planned)                                                                                                                                                  | Current downstream safety / limitations                                                       | Tracked by |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | --------------------------------- | --------------------------- | -------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `DELETE /user/me`                  | `DeleteUserCommand` / `DeleteUserCommandHandler`                             | Soft delete + audit + durable jobs                     | Best-effort version update after commit | None                              | State-idempotent            | Yes                                                | Yes, #29: Pending             | Implemented: keyed `204` replay if current authentication succeeds                                                                                                                       | Redis reconciliation remains #29-owned                                                        | `#29`      |
| `PATCH /user/me`                   | `UpdateUserCommand` / `UpdateUserCommandHandler`                             | Profile / avatar state + audit + durable jobs          | None                                    | S3 `HEAD` before transaction      | Partially                   | Conditional — name-only Yes; avatar tracked by #30 | No, #30: Pending              | Name-only retry already returns `200`; avatar lifecycle remains #30                                                                                                                      | No key solely to mask #30                                                                     | `#30`      |
| `POST /user/me/avatar/initiate`    | `InitiateUserAvatarChangeCommand` / `InitiateUserAvatarChangeCommandHandler` | None                                                   | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                  | Retry may return a fresh upload plan/proof                                                                                                                                               | No PostgreSQL mutation                                                                        | `#30`      |
| `POST /user/me/email/initiate`     | `InitiateUserEmailChangeCommand` / `InitiateUserEmailChangeCommandHandler`   | Pending request + audit + delivery job                 | None                                    | None                              | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay                                                                                                                                                          | Email delivery remains at-least-once                                                          | —          |
| `POST /user/me/email/confirm`      | `ConfirmUserEmailChangeCommand` / `ConfirmUserEmailChangeCommandHandler`     | Email change + notification + audit + durable jobs     | Replacement session after commit        | None                              | No                          | Yes                                                | Yes, #29: Pending             | Planned: same-key retry recognizes the committed PostgreSQL operation before re-consuming the proof; final `200` session/token replay remains #29-owned                                  | PostgreSQL identity and session/result replay integration deferred to #29                     | `#29`      |
| `PATCH /user/me/password`          | `ChangeUserPasswordCommand` / `ChangeUserPasswordCommandHandler`             | Password/session-version change + audit + durable jobs | Replacement session after commit        | None                              | No                          | Yes                                                | Yes, #29: Pending             | Planned: same-key retry recognizes the committed password mutation before re-validating the now-stale current-password/session state; final `200` session/token replay remains #29-owned | PostgreSQL identity and session/result replay integration deferred to #29                     | `#29`      |
| `POST /user/registration/initiate` | `InitiateUserRegistrationCommand` / `InitiateUserRegistrationCommandHandler` | None; availability read only                           | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                  | Retry may return a fresh registration/upload identity                                                                                                                                    | No PostgreSQL mutation                                                                        | `#30`      |
| `POST /user/registration/complete` | `RegisterUserCommand` / `RegisterUserCommandHandler`                         | User insert + audit + durable jobs                     | None                                    | S3 `HEAD` before transaction      | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay; replay skips expired proof and S3 revalidation                                                                                                          | S3 interaction is read-only in the request path; avatar lifecycle risk remains tracked by #30 | `#30`      |
| `POST /user/activation/complete`   | `ActivateUserCommand` / `ActivateUserCommandHandler`                         | Activation proof consumption + audit                   | Replacement session after commit        | None                              | No                          | Yes                                                | Yes, #29: Pending             | Planned: same-key retry recognizes the committed activation before re-consuming the proof; final `200` session/token replay remains #29-owned                                            | PostgreSQL identity and session/result replay integration deferred to #29                     | `#29`      |
| `POST /user/activation/resend`     | `ResendUserActivationCommand` / `ResendUserActivationCommandHandler`         | New activation identity + audit + delivery job         | None                                    | None                              | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay; unknown/ineligible-account no-ops are retained without revealing account state                                                                          | Anti-enumeration remains unchanged                                                            | —          |
| `POST /user/:id/ban`               | `BanUserCommand` / `BanUserCommandHandler`                                   | Ban + audit + durable jobs                             | Best-effort version update after commit | None                              | Yes                         | Yes                                                | No, #29: Pending              | Repeated ban is already a no-op and returns `204`                                                                                                                                        | No additional key needed for success replay                                                   | `#29`      |
| `POST /user/:id/unban`             | `UnbanUserCommand` / `UnbanUserCommandHandler`                               | Unban + audit + cache invalidation job                 | None                                    | None                              | Yes                         | Yes                                                | No                            | Repeated unban is already a no-op and returns `204`                                                                                                                                      | No additional key needed                                                                      | —          |
| `PUT /user/:id/permissions`        | `ReplaceUserPermissionsCommand` / `ReplaceUserPermissionsCommandHandler`     | Permission-set replacement + audit + durable jobs      | Best-effort version update after commit | None                              | Yes                         | Yes                                                | No, #29: Pending              | Reapplying the same complete set is already a no-op and returns `204`                                                                                                                    | No additional key needed                                                                      | `#29`      |

### Admin

| Endpoint                          | Command / Handler                                                              | PostgreSQL mutation                                    | Redis mutation / effect                 | Other external effect             | Current natural idempotency | Current HTTP mutation retry-safe                   | `Idempotency-Key` requirement | HTTP retry behavior (current / planned)                                                                                                                                                  | Current downstream safety / limitations                                                       | Tracked by |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------- | --------------------------------- | --------------------------- | -------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `DELETE /admin/:id`               | `DeleteAdminCommand` / `DeleteAdminCommandHandler`                             | Soft delete + audit + durable jobs                     | Best-effort version update after commit | None                              | State-idempotent            | Yes                                                | Yes, #29: Pending             | Implemented: keyed `204` replay                                                                                                                                                          | Redis reconciliation remains #29-owned                                                        | `#29`      |
| `PATCH /admin/me`                 | `UpdateAdminCommand` / `UpdateAdminCommandHandler`                             | Profile / avatar state + audit + durable jobs          | None                                    | S3 `HEAD` before transaction      | Partially                   | Conditional — name-only Yes; avatar tracked by #30 | No, #30: Pending              | Name-only retry already returns `200`; avatar lifecycle remains #30                                                                                                                      | No key solely to mask #30                                                                     | `#30`      |
| `POST /admin/me/avatar/initiate`  | `InitiateAdminAvatarChangeCommand` / `InitiateAdminAvatarChangeCommandHandler` | None                                                   | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                  | Retry may return a fresh upload plan/proof                                                                                                                                               | No PostgreSQL mutation                                                                        | `#30`      |
| `POST /admin/me/email/initiate`   | `InitiateAdminEmailChangeCommand` / `InitiateAdminEmailChangeCommandHandler`   | Pending request + audit + delivery job                 | None                                    | None                              | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay                                                                                                                                                          | Email delivery remains at-least-once                                                          | —          |
| `POST /admin/me/email/confirm`    | `ConfirmAdminEmailChangeCommand` / `ConfirmAdminEmailChangeCommandHandler`     | Email change + notification + audit + durable jobs     | Replacement session after commit        | None                              | No                          | Yes                                                | Yes, #29: Pending             | Planned: same-key retry recognizes the committed PostgreSQL operation before re-consuming the proof; final `200` session/token replay remains #29-owned                                  | PostgreSQL identity and session/result replay integration deferred to #29                     | `#29`      |
| `PATCH /admin/me/password`        | `ChangeAdminPasswordCommand` / `ChangeAdminPasswordCommandHandler`             | Password/session-version change + audit + durable jobs | Replacement session after commit        | None                              | No                          | Yes                                                | Yes, #29: Pending             | Planned: same-key retry recognizes the committed password mutation before re-validating the now-stale current-password/session state; final `200` session/token replay remains #29-owned | PostgreSQL identity and session/result replay integration deferred to #29                     | `#29`      |
| `POST /admin/invite`              | `InviteAdminCommand` / `InviteAdminCommandHandler`                             | New pending admin + audit + invitation job             | None                                    | None                              | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay                                                                                                                                                          | Invitation email remains at-least-once                                                        | —          |
| `POST /admin/activation/initiate` | `InitiateAdminActivationCommand` / `InitiateAdminActivationCommandHandler`     | None                                                   | None                                    | S3 upload authorization / signing | No                          | Yes                                                | #30: Pending                  | Retry may return a fresh upload proof                                                                                                                                                    | No PostgreSQL mutation                                                                        | `#30`      |
| `POST /admin/activation/complete` | `ActivateAdminCommand` / `ActivateAdminCommandHandler`                         | Activation + audit + durable jobs                      | None                                    | S3 `HEAD` before transaction      | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay; replay skips expired proof and S3 revalidation                                                                                                          | S3 interaction is read-only in the request path; avatar lifecycle risk remains tracked by #30 | `#30`      |
| `POST /admin/:id/re-invite`       | `ReInviteAdminCommand` / `ReInviteAdminCommandHandler`                         | New invitation identity + audit + delivery job         | None                                    | None                              | No                          | Yes (same key)                                     | Yes                           | Implemented: keyed `204` replay                                                                                                                                                          | Invitation email remains at-least-once                                                        | —          |
| `POST /admin/:id/ban`             | `BanAdminCommand` / `BanAdminCommandHandler`                                   | Ban + audit + durable jobs                             | Best-effort version update after commit | None                              | Yes                         | Yes                                                | No, #29: Pending              | Repeated ban is already a no-op and returns `204`                                                                                                                                        | No additional key needed                                                                      | `#29`      |
| `POST /admin/:id/unban`           | `UnbanAdminCommand` / `UnbanAdminCommandHandler`                               | Unban + audit                                          | None                                    | None                              | Yes                         | Yes                                                | No                            | Repeated unban is already a no-op and returns `204`                                                                                                                                      | No additional key needed                                                                      | —          |
| `PUT /admin/:id/permissions`      | `ReplaceAdminPermissionsCommand` / `ReplaceAdminPermissionsCommandHandler`     | Permission-set replacement + audit + durable jobs      | Best-effort version update after commit | None                              | Yes                         | Yes                                                | No, #29: Pending              | Reapplying the same complete set is already a no-op and returns `204`                                                                                                                    | No additional key needed                                                                      | `#29`      |

### Job Queue Operations

| Endpoint                                   | Command / Handler                                                        | PostgreSQL mutation               | Redis mutation / effect | Current natural idempotency | Current HTTP mutation retry-safe | `Idempotency-Key` requirement | HTTP retry behavior (current / planned)                         | Current downstream safety / limitations                            | Tracked by |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------- | ----------------------- | --------------------------- | -------------------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| `POST /job-operations/dead-letter/redrive` | `StartDeadLetterRedriveCommand` / `StartDeadLetterRedriveCommandHandler` | pg-boss redrive operation + audit | None                    | No                          | Yes (same key)                   | Yes                           | Implemented: keyed `202` replay with the original `operationId` | Physical job IDs may change; logical `deliveryId` remains separate | —          |
| `POST /job-operations/dead-letter/discard` | `DiscardDeadLetterJobsCommand` / `DiscardDeadLetterJobsCommandHandler`   | Dead-letter deletion + audit      | None                    | Effect-idempotent           | Yes (same key)                   | Yes                           | Implemented: keyed `204` replay                                 | No consumer redrive occurs                                         | —          |

### Implemented request coordination

Twelve endpoints implement explicit idempotency; five further integrations await #29. Controllers build fixed-order canonical vectors from validated/transformed semantics, verified actors where applicable, and the matched method/versioned route template. UUID input case is preserved; discard IDs are sorted as a set.

`IIdempotencyPort` claims a global key on the primary using `INSERT ... ON CONFLICT DO NOTHING` under PostgreSQL's default READ COMMITTED isolation. Concurrent same-key callers wait for settlement: commit permits fingerprint comparison and replay (or `409`), rollback permits a new claim. Claim, mutation, success audit, jobs, and minimum replay identity commit atomically; failures are not retained. Refusal audit remains independently durable.

`executePrepared()` checks retained success before read-only proof/password/S3 preparation outside the transaction. Its final claim settles concurrent success even if preparation fails; otherwise the preparation error rolls back the claim. Prepared aggregates retain optimistic version checks.

`idempotency.operation` stores only `key`, HMAC `fingerprint`, `created_at`, and nullable `replay_result_id`. Only redrive uses a result ID (`operationId`); replay never checks or recreates its pg-boss job, whose status can expire independently. No generic response, raw payload, password, or token is persisted for replay.

Fingerprints use `IHashingPort.hmacSha256("idempotency-fingerprint", canonicalValue)`; reusable HMAC and shared `HASHING_KEY` validation/rotation: [Hashing](../agent/security-and-sessions.md#hashing). Idempotency owns no separate secret or crypto primitive.

A timeout, connection loss, or lost response after a write leaves the outcome unknown; it does not prove rollback. The server does not automatically retry; clients reuse the same key and semantics. Retention/cleanup is deferred to #3: no TTL or automatic deletion currently applies. Removing a row ends its replay guarantee and allows the key to be claimed again.

### Endpoint exceptions and dependencies

- Deletion replay skips aggregate loading, audit, jobs, and the immediate Redis version push. The first commit retains durable reconciliation; Redis recovery remains #29-owned. Self-deletion can invalidate credentials before retry reaches replay; user-deletion cache eviction still runs through the pipeline.
- Public activation resend retains missing/ineligible-account `204` no-ops; later account changes cannot turn a same-key retry into a new delivery.
- Logout-all replay confirms the original queued request, not consumer completion.
- Five integrations remain deferred to #29: user/admin email confirmation, user/admin password change, and user activation completion. Their fingerprints are designed; PostgreSQL identity and Redis/session result replay must be implemented together. Deletions are the implemented exception.

## Maintenance Rules

When a mutating production endpoint is added or changed:

1. Update its inventory row from actual controller, handler, persistence, Redis, durable-job, and external-effect behavior.
2. Classify HTTP mutation safety separately from downstream delivery safety.
3. For PostgreSQL mutations, also determine whether a committed success can be replayed with no or minimal stable metadata.
4. Require `Idempotency-Key` when mutation deduplication is needed or when success outcome certainty would otherwise be lost after a committed mutation.
5. Do not add a full response/result blob solely for replay.
6. Do not persist credentials, tokens, raw semantic payloads, or unkeyed secret digests for fingerprint/replay.
7. Do not infer queue exactly-once behavior from HTTP retry safety or same-key success replay.
8. Keep physical pg-boss job identity separate from logical `deliveryId`.
9. Record issue ownership independently for #29, #16, #30, and #3.
10. Revalidate the whole inventory whenever endpoint behavior, durable-job topology, replay semantics, or issue ownership changes.
