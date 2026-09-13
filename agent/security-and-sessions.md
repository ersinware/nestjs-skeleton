# Security & Sessions

### Authentication & Authorization

- JWT signing and verification pin HS256; each token type uses its own secret and a verified type discriminator. Boot validation requires secrets of at least 32 UTF-8 bytes.
- Global guards run authentication before authorization; authentication verifies access JWTs and session versions ([Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics)). `@Public()` skips authentication and provides no verified principal.
- Authorize by permissions, never roles. `src/shared/domain/principal/` owns static `Permission` values and exhaustive `PERMISSION_HOLDER`; holder mismatches throw `InvalidInputException`. Use `<context>:<resource>:<action>` ([Administration](security-and-sessions.md#administration) exceptions); changing persisted values requires migration.
- Access tokens carry dynamic permission assignments; authorization uses verified claims without additional store reads.
- Every HTTP endpoint needs an explicit policy. `AuthPolicyModule` and both guards share a resolver; startup rejects missing/invalid policies with `SystemException`.
- `@Authenticated()` admits any authenticated principal; `@PrincipalOnly(...)` restricts caller kind, not ownership. Self endpoints derive target IDs from the verified principal. `@Permissions(...)` requires ALL class/method permissions; principal restrictions and permission holders must agree.
- Reject `Public` with any protection. `Authenticated` cannot accompany same-level restrictions or relax class restrictions; class-level `Authenticated` allows method restrictions.
- `PrincipalType` identifies the context owning `sub`, not authority. For actor-dependent business rules, pass verified `Principal` from `@CurrentPrincipal()` to commands, never HTTP/JWT objects. Audit context: [Audit](observability.md#audit).
- Both principal kinds share `login.util.ts` and uniform `CREDENTIALS` refusals. Each credential-login refusal performs one Argon2 verification; unknown/pending/banned accounts use `simulateVerify` with a boot-generated, current-cost hash.

### Administration

- Administrative mutators enforce `assertAdministrableBy` before changes/no-op returns. `PrincipalAggregateRoot` requires an ADMIN actor (`SystemException` otherwise), naming no concrete permission; `Admin` extends it with `super` first. `User` adds no administrative hierarchy; users may hold USER-assigned permissions ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)).
- Operation permissions remain required ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)); tiers never grant them implicitly. Admin administrative mutations forbid self/root targets; manager targets require root. Self/root/tier refusals throw `AccessDeniedException`. Ordinary targets require no actor tier beyond operation permissions. Self-service profile/password changes are separate.
- ROOT = `admin:root`; MANAGER = `admin:permission:manage`; others are ordinary. Only root may appoint/dismiss managers; root is never API-granted. The partial unique index permits at most one root.
- Bootstrap is unimplemented: provision the first root via SQL with admin-holdable permissions. Transfer root only through an atomic SQL operation preserving permission/session/audit rules; the root marker alone grants no operation permissions.
- `PUT …/:id/permission` replaces the full permission set. Unchanged sets cause no writes/events/audit/session updates; real changes audit `granted`/`revoked` ([Audit](observability.md#audit)) and retire access tokens only ([Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics)).

### Session Versions & Failure Semantics

- Owning aggregates alone advance DB counters: `sessionVersion` is the access floor/new-token version; `revocationVersion` is the refresh floor. Permission changes call `retireAccessTokens` (session only), preserving refresh with current permissions. Ban/delete/password/reuse/logout-all call `revokeAllSessions` (increment session, copy to revocation), invalidating earlier tokens subject to propagation below.
- Admin invites require a non-negative integer `revocationVersion` matching primary DB state. Re-invite persists `revokeAllSessions` before sending; senders re-read without bumping counters. Pending accounts need no Redis sync. Activation invalidates all invites by setting the password, without a counter bump.
- Auth requests owner revocation through events, never invents versions. Logout-all emits `LOGOUT_ALL_REQUESTED`; owner listeners dispatch revocation commands. `SessionRevocationReason` selects notices only ([Events & Messaging](events-and-messaging.md#events--messaging)).
- Full revocation leaves session/tombstone cleanup to TTL; account-wide sweeps can delete new logins. Single-session logout deletes only the presented refresh token's session.
- Redis mirrors only `sessionVersion`; refresh reads primary auth state and checks `revocationVersion`. Refresh revocation takes effect when the DB floor commits, not when its event is accepted. Version writes atomically take max and renew refresh-lifetime TTL; revocation bumps, never deletes. Max prevents regression only while the key survives.
- Access checks reject missing versions or tokens below the stored floor (401); recognized session availability failures become `DependencyUnavailableException` (503). Redis authentication/command/Lua and unknown errors propagate unchanged. Never substitute an accepting default or return login/refresh success after required session operations fail.
- Login atomically mirrors its version and opens its session; a newer Redis version yields an audited `CREDENTIALS` refusal without tokens.
- Self-service password handlers reject loaded banned accounts before password verification (403): a stale guard mirror must not permit fresh token issuance. Persist the password before issuing replacement tokens at the committed version; await atomic Redis version synchronization/session opening before returning them.
- Password-change outcomes both return 200: `session: created` includes fresh tokens; recognized session unavailability or a newer Redis version yields `session: login_required` without tokens, instructing clients to discard old tokens and sign in with the new password. Session failure does not undo the password change; unexpected errors propagate.
- Atomic refresh rotation accepts one winner and mirrors the monotonic-max session version with TTL renewal in the same operation; replay leaves the version key untouched. Replay within grace awaits `REFRESH_CONCURRENT_REPLAY` audit and returns 409 without revocation; timing does not prove legitimacy. Bound grace to 1–60 seconds. Outside grace returns 401 and requests full revocation.
- Revocation mirror pushes are best-effort; token issuance requires the awaited session operations above. Event reconciliation remains required even after successful synchronization: read current primary versions, including soft-deleted principals, and await writes with failures propagated ([Events & Messaging](events-and-messaging.md#events--messaging)). Neither reliable delivery nor max writes make DB/Redis revocation immediate or atomic; stale mirrors can admit old access tokens until synchronization or expiry.
- Use separate Redis stores: session with AOF, cache without. Missing versions deny access; persistence is not lossless revocation. Recovery must address lost keys and restored stale versions.

### Email HTML

- Apply `src/core/email`’s `escapeHtml` to all dynamic HTML text/quoted attributes, regardless of input validation; never to whole bodies. Links require trusted HTTP(S) URLs and URL-component encoding before HTML escaping. No dynamic scripts/styles.

### Rate Limiting

Unimplemented. Before changes, review `docs/issue/rate-limiting.md`; its proposals are not final. No isolated limiters, dependencies, or environment settings.
