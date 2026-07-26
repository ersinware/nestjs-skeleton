# Rate Limiting — Audit Findings and Roadmap

Status of the throttling architecture (`src/core/security/throttle`) as of 2026-07-26.

Everything under **Done** is implemented. Everything under **Open** is deliberately deferred: each
entry states the problem, why it matters, and the shape of the fix, so it can be picked up without
re-deriving the analysis.

---

## Deployment topology this API runs in

```
┌─────────┐     ┌──────────┐     ┌──────────────────┐     ┌─────┐     ┌──────────┐
│ Browser ├────►│ CDN / LB ├────►│ Next.js BFF      ├────►│ LB  ├────►│ THIS API │
└─────────┘     └──────────┘     │ (server-side)    │     └─────┘     └──────────┘
                                 └──────────────────┘
```

A server-side BFF sits between the browser and this API. The consequence dominates every decision
below: **this API's TCP peer is always a BFF pod, never a user.** Left alone, the entire user base
collapses into as many rate-limit buckets as there are BFF pods.

Two things must therefore be true, and neither is enforceable from inside this repo:

1. **The Next.js BFF must forward the browser's IP.** `fetch()` from a Next.js route handler sends no
   `X-Forwarded-For` of its own — the header has to be set explicitly:

    ```ts
    // Next.js BFF — forward the browser's address to the API
    const clientIp = req.headers.get('x-forwarded-for') ?? '';

    await fetch(`${API_URL}/api/v1/...`, {
        headers: { ...(clientIp && { 'x-forwarded-for': clientIp }) },
    });
    ```

2. **`TRUST_PROXY` must describe the hops between the browser and this process.** See below.

If (1) is skipped, rate limiting still "works" but keys every user in the system to a handful of pod
IPs. That failure is silent — there is no error, only a shared budget — so it must be verified after
deploy, not assumed.

---

## Done

### 1. The client IP is no longer client-controlled — `TRUST_PROXY`

`main.ts` created the Fastify adapter with `trustProxy: true`, which means "believe every hop in
`X-Forwarded-For`". That header is written by whoever sends the request, and Fastify's `request.ip`
resolves to the leftmost entry of the chain, so any caller could pick its own IP:

```bash
# Before: every request landed in a fresh bucket — no limit was ever reached
curl -H 'X-Forwarded-For: 1.2.3.4' ...
```

Every rate limit in the project — login, register, all critical routes — was bypassable with one
header. The same value also feeds `sourceIp` on every audit record, so the audit trail's "from where"
column was attacker-supplied.

`TRUST_PROXY` now states the topology explicitly, and both `true` and the hop-count form are rejected
at boot rather than being left available as footguns.

#### The CIDR form is the only accepted form

Fastify would also take a trusted-hop count. It is refused here, because the two fail differently:

| Form          | Example                    | How it behaves when the topology changes                                                                                                                         | Accepted?           |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Hop count     | `4`                        | **Silently wrong.** Add or remove one proxy and the count is off by one — the app keeps running and keeps recording the wrong address, with no error and no log. | ❌ rejected at boot |
| **CIDR list** | `10.0.0.0/8,172.16.0.0/12` | **Survives.** It describes _which network is ours_, not _how long the chain is_, so inserting or removing an internal hop changes nothing.                       | ✅                  |

Fastify walks the forwarded chain from the near end, skipping every address it trusts, and stops at
the first one it does not. A CIDR list expresses exactly that intent: "every address inside our own
network is infrastructure; the first address outside it is the client." A hop count only approximates
it, and the approximation is what breaks.

**Recommended for this project: the CIDR list covering the CDN/LB egress ranges and the internal
network.** `false` is correct only for local development, where nothing sits in front of the app.

| Topology                                             | Value                           |
| ---------------------------------------------------- | ------------------------------- |
| Local dev, no proxy                                  | `false`                         |
| Single ingress on a known private network            | `10.0.0.0/8`                    |
| **This project (CDN → LB → Next.js BFF → LB → API)** | the internal + CDN egress CIDRs |

