# Security & Sessions

## Cryptography & Tokens

- Use `IHashingPort` as the only application-facing password/digest capability: passwords use Argon2id and keyed digests use HMAC-SHA-256 with caller-owned canonicalization and purpose separation. Feature code must not own HMAC keys or digest primitives.
- Keep `HASHING_KEY` and JWT signing secrets independent, nonblank, at least 32 UTF-8 bytes, and consistent across instances. Key rotation must account for every retained digest or signed proof that still depends on the previous key.
- Use a dedicated signing secret and server-selected type discriminator for each token family. Pin HS256, verify the expected token type, and bypass expiry only where the workflow explicitly requires it.
- Keep signed proofs minimal. Never embed raw credentials, raw form payloads, or client-selected proof types.
- A valid signature is not sufficient authorization for a workflow proof. The owning use case/aggregate must still verify current eligibility, subject ownership, proof/request binding, expiry, and any revocation snapshot before mutation.
- When a proof is bound to submitted form data, derive the binding from canonical semantic fields with purpose-separated keyed hashing; do not hash whole commands or rely on unkeyed digests.

## Authentication & Authorization

- Run authentication before authorization. Every HTTP endpoint declares an explicit access policy; public endpoints skip authentication and therefore have no verified principal.
- Authorize with permissions, not roles. Permission values and their allowed principal holder are a static persisted contract; changing a persisted value requires migration. `PrincipalType` identifies the context owning the subject, not its authority.
- Access tokens carry the permission set used by authorization; authorization performs no additional permission-store read. Permission changes must therefore retire previously issued access tokens.
- Self-service endpoints derive their target from the verified principal. Actor-dependent domain rules receive a verified `Principal`, never raw HTTP/JWT objects or client-supplied actor identity.
- Credential login must resist account enumeration and timing distinctions: unknown, banned, passwordless, and wrong-password attempts expose the same credential refusal and perform comparable password-verification work. A pending user may receive an activation-required outcome only after correct password proof.
- Invalid access/refresh credentials remain authentication failures. Invalid invitation, activation, email-confirmation, or upload proofs are request-input failures after cryptographic verification; unrelated dependency/system failures must propagate unchanged.

## Protected Object Access

- Cache metadata or delivery configuration never grants authorization. Protected objects require access control and caching/delivery semantics compatible with access revocation.

## Administration

- User account deletion is owner-only; administrators cannot delete user accounts.
- Administrative hierarchy is an additional domain restriction, never a substitute for the operation permission required by the endpoint.
- An admin cannot administer itself; the root account cannot be administered; permission managers can be administered only by root. Only root may appoint or dismiss permission managers, and root authority cannot be granted through the normal API.
- Exactly one root account may exist. Root provisioning or transfer occurs outside ordinary administrative mutations and must preserve permission, session, and audit invariants atomically.
- Permission replacement is a full-set operation. An unchanged set is a no-op; a real change retires access tokens but does not revoke refresh credentials.
- Pending admins remain administrable, but self-service account mutations require completed activation.

## Sessions & Revocation

- Principal aggregates own two monotonic counters: `sessionVersion` is the access-token floor and version for newly opened sessions; `revocationVersion` is the refresh-token floor established by the latest full revocation.
- Permission changes advance only the access-token floor. Ban, deletion, password change, confirmed email change, refresh-reuse handling, and logout-all perform full revocation.
- Do not authenticate an access token from its signature alone. Before publishing verified identity, admission must also verify the named session is live and the token is not below the current access floor. Missing required state denies authentication; required session-store outages fail closed.
- Redis is an access-admission mirror, not the authoritative source for refresh revocation. Refresh eligibility uses persisted account revocation state. Session-version writes must never lower a floor or shorten protection below the affected credential lifetime.
- Do not return newly issued credentials until the session-store state required to validate them has been established. For mutation-driven token retirement/revocation, a best-effort Redis push is allowed only when durable reconciliation is already scheduled; never make a best-effort push the sole revocation mechanism.
- PostgreSQL and Redis security mutations are not atomic across stores. Design partial failure to remain safe and recoverable; never assume a mutation in one store rolls back with a failure in the other or that revocation becomes globally visible instantly.
- Session and rate-limit state are security-critical shared state, not cache. Do not introduce fail-open behavior, process-local fallback, or cache-style eviction semantics.
- Login/refresh request replay may reissue only the original still-live session for the same logical request. Replay must never revive closed, revoked, superseded, or expired state; reusing the request key for different semantic input must conflict.
- Refresh rotation has one winner. A replay detected inside the configured grace window is a conflict without family revocation; reuse outside that grace is treated as compromised-credential reuse and must durably record the follow-up full-revocation request and audit evidence before returning the authentication refusal.

## Email HTML

- Escape every dynamic HTML text or quoted attribute with `src/core/email`'s HTML escaping. Encode URL components before HTML escaping, accept only trusted HTTP(S) link bases, and do not introduce dynamic scripts or styles.

## Rate Limiting

- Every HTTP handler declares one explicit rate-limit policy or an explicit probe exemption. Policies are method-level; do not use class-level declarations or implicit fallback behavior.
- Preserve guard order: pre-auth rate limiting → authentication → post-auth rate limiting → authorization. Rate limiters must not authenticate credentials or publish verified identity.
- Principal-scoped budgets use only the verified principal identity. Target-based budgets must derive their tracker from the same validated/canonicalized value used by the workflow; invalid target input must fail rather than fall back to another tracker.
- Shared rate-limit budgets are identified independently of endpoint policy. Reuse the same budget identity when policies intentionally share quota; use a new identity when window or tracker semantics change.
- Treat sliding-window counts as admission estimates, not exact quotas or cooldown guarantees.
- Rate-limit storage is required distributed security state. Do not retry an ambiguous counter mutation, use process-local fallback, or fail open when storage is unavailable.
- A budget rejection returns 429 with `Retry-After`; recognized required-storage unavailability or timeout returns 503. Other failures preserve their normal exception semantics.
- Do not run incompatible rate-limit mappings concurrently during rollout; code and policy changes that alter shared counter semantics must be deployed coherently.
