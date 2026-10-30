# Idempotency and Retry-Safety Inventory

## Purpose

This document is the living inventory of production HTTP mutation endpoints and their idempotency / retry-safety characteristics.

Update it whenever a mutating production endpoint is added, removed, or changes behavior.

## Issue Ownership

- **#18** — HTTP → PostgreSQL idempotency and ambiguous outcomes.
- **#29** — HTTP → Redis idempotency and ambiguous outcomes.
- **#16** — Redis mutation → mandatory PostgreSQL / pg-boss durable follow-up.
- **#28** — Queue consumer transaction, retry, and deduplication safety.

An endpoint may be tracked by more than one issue when it crosses more than one boundary.

## Classification

### Naturally idempotent

Repeating the same logical request leaves the authoritative state equivalent to applying it once.

### Retry-safe

Repeating the same logical request does not apply the same business mutation or effect more than once, even if the retry may return a different response.

### Explicit idempotency required

Repeating the same logical request can create another valid mutation, delivery, job, operation, or other business effect and therefore requires request-level idempotency protection.

## Inventory

### Auth

| Endpoint                 | Command / Handler                                      | PostgreSQL mutation                       | Redis mutation / effect  | Natural idempotency | Retry-safe                 | Explicit `Idempotency-Key` | Replay / retry behavior                                    | Tracked by   |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------- | ------------------------ | ------------------- | -------------------------- | -------------------------- | ---------------------------------------------------------- | ------------ |
| `POST /auth/user/login`  | `LoginUserCommand` / `LoginUserCommandHandler`         | Login audit                               | Session open             | No                  | No                         | No                         | A retry may create a new session                           | `#29`        |
| `POST /auth/admin/login` | `LoginAdminCommand` / `LoginAdminCommandHandler`       | Login audit                               | Session open             | No                  | No                         | No                         | A retry may create a new session                           | `#29`        |
| `POST /auth/refresh`     | `RefreshTokensCommand` / `RefreshTokensCommandHandler` | On reuse: audit + pg-boss remediation job | Token rotation           | No                  | Depends on Redis semantics | No                         | Existing refresh replay / reuse semantics apply            | `#29`, `#16` |
| `POST /auth/logout`      | `LogoutCommand` / `LogoutCommandHandler`               | None                                      | Session delete           | Yes                 | Yes                        | No                         | Repeated close is safe; response remains `204`             | `#29`        |
| `POST /auth/logout-all`  | `LogoutAllCommand` / `LogoutAllCommandHandler`         | Audit + pg-boss revocation job            | None in the request path | No                  | No                         | **Yes**                    | Same key replays `204` without another revocation delivery | `#18`        |

### User

