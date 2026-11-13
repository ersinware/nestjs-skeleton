# Security & Sessions

### Hashing

- Use `IHashingPort` for Argon2id passwords and HMAC-SHA-256 generation/verification; features never own HMAC keys or digest primitives. Callers own canonical serialization and distinct purpose contexts; the port consumes text/bytes directly.
- Require a high-entropy `HASHING_KEY`: nonblank UTF-8 text, at least 32 bytes, independent of JWT secrets. Keep it identical across instances/restarts; rotation must preserve retained digest comparisons.

### Authentication & Authorization

- JWT signing disables automatic `iat`; signing and verification pin HS256; each token type uses its own secret and a verified type discriminator. Boot validation requires secrets of at least 32 UTF-8 bytes.
- Invalid access/refresh credentials remain unauthenticated; handlers translate invalid invitation, activation, email-confirmation, and upload proofs to invalid input, preserving `cause`. Catch only `UNAUTHENTICATED`; propagate other failures. Logout keeps its no-op semantics below.
- Domains own upload form canonicalization and expiry; handlers produce/verify `formHash` through `IHashingPort` using the upload purpose as context. Pass explicit form fields, never whole commands. Upload JWTs use the token port and `JWT_UPLOAD_SECRET`; never embed raw forms, credentials, or unkeyed password digests.
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
- Both principal kinds share `login.util.ts`. Fresh credential attempts use uniform `CREDENTIALS` refusals and one Argon2 verification per refusal; retained session replay skips password work. Unknown/banned/passwordless accounts use `simulatePasswordVerify` with a boot-generated, current-cost hash. Only a pending user with a correct password receives audited `session: activation_required`, without tokens or a session.

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
- Refresh-reuse notices use the job's event-time recipient address/name, even after account deletion.
- Repeated revocation requests advance counters again and may invalidate sessions opened after an earlier attempt.
- Full revocation leaves session/grace cleanup to TTL; account-wide sweeps can delete new logins.
- `openSession`/`rotateSession` take `IdempotencyRequest` first; check request replay before domain state and commit mutation plus HMAC-bound success atomically in Lua. Retain success for 300 seconds without renewal; conflicts return 409, failures retain nothing. Disable session offline queuing and unfulfilled-command resend; ambiguous mutations require same-key HTTP retry.
- Replay re-signs only the original live registration, preserving SID/JTI, versions, and registration deadlines; never revive closed, revoked, or superseded credentials. Preserve replay outcomes across pre-reads and mutations, distinct from first `OPENED`/`ROTATED` success; callers translate conflicts.
- Login/refresh pre-read replay once after identity checks, before credential preparation; never recheck on preparation failure/refusal. Mutation Lua settles competing successes; the pre-read does not wait. Login replay uses initial account eligibility/permissions and Redis version checks; refresh checks primary revocation against the winning version. Defer refresh credential expiry only for retained live replay; signature, type, claims, and absolute expiry remain mandatory.
- Session authority owns UUID v4 identities and registration deadlines; Lua uses server-supplied cryptographic entropy only for admitted mutations. Rotation preserves SID/absolute expiry and replaces JTI/bounded refresh expiry. Store SID fields in `auth:{type:id}:sessions` with `HSETEX` expiry at `refreshExpiresAt` (requires Redis 8+). Declare every Redis key in `KEYS`, sharing the complete `{type:id}` hash tag.
- Select absolute TTL through an exhaustive `PrincipalType` map. Return per-issuance access expiry capped by access TTL, refresh expiry, and absolute expiry; never persist it. Token signing preserves caller-supplied claims/expiry. Boot validation requires refresh TTL ≥ access TTL.
- Opening/rotation atomically check the account floor and write `SessionRegistration.sessionVersion`; reject versions below the floor. Replay requires the original current JTI and unexpired registration; rotation rejects missing/expired sessions.
- Single-session logout verifies refresh proof, allowing credential expiry within the absolute lifetime, then deletes the owner/kind/`sid` record regardless of JTI. It writes no audit record; invalid proofs are no-ops and unexpected errors propagate.
- Access admission atomically checks account floor and session liveness before publishing identity; it never renews TTL. Logout blocks subsequent admission, not already-admitted work. Legacy claims or key namespaces require reauthentication; retire incompatible instances during rollout.
- Redis mirrors only `sessionVersion`; refresh checks primary `revocationVersion`. Version writes never lower an existing floor or shorten its TTL, retained for at least the longer configured credential lifetime. Revocation bumps, never deletes; lost keys lose this protection.
- Access checks reject missing versions or tokens below the stored floor (401); replay/rotation also reject missing floors. Session opening and `setVersion()` may initialize missing floors. Recognized session availability failures become `DependencyUnavailableException` (503). Redis authentication/command/Lua and unknown errors propagate unchanged. Never substitute an accepting default or return login/refresh success after required session operations fail.
- Session registration/version and replay refusals return no tokens and produce no login audit; login keeps the uniform `CREDENTIALS` response; `LOGIN_SUCCESS` records only `OPENED`, never `REPLAYED`.
- User refresh requires activation; pending users receive the ordinary 401, not a login activation outcome. User self-service mutations require activation at the aggregate boundary.
- Public user registration must commit a pending account, its first activation job, and `USER_REGISTERED` audit atomically; never expose an unverified active-account creation path.
- User activation verifies the existing password without replacing it. The aggregate rechecks eligibility, expiry, and exact proof binding to the stored request identity, deadline, and revocation snapshot; the snapshot must match current revocation. Consume proof and audit in one optimistic-lock commit without advancing session counters.
- User activation, password change, and email confirmation return `204 No Content` without a response body or credentials after PostgreSQL commit. Only credential login opens sessions; refresh rotates existing ones. Same-key replay recognizes PostgreSQL success before proof/password preparation ([Request Idempotency](data-and-state.md#request-idempotency)). Clients discard old credentials and sign in; guard admission and asynchronous revocation propagation still apply.
- Audit user activation refusals for incorrect current passwords; invalid/expired proofs alone require no refusal audit. Preserve refusal kinds ([Exceptions](exceptions.md#exceptions)).
- After rate-limit admission, public user-activation resend returns 204 for eligible, missing, deleted, banned, and active accounts to prevent enumeration; audit committed requests. A three-day expiry leaves the account pending. Each accepted resend replaces the proof, invalidates earlier links, starts a new three-day deadline, and enqueues delivery; propagate concurrency and dependency failures.
- Audit workflow refusals caused by bans; keep public anti-enumeration responses and delivery/no-op skips unchanged.
- Password-change and email-change-request refusals audit incorrect current-password proof; unchanged proposed passwords are ordinary invalid input without audit.
- Banned accounts cannot change passwords (403). Password changes and email confirmations commit revocation counters and reconciliation jobs with the mutation and audit.
- Rotation accepts one winner; replay leaves the version key untouched. Within 1–60-second grace, await `REFRESH_CONCURRENT_REPLAY` audit and return 409 without revocation; timing does not prove legitimacy. Outside grace, atomically delete the Redis session, commit reuse audit and the revocation request together in PostgreSQL, then return 401; persistence failures propagate. Redis deletion and PostgreSQL persistence are not atomic. These refusal rules apply to new/different request keys; retained same-key success reissues the original live registration without rotation or remediation.
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
- Email confirmation requires an authenticated session whose account ID and principal kind match the proof; never make the endpoint public. Delivery retries preserve the JWT, deadline, and job-captured recipient name; signing-key rotation requires a new request.
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
- Principal budgets use the session-checked caller ID alone, never session/IP or request target IDs. Missing verified identity throws `SystemException`; no tracker fallback.
- Resolve target trackers before pipes without account lookup, matching workflow validation/normalization. Email body fields run pre-auth; route IDs post-auth. Invalid input fails at that counter; no fallback.
- Scope counters by environment, service, budget and tracker, independently of policy. Reuse shared limiter constants; reject conflicting definitions, duplicate budgets within a policy and public post-auth mappings at bootstrap.
- Sliding Window Counter estimates usage; it guarantees neither exact quotas nor cooldowns. Blocks start on rejection; blocked retries do not extend them.
- Apply counters in declared order; stop at the first rejection/failure without rolling back earlier consumption. Count requests reaching each counter regardless of workflow outcome; success never resets the budget.
- Keep counters in dedicated Redis; no offline queue, uncertain-mutation replay, local fallback or fail-open. Counter-operation timeout ends waiting, not execution; never retry the uncertain operation.
- Required storage availability/timeout/known OOM failures deny with 503; the first block denies with 429 and standard `Retry-After`. Preserve other failures ([Exceptions](exceptions.md#exceptions)). Technical rejections produce no audit or additional per-request reporting; HTTP access logging remains unchanged.
- Preserve counter state across compatible policy changes; window/tracker semantic changes require a new budget identity. Do not serve incompatible configurations concurrently or reset shared counters during deployment; rollback code and policy mappings together.