> **Where each half lives.** WHAT IS ACCEPTABLE is stated once, as `@Matches` constraints on
> `EnvironmentVariables`, alongside every other variable's contract. `resolveTrustProxy()` only
> INTERPRETS, and is the single place in `src/` that reads `process.env` directly — structural, not a
> shortcut: the HTTP adapter is an argument to `NestFactory.create`, so it is built before the
> container that owns `ConfigService` (the same position `src/instrument.ts` already reads from).
>
> That ordering means the adapter is built a moment BEFORE validation runs, so the util fails safe:
> anything outside the accepted shapes resolves to "trust nothing". Boot still fails a moment later
> with the env class's explanatory message, but at no instant does an adapter exist that believes a
> forged `X-Forwarded-For`.

**Verify after every deploy** — the value is a claim about infrastructure, and infrastructure changes:

```bash
# From a machine with a known public IP, hit an endpoint that produces an audit record,
# then confirm the recorded sourceIp is that IP — not a pod address, and not a spoofed one.
curl -H 'X-Forwarded-For: 9.9.9.9' https://api.example.com/api/v1/...
# sourceIp must be YOUR address. If it is 9.9.9.9, TRUST_PROXY is too permissive.
# If it is 10.x.x.x, either TRUST_PROXY is too strict or the BFF is not forwarding.
```

### 2. Critical routes are now bound by two windows, not one

A single window cannot answer both shapes of attack, and the old `5 / 60s` was sized for neither:

| Attack                          | What it needs              | What `5 / 60s` did                                                                              |
| ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| Fast automated burst (seconds)  | Short window, firm limit   | Caught it                                                                                       |
| Slow sustained guessing (hours) | Long window, total ceiling | **Never saw it** — the window reset 1440×/day, allowing ~7,200 attempts/day against one account |

`ThrottlerName` now defines `CRITICAL_BURST` and `CRITICAL_SUSTAINED`, and a critical route is
enforced by **both at once** — passing requires satisfying each. The short window keeps its job; the
long one puts a ceiling on the total, which is what removes the "pace yourself and you are invisible"
gap. The sustained ceiling is generous on purpose: 60 attempts/hour is far above what any real user or
shared office produces, and far below what an attack needs.

### 3. `@CriticalThrottle()` → `@UseThrottlePolicy(ThrottlePolicy.CRITICAL)`

The old decorator set a boolean, and the guard branched on it. Three things were impossible as a
result: giving a policy a second window, giving endpoints with different rhythms different numbers,
and adding a policy without editing the guard.

The decorator now carries a **policy name**. The guard resolves it through an exhaustive
`Record<ThrottlePolicy, ThrottlerName[]>`, so:

- adding a limiter to a policy is a change in that Record — no controller touched;
- adding a policy is an enum member plus a limiter — the guard is not touched;
- forgetting to enforce a new policy fails compilation, the same way `KIND_TO_STATUS` works in the
  exception filter.

### 4. `blockDuration` is stated, not defaulted

`blockDuration` was unset, so it silently equalled `ttl`: exceeding a limit cost only the remainder of
a window that was expiring anyway. It is now an explicit env variable per limiter.

The values are deliberately kept close to each window rather than raised into a penalty. **A long
block is a bad trade while the tracker is an IP**: an attacker rotates addresses for free, whereas
everyone sharing an office NAT is locked out together. The lever now exists, and it earns longer
values the day the tracker becomes an identity (O1) or an account (O2).

### 5. `POST /auth/refresh` no longer carries a critical policy

The endpoint was budgeted at 5 requests/minute/IP. That budget bought nothing and cost a lot:

- What is presented is a **signed token**, not a guessable secret. Rate limiting slows down guessing;
  there is nothing to guess here.
- The real defence already exists and is IP-independent: single-use rotation plus reuse detection
  revoking the whole token family (`refresh-tokens/handler.ts`, RFC 9700).