| Endpoint                           | Command / Handler                                                            | PostgreSQL mutation                                              | Redis mutation / effect                  | Other external effect             | Natural idempotency | Retry-safe | Explicit `Idempotency-Key` | Replay / retry behavior                                                                 | Tracked by   |
| ---------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- | --------------------------------- | ------------------- | ---------- | -------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `DELETE /user/me`                  | `DeleteUserCommand` / `DeleteUserCommandHandler`                             | Soft delete + audit + durable jobs                               | Best-effort version update after commit  | None                              | State-idempotent    | Yes        | No                         | A later retry may return `404`; duplicate mutation is not applied                       | `#18`, `#29` |
| `PATCH /user/me`                   | `UpdateUserCommand` / `UpdateUserCommandHandler`                             | Profile / avatar state + audit + durable jobs                    | None                                     | S3 `HEAD` read before transaction | Partially           | Yes        | No                         | Name replay becomes a no-op; consumed avatar proof cannot apply twice                   | `#18`        |
| `POST /user/me/avatar/initiate`    | `InitiateUserAvatarChangeCommand` / `InitiateUserAvatarChangeCommandHandler` | None                                                             | None                                     | S3 upload authorization / signing | No                  | Yes        | No                         | Retry may return a fresh upload plan / proof; no business mutation is duplicated        | —            |
| `POST /user/me/email/initiate`     | `InitiateUserEmailChangeCommand` / `InitiateUserEmailChangeCommandHandler`   | Pending email request + audit + email delivery job               | None                                     | None                              | No                  | No         | **Yes**                    | Same key replays `204`; no replacement pending request or duplicate delivery is created | `#18`        |
| `POST /user/me/email/confirm`      | `ConfirmUserEmailChangeCommand` / `ConfirmUserEmailChangeCommandHandler`     | Email change + immutable notification row + audit + durable jobs | Replacement session attempt after commit | None                              | No                  | Yes        | No                         | Proof is consumed by committed state; the same mutation cannot be applied again         | `#18`, `#29` |
| `PATCH /user/me/password`          | `ChangeUserPasswordCommand` / `ChangeUserPasswordCommandHandler`             | Password / session-version change + audit + durable jobs         | Replacement session attempt after commit | None                              | No                  | Yes        | No                         | Previous current-password proof becomes invalid; mutation cannot apply twice            | `#18`, `#29` |
| `POST /user/registration/initiate` | `InitiateUserRegistrationCommand` / `InitiateUserRegistrationCommandHandler` | None; primary email availability read only                       | None                                     | S3 upload authorization / signing | No                  | Yes        | No                         | Retry may return a fresh registration / upload identity; no account is created          | —            |
| `POST /user/registration/complete` | `RegisterUserCommand` / `RegisterUserCommandHandler`                         | User insert + audit + durable jobs                               | None                                     | S3 `HEAD` read before transaction | No                  | Yes        | No                         | Existing identity / email uniqueness prevents a second account commit                   | `#18`        |
| `POST /user/activation/complete`   | `ActivateUserCommand` / `ActivateUserCommandHandler`                         | Activation + audit + durable jobs                                | Replacement session attempt after commit | None                              | No                  | Yes        | No                         | Already-active state prevents a second activation                                       | `#18`, `#29` |
| `POST /user/activation/resend`     | `ResendUserActivationCommand` / `ResendUserActivationCommandHandler`         | New activation identity + audit + delivery job                   | None                                     | None                              | No                  | No         | **Yes**                    | Same key replays `204`; no second activation identity / delivery is created             | `#18`        |
| `POST /user/:id/ban`               | `BanUserCommand` / `BanUserCommandHandler`                                   | Ban + audit + durable jobs                                       | Best-effort version update after commit  | None                              | Yes                 | Yes        | No                         | Repeated ban is a no-op and returns `204`                                               | `#18`, `#29` |
| `POST /user/:id/unban`             | `UnbanUserCommand` / `UnbanUserCommandHandler`                               | Unban + audit                                                    | None                                     | None                              | Yes                 | Yes        | No                         | Repeated unban is a no-op and returns `204`                                             | `#18`        |
| `PUT /user/:id/permissions`        | `ReplaceUserPermissionsCommand` / `ReplaceUserPermissionsCommandHandler`     | Permission-set replacement + audit + durable jobs                | Best-effort version update after commit  | None                              | Yes                 | Yes        | No                         | Reapplying the same complete set is a no-op and returns `204`                           | `#18`, `#29` |

### Admin

