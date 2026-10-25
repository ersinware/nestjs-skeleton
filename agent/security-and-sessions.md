# Security & Sessions

### Authentication & Authorization

- JWT signing disables automatic `iat`; signing and verification pin HS256; each token type uses its own secret and a verified type discriminator. Boot validation requires secrets of at least 32 UTF-8 bytes.
- Invalid access/refresh credentials remain unauthenticated; handlers translate invalid invitation, activation, email-confirmation, and upload proofs to invalid input, preserving `cause`. Catch only `UNAUTHENTICATED`; propagate other failures. Logout keeps its no-op semantics below.
- Upload tokens reuse the token port/adapter; domains own `formHash` computation/verification and expiry. Credential-containing bindings use a server-held key; never embed raw forms, credentials, or unkeyed password digests.
- Aggregates enforce revocation by comparing the signed proof snapshot with current account state; keep this rule out of form hashes and never substitute the current version for the snapshot.
- Each bounded context owns its upload-purpose enum with context-distinct values; use the same value for signing and verification. Core accepts strings; never take `expectedPurpose` from clients.
- Global guards run authentication before authorization; authentication verifies access JWTs, stable session liveness, and session versions ([Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics)). `@Public()` skips authentication and provides no verified principal.
- Authorize by permissions, never roles. `src/shared/domain/principal/` owns static `Permission` values and exhaustive `PERMISSION_HOLDER`; holder mismatches throw `InvalidInputException`. Use `<context>:<resource>:<action>` ([Administration](security-and-sessions.md#administration) exceptions); changing persisted values requires migration.
- Access tokens carry dynamic permission assignments; authorization uses verified claims without additional store reads.
- Every HTTP endpoint needs an explicit policy. `AuthPolicyModule` rejects missing/invalid policies with `SystemException` at startup; guards then read only request-time requirements.
- `@Authenticated()` admits any authenticated principal; `@PrincipalOnly(...)` restricts caller kind, not ownership. Self endpoints derive target IDs from the verified principal. `@Permissions(...)` requires ALL class/method permissions; principal restrictions and permission holders must agree.
- Reject `Public` with any protection. `Authenticated` cannot accompany same-level restrictions or relax class restrictions; class-level `Authenticated` allows method restrictions.
- `PrincipalType` identifies the context owning `sub`, not authority. For actor-dependent business rules, pass verified `Principal` from `@CurrentPrincipal()` to commands, never HTTP/JWT objects. Audit context: [Audit](observability.md#audit).
- Account activation and email confirmation receive verified claims for the target aggregate; a `sub` mismatch throws `SystemException`. Email confirmation handlers must reject session/token ownership mismatches before calling the aggregate.
- Admin self-service mutations require a password and avatar; missing either is a `SystemException`. Pending accounts remain administrable.
- Both principal kinds share `login.util.ts`. Credential checks use uniform `CREDENTIALS` refusals and one Argon2 verification per refusal. Unknown/banned/passwordless accounts use `simulateVerify` with a boot-generated, current-cost hash. Only a pending user with a correct password receives audited `session: activation_required`, without tokens or a session.

### Administration

- User account deletion is owner-only; admins cannot delete user accounts.
- Administrative mutators enforce `assertAdministrableBy` before changes/no-op returns. The shared principal guard requires an ADMIN actor (`SystemException` otherwise), naming no concrete permission; `Admin` extends it with `super` first. `User` adds no administrative hierarchy; users may hold USER-assigned permissions ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)).
- Operation permissions remain required ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)); tiers never grant them implicitly. Admin administrative mutations forbid self/root targets; manager targets require root. Self/root/tier refusals throw `AccessDeniedException` with domain audit action/reason ([Exceptions](exceptions.md#exceptions)). Ordinary targets require no actor tier beyond operation permissions. Self-service profile/password changes are separate.
- ROOT = `admin:root`; MANAGER = `admin:permission:manage`; others are ordinary. Only root may appoint/dismiss managers; root is never API-granted. The partial unique index permits at most one root.
- Bootstrap is unimplemented: provision the first root via SQL with admin-holdable permissions. Transfer root only through an atomic SQL operation preserving permission/session/audit rules; the root marker alone grants no operation permissions.
- `PUT …/:id/permissions` replaces the full permission set. Unchanged sets cause no writes/jobs/audit/session updates; real changes audit `granted`/`revoked` ([Audit](observability.md#audit)) and retire access tokens only ([Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics)).

### Session Versions & Failure Semantics

- Owning aggregates alone advance DB counters: `sessionVersion` is the access floor/new-token version; `revocationVersion` is the refresh floor. Permission changes call `retireAccessTokens` (session only), preserving refresh with current permissions. Ban/delete/password/email confirmation/reuse/logout-all call `revokeAllSessions` (increment session, copy to revocation), invalidating earlier tokens subject to propagation below.
- Auth requests owner revocation through shared Admin/User queue contracts, never invents versions. Logout-all and refresh reuse await the request commit, not completed revocation; preserve this distinction in API responses. Request/completion evidence: [Audit](observability.md#audit). `SessionRevocationReason` selects notices only.
- Repeated revocation requests advance counters again and may invalidate sessions opened after an earlier attempt.
- Full revocation leaves session/grace cleanup to TTL; account-wide sweeps can delete new logins.
- `generateTokens` creates a fresh UUID v4 `sid`; `refreshTokens` preserves `sid` and `sessionExpiresAt`, replacing `jti`. Never reopen an issued session. Session keys include principal kind; Lua keys share the principal hash tag.
- Select `SESSION_ABSOLUTE_TTL_ADMIN` / `SESSION_ABSOLUTE_TTL_USER` through an exhaustive `PrincipalType` map; cap both JWT expiries at the fixed session deadline and pass registration unchanged to Redis. Redis expires sessions at `refreshExpiresAt`; boot validation requires refresh TTL ≥ access TTL.
- Login/rotation atomically check the account floor and write `SessionRegistration.sessionVersion`; opening rejects existing records, rotation rejects missing/expired records. Lua trusts issued deadlines and rechecks stored expiry during rotation.
- Single-session logout verifies refresh proof, allowing credential expiry within the absolute lifetime, then deletes the owner/kind/`sid` record regardless of JTI. It writes no audit record; invalid proofs are no-ops and unexpected errors propagate.
- Access admission atomically checks account floor and session liveness before publishing identity; it never renews TTL. Logout blocks subsequent admission, not already-admitted work. Legacy claims require reauthentication; retire incompatible instances during rollout.
- Redis mirrors only `sessionVersion`; refresh checks primary `revocationVersion`. Version writes never lower an existing floor or shorten its TTL, retained for at least the longer configured credential lifetime. Revocation bumps, never deletes; lost keys lose this protection.
- Access checks reject missing versions or tokens below the stored floor (401); recognized session availability failures become `DependencyUnavailableException` (503). Redis authentication/command/Lua and unknown errors propagate unchanged. Never substitute an accepting default or return login/refresh success after required session operations fail.
- Rejected login registration yields an audited `CREDENTIALS` refusal without tokens.
- User refresh requires activation; pending users receive the ordinary 401, not a login activation outcome. User self-service mutations require activation at the aggregate boundary.
- Public user registration must commit a pending account, its first activation job, and `USER_REGISTERED` audit atomically; never expose an unverified active-account creation path.
- User activation verifies the existing password without replacing it. The aggregate rechecks eligibility, expiry, and exact proof binding to the stored request identity, deadline, and revocation snapshot; the snapshot must match current revocation. Consume proof and audit in one optimistic-lock commit without advancing session counters; replay must never open another session.
- Only after user activation commits, attempt session creation. Rejected session registration or recognized session unavailability returns `login_required` without tokens; unexpected errors propagate. Neither undoes activation; clients recover through login, never proof replay.
- Audit user activation refusals for incorrect current passwords; invalid/expired proofs alone require no refusal audit. Preserve refusal kinds ([Exceptions](exceptions.md#exceptions)).
- After rate-limit admission, public user-activation resend returns 204 for eligible, missing, deleted, banned, and active accounts to prevent enumeration; audit committed requests. A three-day expiry leaves the account pending. Each accepted resend replaces the proof, invalidates earlier links, starts a new three-day deadline, and enqueues delivery; propagate concurrency and dependency failures.
- Audit workflow refusals caused by bans; keep public anti-enumeration responses and delivery/no-op skips unchanged.
- Password-change and email-change-request refusals audit incorrect current-password proof; unchanged proposed passwords are ordinary invalid input without audit.
- Banned accounts cannot change passwords (403). A stale guard mirror must not permit fresh token issuance. Persist the password before issuing replacement tokens at the committed version; await atomic Redis version synchronization/session opening before returning them.
- Password-change and email-confirmation outcomes return 200: `session: created` includes fresh tokens; recognized session unavailability or a newer Redis version yields `session: login_required` without tokens, instructing clients to discard old tokens and sign in again. Session failure does not undo the committed change; unexpected errors propagate.
- Rotation accepts one winner; replay leaves the version key untouched. Within 1–60-second grace, await `REFRESH_CONCURRENT_REPLAY` audit and return 409 without revocation; timing does not prove legitimacy. Outside grace, atomically delete the Redis session, commit reuse audit and the revocation request together in PostgreSQL, then return 401; persistence failures propagate. Redis deletion and PostgreSQL persistence are not atomic. Never return the winning pair to a replaying credential; clients without it must reauthenticate.
- Revocation mirror pushes are best-effort; token issuance requires awaited synchronization. Session reconciliation consumers re-read current primary versions, including soft-deleted principals, and await Redis writes. DB/Redis updates are not atomic; stale mirrors can admit old access tokens until synchronization or expiry. Delivery limits: [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging).
- Use separate Redis stores: session with AOF, cache without. Recovery must address lost keys and restored stale sessions/versions.

### Admin Invitations

- Create the pending admin at invitation time so the account email unique constraint reserves the address. Activation completes that same account; re-invitation remains subject to account administration rules.
- Persist invitation metadata, never the JWT: UUID v4 `inviteId` (= job `deliveryId`), whole-second `inviteExpiresAt`, and `inviteRevocationVersion`. The aggregate owns the fixed three-day lifetime; no TTL configuration or handler-supplied timestamps. Metadata is all null or all populated for a passwordless account.
- `inviteRevocationVersion` captures the account's `revocationVersion` at issuance; never substitute the current version on delivery. Re-invite calls `revokeAllSessions` before replacing the invitation; pending accounts need no Redis sync. Persist state, job, and audit atomically ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- Senders re-read primary state and skip mismatched jobs, expired invitations, ineligible accounts, or changed revocation versions. Sign fixed `sub`, `jti`, `inviteRevocationVersion`, `exp`, and `type` in stable order. Repeated emails must carry the same JWT and deadline; keep the HS256 key and serialization identical across workers. Key rotation invalidates links and requires re-invitation.
- Delivery checks and upload proofs do not authorize activation: either can outlive account eligibility. Activation must independently recheck account eligibility, exact invitation binding, and expiry; save under the loaded optimistic version without advancing session counters. Cap upload URL/proof lifetimes at invitation expiry.
- Invalid invitation proofs alone require no refusal audit; preserve refusal kinds instead of flattening them into one invalid-input response ([Exceptions](exceptions.md#exceptions)).

### Email Change State

- Profile updates must not change login email. Email-change requests require current-password proof; reject mismatches before returning target-address conflicts.
- Confirmation pages must not mutate on GET or expose tokens to third-party scripts/analytics. Use `Referrer-Policy: no-referrer` and remove the token from the address bar after capture.
- Aggregates own pending request identity, target, expiry, and revocation snapshot; persist no JWT or issuance time. New requests replace prior requests, even for the same target; pending addresses are not reserved.
- Email confirmation requires an authenticated session whose account ID and principal kind match the proof; never make the endpoint public. Delivery retries must preserve the JWT and deadline; signing-key rotation requires a new request.
- Audit confirmation refusals for verified-proof ownership mismatches; invalid/expired proofs or pending requests alone require no refusal audit. Ownership-mismatch evidence identifies the proof owner with `targetId` and `detail.targetPrincipalType`; equal IDs across principal kinds are distinct accounts. Preserve refusal kinds ([Exceptions](exceptions.md#exceptions)).
- Ineligible confirmation deliveries complete without sending or refusal audits; confirmation must independently recheck current account and request state.
- Keep the current email and sessions until confirmation. Confirmation consumes the matching, unexpired request at the current revocation version and revokes sessions; the email unique constraint resolves address conflicts.
- Old-address notifications use immutable `email_change_notification` records, never the account's current email. Preserve recipients across later changes/deletion.
- Persist the notification record with the email mutation, jobs, and audit ([Audit](observability.md#audit)).

### Email HTML

- Apply `src/core/email`’s `escapeHtml` to all dynamic HTML text/quoted attributes, regardless of input validation; never to whole bodies. Links require trusted HTTP(S) URLs and URL-component encoding before HTML escaping. No dynamic scripts/styles.

### Rate Limiting

- Use an explicit central policy on each HTTP handler, including `default`, or a probe exemption. No class-level declarations, implicit fallback, or automatic default-policy stacking.
- Preserve guard order: pre-auth rate limit → authentication → post-auth rate limit → authorization. Only authentication publishes verified identity; limiters never decode/verify credentials or publish audit actors.
- Principal budgets use the session-checked caller ID alone, never session/IP or request target IDs. Reject public mappings at startup and missing verified identity with `SystemException`; no tracker fallback.
- Derive target-account trackers without account lookup, matching the owning workflow's field validation and normalization. Missing/invalid tracker input fails at that counter; never skip it or fall back to IP.
- Apply counters in declared order; stop at the first rejection/failure without rolling back earlier consumption. Count requests reaching each counter regardless of workflow outcome; success never resets the budget.
- Keep counters in dedicated Redis; no offline queue, uncertain-mutation replay, local fallback or fail-open. Counter-operation timeout ends waiting, not execution; never retry the uncertain operation.
- Required storage availability/timeout/known OOM failures deny with 503; the first block denies with 429 and standard `Retry-After`. Preserve other failures ([Exceptions](exceptions.md#exceptions)). Technical rejections produce no audit or additional per-request reporting; HTTP access logging remains unchanged.
- Preserve counter state across compatible policy changes; window/tracker semantic changes require a new limiter identity. Do not serve incompatible configurations concurrently or reset shared counters during deployment; rollback code and policy mappings together.