- It is the only endpoint the client calls **without the user asking** — app launch, token expiry, tab
  refocus — so its traffic arrives in bursts. Under a shared NAT (or a BFF pod IP), a 5/minute budget
  answers 429 to legitimate sessions, and most HTTP clients read a failed refresh as "logged out". The
  result is mass logout, amplified by client retries.

### 6. `PATCH /user/me/password` now carries the critical policy

The endpoint verifies the user's **current password** — the same class of operation as login, and it
was running at the default limit. An attacker holding a stolen access token could brute-force the
current password far faster than they could brute-force login. The weakest link was the endpoint
nobody had marked.

### 7. Throttle durations are documented in the unit the library actually uses

`THROTTLE_TTL` was documented as _seconds_ while its sibling was documented as _milliseconds_.
`@nestjs/throttler` has used milliseconds since v5, so the value in `.env` was right and the JSDoc was
wrong — the dangerous direction. Someone trusting the comment and setting `60` would have created a
**60-millisecond window**, disabling rate limiting entirely without any error. Every duration is now
documented as milliseconds, in capitals, with the failure mode spelled out.

### 8. The default limit was raised, because it is not a security control

`THROTTLE_LIMIT` 100 → 300 per minute. The default limiter smooths abuse; the security decisions live
in the critical policy. A BFF-served frontend makes several calls per screen, and the counter is
currently shared by everyone behind one address — so a tight default costs real users far more than it
costs an attacker, who is bounded by the critical windows anyway.

### 9. Guard-refused requests are now attributable — `auditContextHook`

NestJS runs guards **before** interceptors. `AuditContextInterceptor` was what opened the ambient
audit context, so every refusal decided by a guard — each `429` from the throttler, each `403` from
the roles guard — was recorded with no source IP, no user agent and no actor. The audit trail said
that _someone, somewhere, was refused_.

The context is now opened by a Fastify `onRequest` hook (`audit-context.hook.ts`, registered in
`main.ts`), which runs ahead of the entire Nest pipeline. It fills the transport half only; the actor
arrives later, from the guard that verifies it (§10).

It has to be a hook rather than a middleware: middleware receives the raw Node request, which has no
`ip` — the resolved client address exists only on Fastify's request object. Re-deriving it from
headers would mean reimplementing the proxy-trust decision, and a second implementation is a second
thing to get wrong.

The hook seeds four transport facts. Only `sourceIp` survives unchanged from the first version; the
other three answer objections it left open:

