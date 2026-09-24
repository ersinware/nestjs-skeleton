# Security & Sessions

### Authentication & Authorization

- JWT signing disables automatic `iat`; signing and verification pin HS256; each token type uses its own secret and a verified type discriminator. Boot validation requires secrets of at least 32 UTF-8 bytes.
- Global guards run authentication before authorization; authentication verifies access JWTs, stable session liveness, and session versions ([Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics)). `@Public()` skips authentication and provides no verified principal.
- Authorize by permissions, never roles. `src/shared/domain/principal/` owns static `Permission` values and exhaustive `PERMISSION_HOLDER`; holder mismatches throw `InvalidInputException`. Use `<context>:<resource>:<action>` ([Administration](security-and-sessions.md#administration) exceptions); changing persisted values requires migration.
- Access tokens carry dynamic permission assignments; authorization uses verified claims without additional store reads.
- Every HTTP endpoint needs an explicit policy. `AuthPolicyModule` rejects missing/invalid policies with `SystemException` at startup; guards then read only request-time requirements.
- `@Authenticated()` admits any authenticated principal; `@PrincipalOnly(...)` restricts caller kind, not ownership. Self endpoints derive target IDs from the verified principal. `@Permissions(...)` requires ALL class/method permissions; principal restrictions and permission holders must agree.
- Reject `Public` with any protection. `Authenticated` cannot accompany same-level restrictions or relax class restrictions; class-level `Authenticated` allows method restrictions.
- `PrincipalType` identifies the context owning `sub`, not authority. For actor-dependent business rules, pass verified `Principal` from `@CurrentPrincipal()` to commands, never HTTP/JWT objects. Audit context: [Audit](observability.md#audit).
- Invitation activation and email confirmation receive verified claims for the target aggregate; a `sub` mismatch throws `SystemException`. Email confirmation handlers must reject session/token ownership mismatches before calling the aggregate.
- Admin self-service mutations require activation; reaching them with a null password is a `SystemException`.
- Both principal kinds share `login.util.ts` and uniform `CREDENTIALS` refusals. Each credential-login refusal performs one Argon2 verification; unknown/pending/banned accounts use `simulateVerify` with a boot-generated, current-cost hash.

### Administration

- Administrative mutators enforce `assertAdministrableBy` before changes/no-op returns. The shared principal guard requires an ADMIN actor (`SystemException` otherwise), naming no concrete permission; `Admin` extends it with `super` first. `User` adds no administrative hierarchy; users may hold USER-assigned permissions ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)).
- Operation permissions remain required ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)); tiers never grant them implicitly. Admin administrative mutations forbid self/root targets; manager targets require root. Self/root/tier refusals throw `AccessDeniedException`. Ordinary targets require no actor tier beyond operation permissions. Self-service profile/password changes are separate.
- ROOT = `admin:root`; MANAGER = `admin:permission:manage`; others are ordinary. Only root may appoint/dismiss managers; root is never API-granted. The partial unique index permits at most one root.
- Bootstrap is unimplemented: provision the first root via SQL with admin-holdable permissions. Transfer root only through an atomic SQL operation preserving permission/session/audit rules; the root marker alone grants no operation permissions.
- `PUT …/:id/permission` replaces the full permission set. Unchanged sets cause no writes/jobs/audit/session updates; real changes audit `granted`/`revoked` ([Audit](observability.md#audit)) and retire access tokens only ([Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics)).

### Session Versions & Failure Semantics

- Owning aggregates alone advance DB counters: `sessionVersion` is the access floor/new-token version; `revocationVersion` is the refresh floor. Permission changes call `retireAccessTokens` (session only), preserving refresh with current permissions. Ban/delete/password/email confirmation/reuse/logout-all call `revokeAllSessions` (increment session, copy to revocation), invalidating earlier tokens subject to propagation below.
- Target flow: Auth requests owner revocation through shared Admin/User queue contracts, never invents versions; owner consumers dispatch revocation commands. Logout-all and refresh reuse each commit their job and producer-owned audit together; callers await commit, not revocation. `SessionRevocationReason` selects notices only ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- Repeated revocation requests advance counters again and may invalidate sessions opened after an earlier attempt.
- Full revocation leaves session/grace cleanup to TTL; account-wide sweeps can delete new logins.
- `generateTokens` creates a fresh UUID v4 `sid`; `refreshTokens` preserves `sid` and `sessionExpiresAt`, replacing `jti`. Never reopen an issued session. Session keys include principal kind; Lua keys share the principal hash tag.
- Select `SESSION_ABSOLUTE_TTL_ADMIN` / `SESSION_ABSOLUTE_TTL_USER` through an exhaustive `PrincipalType` map; cap both JWT expiries at the fixed session deadline and pass registration unchanged to Redis. Redis expires sessions at `refreshExpiresAt`; boot validation requires refresh TTL ≥ access TTL.
- Login/rotation atomically check the account floor and write `SessionRegistration.sessionVersion`; opening rejects existing records, rotation rejects missing/expired records. Lua trusts issued deadlines and rechecks stored expiry during rotation.
- Single-session logout verifies refresh proof, allowing credential expiry within the absolute lifetime, then deletes the owner/kind/`sid` record regardless of JTI. Invalid proofs are no-ops without audit identity; unexpected errors propagate.
- Access admission atomically checks account floor and session liveness before publishing identity; it never renews TTL. Logout blocks subsequent admission, not already-admitted work. Legacy claims require reauthentication; retire incompatible instances during rollout.
- Redis mirrors only `sessionVersion`; refresh checks primary `revocationVersion`. Version writes never lower an existing floor or shorten its TTL, retained for at least the longer configured credential lifetime. Revocation bumps, never deletes; lost keys lose this protection.
- Access checks reject missing versions or tokens below the stored floor (401); recognized session availability failures become `DependencyUnavailableException` (503). Redis authentication/command/Lua and unknown errors propagate unchanged. Never substitute an accepting default or return login/refresh success after required session operations fail.
- Rejected login registration yields an audited `CREDENTIALS` refusal without tokens.
- Self-service password handlers reject loaded banned accounts before password verification (403); aggregates independently reject bans before mutation. A stale guard mirror must not permit fresh token issuance. Persist the password before issuing replacement tokens at the committed version; await atomic Redis version synchronization/session opening before returning them.
- Password-change outcomes both return 200: `session: created` includes fresh tokens; recognized session unavailability or a newer Redis version yields `session: login_required` without tokens, instructing clients to discard old tokens and sign in with the new password. Session failure does not undo the password change; unexpected errors propagate.
- Rotation accepts one winner; replay leaves the version key untouched. Within 1–60-second grace, await `REFRESH_CONCURRENT_REPLAY` audit and return 409 without revocation; timing does not prove legitimacy. Outside grace, atomically delete the Redis session, commit reuse audit and the revocation request together in PostgreSQL, then return 401; persistence failures propagate. Redis deletion and PostgreSQL persistence are not atomic. Never return the winning pair to a replaying credential; clients without it must reauthenticate.
- Revocation mirror pushes are best-effort; token issuance requires awaited synchronization. Session reconciliation consumers re-read current primary versions, including soft-deleted principals, and await Redis writes. DB/Redis updates are not atomic; stale mirrors can admit old access tokens until synchronization or expiry. Delivery limits: [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging).
- Use separate Redis stores: session with AOF, cache without. Recovery must address lost keys and restored stale sessions/versions.

### Admin Invitations

- Persist invitation metadata, never the JWT: UUID v4 `inviteId` (= job `deliveryId`), whole-second `inviteExpiresAt`, and `inviteRevocationVersion`. The aggregate owns the fixed three-day lifetime; no TTL configuration or handler-supplied timestamps. Metadata is all null or all populated for a passwordless account.
- `inviteRevocationVersion` captures the account's `revocationVersion` at issuance; never substitute the current version on delivery. Re-invite calls `revokeAllSessions` before replacing the invitation; pending accounts need no Redis sync. Persist state, job, and audit atomically ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- Senders re-read primary state and skip mismatched jobs, expired invitations, ineligible accounts, or changed revocation versions. Sign fixed `sub`, `jti`, `inviteRevocationVersion`, `exp`, and `type` in stable order. Repeated emails must carry the same JWT and deadline; keep the HS256 key and serialization identical across workers. Key rotation invalidates links and requires re-invitation.
- Activation handlers verify the JWT, load from primary, and hash the password. The aggregate checks account eligibility, exact invitation binding, and expiry before setting the password and clearing metadata; persistence uses the optimistic lock without a counter bump.
- Every expected activation refusal is audited and translated to one `InvalidInputException` message. Token and missing-account reasons belong to the handler; aggregate reasons stay private and reach it through `auditReason` ([Exceptions](exceptions.md#exceptions)). Unmarked aggregate errors propagate unchanged.

### Email Change State

- Verify the current password before checking target-email availability or creating an email change request.
- Confirmation pages must not mutate on GET or expose tokens to third-party scripts/analytics. Use `Referrer-Policy: no-referrer` and remove the token from the address bar after capture.
- Aggregates own pending request identity, target, expiry, and revocation snapshot; persist no JWT or issuance time. New requests replace prior requests, even for the same target; pending addresses are not reserved.
- Email confirmation proofs must match both account ID and principal kind; JWT verification alone does not authorize the change. Retries must preserve the JWT and deadline; signing-key rotation requires a new request.
- Ineligible confirmation deliveries complete without sending or refusal audits; confirmation must independently recheck current account and request state.
- Keep the current email and sessions until confirmation. Confirmation consumes the matching, unexpired request at the current revocation version and revokes sessions; the email unique constraint resolves address conflicts.
- Old-address notifications use immutable `email_change_notification` records, never the account's current email. Preserve recipients across later changes/deletion; delivery must match both record and account identity.
- Persist the notification record with the email mutation, jobs, and audit ([Audit](observability.md#audit)).

### Email HTML

- Apply `src/core/email`’s `escapeHtml` to all dynamic HTML text/quoted attributes, regardless of input validation; never to whole bodies. Links require trusted HTTP(S) URLs and URL-component encoding before HTML escaping. No dynamic scripts/styles.

### Rate Limiting

Unimplemented. Before changes, review `docs/issue/rate-limiting.md`; its proposals are not final. No isolated limiters, dependencies, or environment settings.
