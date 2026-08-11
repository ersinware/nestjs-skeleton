# Known Vulnerability: Session Version Fail-Open

**Status:** Deliberately deferred — not fixed.
**Found:** 2026-07-19, during the exception & observability audit.
**Impact:** Instant session termination after a ban/password change may silently not apply within a
narrow window.
**Urgency:** Low — exposure ≤ `JWT_ACCESS_TTL` (default 15min) and the refresh path is unaffected.

---

## 1. The problem

`getVersion` returns `0` when the key is missing from the cache:

```ts
// src/core/security/session/adapter.ts
async getVersion(id: string): Promise<number> {
    const value = await this.redis.get(`version:${id}`);
    return value ? Number(value) : 0;
}
```

`AuthGuard` uses that value like this:

```ts
// src/core/security/auth/guard/auth.guard.ts
if (payload.version < currentVersion) {
    throw new UnauthenticatedException();
}
```

When `currentVersion === 0` this condition can **never** hold — every token is accepted.

### Root cause: absence is ambiguous

A missing key expresses two entirely different situations, and they cannot be told apart:

| Situation          | Meaning                                          | Correct behavior |
| ------------------ | ------------------------------------------------ | ---------------- |
| Never written      | The user's version never advanced (the majority) | Accept           |
| Written, then lost | A ban was applied but Redis holds no trace of it | **Reject**       |

There is no way to make this distinction from inside the cache. The answer must come from outside
it.

### Scenario

1. `redis-session` is unreachable
2. An admin is banned → `version` is incremented in the DB, `save()` succeeds
3. `sessionPort.setVersion(...)` fails → the handler's `catch` only logs
4. `AdminSessionListener` tries to write to the same Redis at the same time → it fails too
5. Redis comes back — **the `version:` key does not exist, and nobody retries**
6. The banned user's access token stays valid until it expires

Affected `catch` blocks (all around `setVersion`, same pattern):

- `module/admin/application/command/ban-admin/handler.ts`
- `module/admin/application/command/delete-admin/handler.ts`
- `module/admin/application/command/revoke-admin-sessions/handler.ts`
- `module/user/application/command/ban-user/handler.ts`
- `module/user/application/command/delete-user/handler.ts`
- `module/user/application/command/change-user-password/handler.ts`
- `module/user/application/command/revoke-user-sessions/handler.ts`

---

## 2. Factors limiting the risk

Protections that **already exist** in the design and lower the severity:

**The refresh path is unaffected.** `refresh-tokens/handler.ts` reads both `isBanned` and `version`
**from the database**. A banned user cannot refresh; the session terminates for good when the access
token expires.

**Exposure is bounded by the access-token lifetime.** `JWT_ACCESS_TTL=15m`. The failure mode is not
"no security" but **"standard JWT semantics"** — instant eviction is an optimization; when it is
lost, the system falls back to JWT's natural behavior (wait for expiry).

**It cannot be lost to eviction.** The `version:*` keys live in `redis-session`; that instance has
no `maxmemory` configured, so the policy is `noeviction`. They cannot be dropped under memory
pressure.

```yaml
# docker-compose.yml
redis-cache: --maxmemory 100mb --maxmemory-policy allkeys-lru # no volume
redis-session: --save 60 1 # redis_session_data volume
```

**It survives restarts.** RDB persistence + a named volume are in place.

### The real vectors that remain

1. **A ban applied exactly while Redis is unreachable** — both the handler and the listener fail,
   and nobody retries
2. **`--save 60 1`** — a hard crash loses the last 60 seconds of writes

---

## 3. Solution options

### A) Read from the DB on cache miss — not applicable

`AuthGuard` lives in the `core` layer; `core` may not import a `module`, and schema-per-module
forbids it from reading the `user`/`admin` tables. Opening a port and placing the adapter in a
module would be circumventing that rule.

Even if the architecture allowed it, it would be wrong: a DB read on every cache miss adds a DB
round-trip to the auth hot path for users who were never banned (i.e., almost everyone) and defeats
the point of putting Redis in front.

**Conclusion: a DB read is not needed and cannot be done in this design.**

### B) Make absence meaningful → fail-closed — the real fix

The information from outside the cache does not have to be the DB; **login itself** already holds
it. Today login calls `openSession` but not `setVersion` — even though it has `user.version` in
hand.

Three changes:

1. Login **always** writes `setVersion(id, user.version)`
2. `ROTATE_SESSION_LUA` refreshes the version key's TTL in the same round-trip
3. `getVersion` returns "unknown" instead of `0` for absence, and `AuthGuard` fails closed

After that, "no version key" means "no live session", and that is safe: an access token lives 15
minutes, a version key 7 days. If the key is gone, that token is already dead.

**The price:** if the session Redis loses data, everyone is logged out. A silent security gap turns
into a noisy availability event. That is the right posture for a security control — `AuthGuard`
already fails closed with a 503 while Redis is _unreachable_; this merely extends the same posture
to data loss. With `--save 60 1`, though, a hard crash makes everyone who logged in during those 60
seconds log in again.

### C) Transactional outbox — partial

The outbox on the roadmap closes **vector 1**: `setVersion` is retried by the relay until it
succeeds. It does not close **vector 2** (data lost after the fact). This finding is one more
argument for the outbox.

### D) Accept + detect + document — the current choice

Defensible because exposure is ≤15min and the refresh path is safe. Its condition: **it must be
deliberate and visible.**

---

## 4. Decision and follow-ups

**Chosen: D.** B is a real fix, but its price (mass logout on data loss) is currently larger than
the exposure (15min, refresh closed).

**Criterion for moving to B:** the moment the threat model says "a ban must take effect instantly —
even 15 minutes is unacceptable". At that point the right answer is B.

### Follow-ups (smallest to largest)

- [ ] **Add AOF to `redis-session`** — `--appendonly yes --appendfsync everysec` in
      `docker-compose.yml`. Crash-loss window 60s → 1s. RDB alone is weak for a store holding
      security state. One line.
- [ ] **Write a rationale comment on `getVersion`'s `0` fallback** — `session/adapter.ts`. It looks
      innocent today; a comment stating that this is a _deliberate fail-open_ and why it is accepted
      (access-TTL bound + refresh's DB authority) stops the next reader from mistaking it for a bug
      and "fixing" it the wrong way.
- [x] ~~Report the `setVersion` catches to Sentry~~ — **reversed on 2026-07-19:** the in-command
      `setVersion` is a best-effort accelerator; the durable fix will come through the event path
      once the outbox lands. Those 7 catches are now **silent** (no log, no Sentry) and each carries
      an explanatory comment pointing at this file.
- [ ] _(deferred)_ Implementing option B — only if the criterion above is met.

---

## Related files

| File                                                            | Role                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/core/security/session/adapter.ts`                          | `getVersion` fail-open, `setVersion`, `ROTATE_SESSION_LUA` |
| `src/core/security/auth/guard/auth.guard.ts`                    | The version comparison                                     |
| `src/module/auth/application/command/refresh-tokens/handler.ts` | DB authority — the path that bounds the risk               |
| `src/module/auth/application/command/login-*/handler.ts`        | Where `setVersion` would be added under option B           |
| `src/module/*/application/event/*-session.listener.ts`          | The secondary reconcile path (depends on the same Redis)   |
| `docker-compose.yml`                                            | `redis-session` persistence/eviction settings              |