| Field       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceIp`  | Fastify's resolved client address, now trustworthy because of §1.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `userAgent` | Distinguishes a browser from a script behind the same NAT address. **Trimmed to 256 chars** — the header is attacker-controlled and unbounded, and an untrimmed copy lands verbatim in a store that is exempt from log levels and cannot be pruned casually.                                                                                                                                                                                                                              |
| `method`    | The route alone is ambiguous: `/v1/user/:id` under `GET` is a disclosure and under `DELETE` is a destruction, and a refusal is a different fact for each. Free to carry, and useless to omit once `route` is there.                                                                                                                                                                                                                                                                       |
| `route`     | The generic refusals (`ACCESS_DENIED`, `RATE_LIMITED`) name no subject of their own, so without the endpoint the record says only that someone was refused something. Taken as Fastify's matched **template** (`/v1/user/:id`), never `request.url`: a raw URL carries the query string, so any endpoint that ever accepts a token or a search term in the query would write it into a store that must hold evidence and never credentials. Low cardinality is the bonus, not the reason. |

> ⚠️ Needs one runtime confirmation: that the `AsyncLocalStorage` context opened in the hook survives
> into the handler (the `run(store, done)` shape Fastify documents for exactly this). Assert it once in
> an E2E test — an `ACCESS_DENIED` record carrying a `sourceIp` and a `route` — and it is settled.
> (A `429` is no longer the convenient probe: throttling is bypassed under `NODE_ENV=test`, and the
> record now fires only on the hit that crosses the limit — see §11.)

### 10. The actor is published by the guard that establishes it

The hook fixed the transport half; this fixes the identity half. The two guard-thrown refusals are not
the same case, and treating them alike was the bug:

| Refusal             | Thrown by                           | Was the actor knowable?                              | Was it recorded?           |
| ------------------- | ----------------------------------- | ---------------------------------------------------- | -------------------------- |
| `429 RATE_LIMITED`  | Throttler guard, before `AuthGuard` | **No** — no token verified yet                       | Correctly absent (see §11) |
| `403 ACCESS_DENIED` | `AuthRolesGuard`, after `AuthGuard` | **Yes** — the denial is _about_ that identity's role | ❌ Absent anyway           |

`actorId` and `actorRole` were seeded by `AuditContextInterceptor`, and interceptors run after every
guard. So an access denial — the one record whose entire content is "which role reached for what" —
named no role at all.

`AuthGuard` now publishes the verified principal into the context at the moment it establishes it,
which is what the project's audit rule asks for: the code that establishes a fact records it, rather
than something downstream that merely observes the result. `AuditContextInterceptor` became redundant
and was deleted — one less global interceptor, and one less way for the two to drift.

Only a **verified** payload is published. Decoding a token without verifying it would let a caller
name itself in the audit trail: not an unattributed record, a forged one.

Two dependency changes were needed to make this legal, and both stand on their own merits:

- **`AuthRole` moved to `src/shared/domain/auth-role/`.** It is `AdminRole | UserRole` — composed
  entirely of shared domain vocabulary — so owning it from `core/security/auth` gave everything that
  merely mentions a role a reason to import the auth concern. That is exactly how the audit context
  came to depend on the guard it sits beside.
- **`AuditInterceptor` stopped typing the request as `AuthenticatedRequest`.** It reads one route
  parameter and never touches the actor, so it now declares the narrow shape it actually uses.

Together these leave `core/observability/audit` with no import of `core/security/auth`, so auth may
depend on audit without closing a cycle (`import/no-cycle` counts type-only imports too).

**Rejected alternative — verifying the token in the hook.** It would put JWT verification and the
fail-closed session-version lookup ahead of every request including `@Public()` ones, duplicate the
guard's logic, and invert the protection order so an unauthenticated flood pays crypto and Redis costs
before being rate limited.

**Rejected alternative — the global filter topping up the context from `request.accessTokenPayload`
before writing its record.** It works and is ~5 lines, but it treats the symptom at the last possible
moment: any future reader of the context between the auth guard and the filter would still see no
actor, and the filter would be asserting an identity it did not establish.

### 11. `RATE_LIMITED` is one record per block, not per refused request

The filter wrote a `RATE_LIMITED` entry on every `429`. A block is **one episode that refuses
thousands of requests**: with a 60 s block, an attacker at 100 rps produced six thousand audit records
for a single decision. That is the per-request flooding the project's dependency-outage rule already
rejects — and it lands in the one store that is exempt from log levels, retained by policy, and
destined to become a table, where it would hand any anonymous caller a write amplifier against the
evidence trail.

The record moved to `FailSafeThrottlerGuard.throwThrottlingException`, which is the only place that
can tell the request that CAUSED the block from the ones merely caught behind it:

```ts
if (throttlerLimitDetail.totalHits === throttlerLimitDetail.limit + 1) {
    this.auditPort.record({ action: AuditAction.RATE_LIMITED });
}
```

`limit + 1` is exactly the hit at which the storage script sets the block key; every later refusal
keeps incrementing the counter and so cannot match. The one case this under-records is a re-block
while the hit counter is still alive, reachable only if a `blockDuration` is configured **shorter**
than its `ttl` — under-recording is the correct direction to err, since the alternative floods
precisely when the log matters most.

No `reason` is passed: the ambient context already carries the address, the user agent and the route,
which is the whole of what a rate-limit refusal establishes. (Which of the two critical limiters fired
is not available at this seam — `ThrottlerLimitDetail` carries no throttler name — and the route
already tells an operator what was being hit.)

`ThrottleModule` therefore imports `AuditModule`, and the guard re-declares `@InjectThrottlerOptions()`
/ `@InjectThrottlerStorage()` on its constructor: declaring any `@Inject` on a subclass writes that
class's own dependency metadata, which **shadows** rather than extends the base class's, so the first
two parameters would otherwise become unresolvable at boot.

### 12. No caller restates a fact the ambient context already holds

`targetId` means _the subject the action was applied to_. Several call sites were passing the acting
principal into it — harmless-looking duplication that, after §10, makes the same person appear twice
under two different meanings.

| Call site                                            | Before                             | Now         | Why                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global filter, `403`                                 | `targetId: accessTokenPayload.sub` | _(nothing)_ | Outright wrong: that sub is the **actor**, and the field was standing in for an `actorId` that did not exist yet.                                                                                                     |
| `PATCH /user/me`, `/me/password`, `DELETE /user/me`  | `targetId: <own id>`               | _(nothing)_ | Reachable only from self-scoped routes, so the subject IS the actor already named.                                                                                                                                    |
| `POST /auth/logout-all`                              | `targetId: command.sub`            | _(nothing)_ | `sub` comes straight from the access token — a pure echo of `actorId`.                                                                                                                                                |
| `POST /auth/logout`                                  | `targetId: payload.sub`            | **kept**    | The subject comes from the **refresh** token in the body, not the access token the guard verified. Where they differ — a principal closing someone else's session — that divergence is the whole value of the record. |
| Admin/user ban, unban, delete-by-id, revoke-sessions | `targetId: command.id`             | **kept**    | A genuinely distinct subject; several run from event listeners with no HTTP actor at all.                                                                                                                             |
| Both login handlers, refresh reuse                   | `targetId: sub`                    | **kept**    | `@Public()` routes — no verified actor exists, so this is the only identity on the record.                                                                                                                            |

`AuditInterceptor` already followed this rule (`:id` when present, nothing on a `me/…` route); the
handlers now match it.

**Trade-off, accepted:** "every record concerning user X" is no longer a single-column query — it is
`actorId = X OR targetId = X`. That is the correct shape anyway, since the two answer different
questions ("what X did" vs "what was done to X"), and duplicating a value to avoid an `OR` would make
the record state something it does not know.

### Rules promoted out of this document

Four findings above generalize beyond rate limiting, so they now live in `CLAUDE.md` and bind all
future work whether or not anyone reads this file again:

| Rule                                                                                                                          | Section                 | From    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------- |
| One record per EPISODE, never per affected request                                                                            | § Audit                 | §11     |
| A caller passes only what the ambient context does not already hold                                                           | § Audit                 | §12     |
| The audit context is filled in two phases, by whoever brings each fact into existence                                         | § Audit                 | §9, §10 |
| `process.env` may be read only before the DI container exists — and such a reader interprets, never validates, and fails safe | § Environment Variables | §1      |

Plus one framework trap worth its own line in § Dependency Injection: declaring any `@Inject` on a
subclass **shadows** the base class's dependency metadata rather than extending it.

---

## Current configuration

| Variable                                     | Value     | Meaning                          |
| -------------------------------------------- | --------- | -------------------------------- |
| `THROTTLE_TTL`                               | `60000`   | Default window: 1 minute         |
| `THROTTLE_LIMIT`                             | `300`     | 300 ordinary requests per minute |
| `THROTTLE_BLOCK_DURATION`                    | `60000`   | 1 minute block after exceeding   |
| `THROTTLE_CRITICAL_BURST_TTL`                | `60000`   | Critical short window: 1 minute  |
| `THROTTLE_CRITICAL_BURST_LIMIT`              | `10`      | 10 critical requests per minute  |
| `THROTTLE_CRITICAL_BURST_BLOCK_DURATION`     | `60000`   | 1 minute block                   |
| `THROTTLE_CRITICAL_SUSTAINED_TTL`            | `3600000` | Critical long window: 1 hour     |
| `THROTTLE_CRITICAL_SUSTAINED_LIMIT`          | `60`      | 60 critical requests per hour    |
| `THROTTLE_CRITICAL_SUSTAINED_BLOCK_DURATION` | `3600000` | 1 hour block                     |

All durations are **milliseconds**. Critical routes today: user login, admin login, register, and
password change.

---

## Open

### O1 — The tracker is still IP-only, so it cannot represent a user (High)

**Problem.** `getTracker()` is not overridden, so the bucket key is the client IP. IP is a poor proxy
for identity in both directions: behind CGNAT, corporate NAT, or a mobile carrier, one IP is hundreds
of users sharing one budget; on IPv6 or mobile, one user rotates through many IPs. With the BFF in
front, the distortion is worse still — see the topology section.

This is also what caps the value of every number in the table above: while the tracker is an address,
tightening a limit hurts shared users more reliably than it hurts an attacker.

**Fix.** Key authenticated requests on the subject instead:

```
authenticated?  → tracker = "user:<sub>"     ← NAT-immune, one bucket per real user
anonymous?      → tracker = "ip:<request.ip>"
```

**Blocker to resolve first.** The throttler guard runs _before_ `AuthGuard` (`ThrottleModule` is
scanned as an import, ahead of the root module's own `APP_GUARD` providers), so
`request.accessTokenPayload` is not populated when `getTracker()` runs. Two options:

- Register the throttler guard after `AuthGuard`. Cost: `AuthGuard` reads the session version from
  Redis, so an unauthenticated flood would reach Redis before being rate limited — an amplification
  vector. Not obviously acceptable.
- Verify the token inside the tracker. Cheap (HS256, no DB) but duplicates guard logic.

**Never** decode the token without verifying it. An unsigned token with an arbitrary `sub` would let
an attacker mint unlimited buckets — the same defect as the `X-Forwarded-For` one, rebuilt by hand.

### O2 — No defence against distributed credential stuffing (High)

**Problem.** Failed logins are recorded (`AuditAction.LOGIN_FAILED`) but never **counted**. There is
no lockout, no progressive delay, no CAPTCHA threshold. An IP budget is structurally useless here: a
1000-IP botnet at 10 attempts/minute each is 10,000 attempts/minute, none of them over any limit.

**Fix.** Two layers, because they answer different attacks:

- _Throttle layer_ — a limiter keyed on `sha256(normalize(email))`, e.g. 5 per 15 minutes.
  Identity-keyed, so it is immune to both NAT collapse and IP rotation.
- _Domain layer_ — a counter owned by the login handler, driving progressive delay or a lockout.

Beware the naive version: a plain lockout is a denial-of-service tool, since anyone can lock any
account by submitting wrong passwords for its email. Progressive delay plus a risk signal (unseen
IP/device) is the safer shape.

### O3 — Endpoints with different rhythms still share one policy (Medium)

**Problem.** The mechanism to separate them now exists (Done #3) but is not used: login, admin login,
register and password change all sit on `ThrottlePolicy.CRITICAL`. Their natural rhythms differ by
orders of magnitude:

| Endpoint    | Natural rhythm                   | Wants                                     |
| ----------- | -------------------------------- | ----------------------------------------- |
| User login  | Retries within minutes           | Short window, moderate limit              |
| Register    | Once per person, ever            | **Long** window, low limit (e.g. 10/hour) |
| Admin login | Very few people, very high value | Much stricter than everything else        |

**Fix.** Add `ThrottlePolicy.REGISTRATION` and `ThrottlePolicy.ADMIN_AUTH`, each with its own limiters
and env variables, and move the two endpoints onto them. No guard change — that was the point of
Done #3.

### O4 — Critical budgets are per-route, so the auth surface has no total (Low)

`generateKey` includes the controller and handler name, so a budget applies per endpoint: user login,
admin login and register each get their own. Per-route isolation is a good default, but "the
authentication surface as a whole" has no ceiling — an attacker rotating between endpoints multiplies
the budget. Fix by overriding `generateKey` for critical policies to drop the handler component.

### O5 — Rate limiting disappears entirely during a Redis outage (Low)

`FailSafeThrottlerGuard` fails open on storage errors. The decision is right — an outage must not take
the application down — but it means an attacker gets an unlimited window whenever Redis is
unavailable. Consider a process-local in-memory counter as a fallback for critical policies only:
imperfect (the effective limit multiplies by instance count) but far better than none.

### O7 — The E2E app bootstraps differently from production (Low)

`test/shared/test-app.factory.ts` builds its adapter with `trustProxy: true` and does not register
`auditContextHook`. Both were correct before this round and are now divergences: E2E exercises an app
whose IP resolution and audit context differ from the one that ships. Align the factory with `main.ts`
so the wiring is covered — and so the assertion suggested in Done #9 is possible at all.

### O10 — An audit-write failure could fail the throttler open (Low, introduced by Done #11)

**Problem.** `throwThrottlingException` is called from INSIDE `super.handleRequest(request)`, which
sits inside the guard's fail-open `try`. The audit write now runs there, before the
`ThrottlerException` is constructed. So if `record()` ever threw, no `ThrottlerException` would exist
to be recognized and rethrown, the generic `catch` would fail open, and **the request would be
allowed** — an audit hiccup silently converted into a rate-limit bypass.

Reachability is low: `AuditAdapter.record()` builds an object and calls pino, which does not throw
synchronously on a broken destination. But the severity is inverted relative to the cause, which is
what makes it worth stating rather than assuming.

**Fix, when taken.** Do not swallow the audit error — that trades a bypass for lost evidence, and
evidence is the thing the port exists to guarantee. Narrow the fail-open instead, so it covers only
what it was written for (storage failures) and lets everything else propagate.

> The same shape exists, pre-existing and equally improbable, in `GlobalExceptionFilter`: its
> `ACCESS_DENIED` write runs before `reply()`, so a throw there would leave the request unanswered.
> Both want the same decision, so fix them together.

### O8 — Fixed windows allow a boundary burst (Low)

The Redis storage is a fixed window (`INCR` + `PEXPIRE` on first hit), not a sliding one. A caller can
therefore spend a full budget at the end of one window and another immediately after it rolls — up to
2× the limit within a few seconds. This is a known, normally-accepted trade (a sliding window costs a
sorted set per tracker); it just has to be priced in when choosing a limit.

### O9 — Throttle counters share a key space with the cache (Low)

`ThrottlerStorageRedisService` is handed the shared state client with no key prefix, so a cache flush
also resets every rate-limit counter. The library exposes no `keyPrefix` option; the fix is to pass a
`redis.duplicate({ keyPrefix: 'throttle:' })` client or a separate DB index — at the cost of a second
connection, whose lost/restored transitions would want the same logging treatment as the primary one.

---

## Priority

| Order | Item                                                                                                                                                                            | Effort                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **1** | **Verify the BFF forwards `X-Forwarded-For`, and set `TRUST_PROXY` per environment** — the CIDR list is now the only accepted form, so a deploy cannot fall back to a hop count | config + one deploy check              |
| 2     | Confirm the audit hook's ALS context survives into the handler (Done #9)                                                                                                        | one E2E assertion                      |
| 3     | O7 — align the E2E factory with `main.ts`                                                                                                                                       | small                                  |
| 4     | O3 — split registration and admin auth onto their own policies                                                                                                                  | small                                  |
| 5     | O1 — identity-based tracker                                                                                                                                                     | medium, needs the guard-order decision |
| 6     | O2 — account-level protection                                                                                                                                                   | medium, needs design                   |
| 7     | O4 – O10                                                                                                                                                                        | hardening                              |