| Endpoint                          | Command / Handler                                                              | PostgreSQL mutation                                              | Redis mutation / effect                  | Other external effect             | Natural idempotency | Retry-safe | Explicit `Idempotency-Key` | Replay / retry behavior                                                                 | Tracked by   |
| --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------- | --------------------------------- | ------------------- | ---------- | -------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `DELETE /admin/:id`               | `DeleteAdminCommand` / `DeleteAdminCommandHandler`                             | Soft delete + audit + durable jobs                               | Best-effort version update after commit  | None                              | State-idempotent    | Yes        | No                         | A later retry may return `404`; duplicate mutation is not applied                       | `#18`, `#29` |
| `PATCH /admin/me`                 | `UpdateAdminCommand` / `UpdateAdminCommandHandler`                             | Profile / avatar state + audit + durable jobs                    | None                                     | S3 `HEAD` read before transaction | Partially           | Yes        | No                         | Name replay becomes a no-op; consumed avatar proof cannot apply twice                   | `#18`        |
| `POST /admin/me/avatar/initiate`  | `InitiateAdminAvatarChangeCommand` / `InitiateAdminAvatarChangeCommandHandler` | None                                                             | None                                     | S3 upload authorization / signing | No                  | Yes        | No                         | Retry may return a fresh upload plan / proof; no business mutation is duplicated        | —            |
| `POST /admin/me/email/initiate`   | `InitiateAdminEmailChangeCommand` / `InitiateAdminEmailChangeCommandHandler`   | Pending email request + audit + email delivery job               | None                                     | None                              | No                  | No         | **Yes**                    | Same key replays `204`; no replacement pending request or duplicate delivery is created | `#18`        |
| `POST /admin/me/email/confirm`    | `ConfirmAdminEmailChangeCommand` / `ConfirmAdminEmailChangeCommandHandler`     | Email change + immutable notification row + audit + durable jobs | Replacement session attempt after commit | None                              | No                  | Yes        | No                         | Proof is consumed by committed state; the same mutation cannot be applied again         | `#18`, `#29` |
| `PATCH /admin/me/password`        | `ChangeAdminPasswordCommand` / `ChangeAdminPasswordCommandHandler`             | Password / session-version change + audit + durable jobs         | Replacement session attempt after commit | None                              | No                  | Yes        | No                         | Previous current-password proof becomes invalid; mutation cannot apply twice            | `#18`, `#29` |
| `POST /admin/invite`              | `InviteAdminCommand` / `InviteAdminCommandHandler`                             | New pending admin + audit + invitation job                       | None                                     | None                              | No                  | Yes        | No                         | Email uniqueness prevents a second admin creation for the same logical invite           | `#18`        |
| `POST /admin/activation/initiate` | `InitiateAdminActivationCommand` / `InitiateAdminActivationCommandHandler`     | None                                                             | None                                     | S3 upload authorization / signing | No                  | Yes        | No                         | Retry may return a fresh upload proof; no account mutation is duplicated                | —            |
| `POST /admin/activation/complete` | `ActivateAdminCommand` / `ActivateAdminCommandHandler`                         | Activation + audit + durable jobs                                | None                                     | S3 `HEAD` read before transaction | No                  | Yes        | No                         | Already-active state prevents a second activation                                       | `#18`        |
| `POST /admin/:id/re-invite`       | `ReInviteAdminCommand` / `ReInviteAdminCommandHandler`                         | New invitation identity + audit + delivery job                   | None                                     | None                              | No                  | No         | **Yes**                    | Same key replays `204`; no second invitation / delivery is created                      | `#18`        |
| `POST /admin/:id/ban`             | `BanAdminCommand` / `BanAdminCommandHandler`                                   | Ban + audit + durable jobs                                       | Best-effort version update after commit  | None                              | Yes                 | Yes        | No                         | Repeated ban is a no-op and returns `204`                                               | `#18`, `#29` |
| `POST /admin/:id/unban`           | `UnbanAdminCommand` / `UnbanAdminCommandHandler`                               | Unban + audit                                                    | None                                     | None                              | Yes                 | Yes        | No                         | Repeated unban is a no-op and returns `204`                                             | `#18`        |
| `PUT /admin/:id/permissions`      | `ReplaceAdminPermissionsCommand` / `ReplaceAdminPermissionsCommandHandler`     | Permission-set replacement + audit + durable jobs                | Best-effort version update after commit  | None                              | Yes                 | Yes        | No                         | Reapplying the same complete set is a no-op and returns `204`                           | `#18`, `#29` |

### Job Queue Operations

| Endpoint                                   | Command / Handler                                                        | PostgreSQL mutation               | Redis mutation / effect | Natural idempotency | Retry-safe | Explicit `Idempotency-Key` | Replay / retry behavior                                                       | Tracked by |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------- | ----------------------- | ------------------- | ---------- | -------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `POST /job-operations/dead-letter/redrive` | `StartDeadLetterRedriveCommand` / `StartDeadLetterRedriveCommandHandler` | pg-boss redrive operation + audit | None                    | No                  | No         | **Yes**                    | Same key replays `202 Accepted` and returns the original operation identifier | `#18`      |
| `POST /job-operations/dead-letter/discard` | `DiscardDeadLetterJobsCommand` / `DiscardDeadLetterJobsCommandHandler`   | Dead-letter deletion + audit      | None                    | Effect-idempotent   | Yes        | No                         | A later retry may return `404`; the same jobs cannot be discarded twice       | `#18`      |

## Maintenance Rules

When a mutating production endpoint is added or changed:

1. Add or update its inventory row.
2. Inspect its actual command, handler, database writes, Redis mutations, durable jobs, and external effects.
3. Classify its idempotency and retry-safety behavior from implementation semantics, not from the HTTP method alone.
4. Record any required request-level idempotency protection.
5. Record the issue responsible for the identified concern:
    - `#18` for HTTP → PostgreSQL.
    - `#29` for HTTP → Redis.
    - `#16` for Redis → mandatory PostgreSQL / pg-boss follow-up.
    - `#28` for queue consumer retry / transaction safety when applicable.
6. Update this document when the endpoint behavior or issue ownership changes.
