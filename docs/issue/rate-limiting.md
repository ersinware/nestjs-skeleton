# Rate Limiting — Target Architecture

> **Status: NO implementation.** The project contains no rate-limiting code whatsoever. The previous
> implementation was deliberately removed in full because its architecture will be redesigned. This
> document is the design input for that rebuild: it describes what will be built, in what order, and
> why.
>
> ⚠️ **The decisions here are not fully settled.** Each one is written down with its rationale, but
> none is final; they must be reviewed again before implementation starts, and the architecture
> updated where needed. This document is not a "decision record" — it is the current state of the
> discussion.

---

## 1. What this layer solves, and what it does not

Rate limiting answers **a single question**: _"Is this caller entitled to perform this operation this
often?"_ Its purpose is to make guessing (passwords, tokens, codes) and resource consumption
**expensive**.

**It does not solve:**

- **Volumetric DDoS.** If the traffic should not even reach the application, the answer lives at the
  CDN/WAF layer. The application layer has to accept a request before it can reject it.
- **Bot management / fingerprinting.** That is a separate product area.
- **Authorization.** Rate limiting answers "how many times", not "who, and entitled to what".

This distinction matters because it is the reference point when picking limits: a limit must be wide
enough to carry a **real user's natural rhythm**, and narrow enough to be **useless to an attack**. A
number that cannot do both at once was chosen on the wrong axis.

---

## 2. Prerequisite: a trustworthy answer to "who is calling?"

All of rate limiting is built on this answer. If the answer is wrong, every number stacked on top of
it is meaningless.

This API sits behind a server-side BFF:

```
Browser → CDN / LB → Next.js BFF (server-side) → LB → THIS API
```

The decisive consequence: **this API's TCP peer is always a BFF pod, never the user.** With nothing
done about it, the entire user base collapses into as many buckets as there are BFF pods.

Two conditions must hold, and **neither can be enforced from this repo**:

1. **The BFF must forward the browser's address.** A `fetch()` issued from a Next.js route handler
   does not send `X-Forwarded-For` on its own; the header must be set explicitly.
2. **`TRUST_PROXY` must describe the topology.** _(This part already exists and is independent of
   rate limiting — it was not removed.)_

`TRUST_PROXY` today accepts only `false` or an **IP/CIDR list**; `true` and a **hop count** are
rejected at boot. Rationale: a hop count is _positional_ — add one proxy to the chain and it silently
starts reading the wrong address without erroring. A CIDR list instead says "these networks are
ours"; it stays correct whether an internal hop is added or removed.

> **Silent-failure warning.** If the BFF does not forward the header, rate limiting appears to
> "work" but keys everyone to a handful of pod IPs. It produces no error and no log. It is therefore
> **something to verify after every deploy**, not something to assume.

---

## 3. The identity axis (tracker) — the central decision of this architecture

"What is the bucket key?" is the most decisive question in this design. IP alone is a weak proxy for
identity and breaks **in both directions at once**:

- Behind corporate NAT / CGNAT / mobile carriers: **one IP = hundreds of users**, all sharing a
  single budget. Tightening the limit punishes real users.
- IPv6 / mobile / VPN: **one user = dozens of IPs**. The attacker pays nothing to change address.

**Proposed: three tracker axes, selected by what the request is.**

| Axis         | When                                            | Key                                | Why                                                                                                           |
| ------------ | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Identity** | Authenticated request                           | `user:<sub>`                       | Unaffected by NAT, unaffected by IP rotation. One budget per real user.                                       |
| **Account**  | Authentication attempts (login, password reset) | `account:<hash(normalize(email))>` | The only defense against a distributed attack: the botnet rotates IPs but **the target account stays fixed**. |
| **Address**  | Anonymous request                               | `ip:<request.ip>`                  | The only axis left when nothing else is available.                                                            |

The three are not alternatives to one another — they are **different axes answering different
attacks**. A single login request may be counted on both the account and the address axis at once.

**Critical sub-decision — guard ordering.** To use the identity axis, `sub` must be known at the
moment the rate-limit decision is made. Two options:

- **(Proposed) Keep the rate-limit guard BEFORE `AuthGuard` and let it resolve identity itself** —
  by verifying **only the token's signature**. HS256 verification is cheap and touches neither the
  DB nor Redis. An unauthenticated flood is then stopped before it ever reaches the cost of session
  validation.
- Move the rate-limit guard after `AuthGuard`. Simpler, but **an unauthenticated flood reaches Redis
  before it hits the rate limit** — an amplification vector.

> **Never:** decoding the token without verifying it and reading `sub`. With an unsigned token an
> attacker mints as many fresh buckets as they like — the `X-Forwarded-For` hole rebuilt by hand.

---

## 4. The policy catalog — an endpoint knows no numbers, only a name

Endpoints must carry a **policy name**, never a **number**. Numbers live in exactly one place: the
configuration.

```
Endpoint  ──selects──▶  Policy  ──consists of──▶  one or more limiters
                                                   (each limiter: window + limit + block duration)
```

Initial catalog (names are examples, not final):

| Policy            | Where                               | Why separate                                                                                      |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DEFAULT`         | Every unmarked endpoint             | Softens abuse. **Not a security control**, hence generous.                                        |
| `AUTH`            | User login                          | Verifies a guessable secret.                                                                      |
| `ADMIN_AUTH`      | Admin login                         | Used by very few people, of very high value — must be stricter than everything else.              |
| `REGISTRATION`    | Sign-up                             | Once per person per lifetime. A short window is the wrong axis; a long window + low cap is right. |
| `SENSITIVE_WRITE` | Password change, email change, etc. | Verifies an existing secret or hands over the account.                                            |

**Adding a policy must cost near zero:** one new enum member + one limiter definition. If the guard
has to be touched, the mechanism was built wrong. A policy's limiter mapping must be **exhaustive**:
adding a policy and forgetting to enforce it must be a **compile error**.

**When does something count as critical?** Rule: _an endpoint is critical if it verifies a
**guessable secret**._

- Login, password change → **yes** (a password can be guessed).
- Token refresh (`refresh`) → **no**. What is presented is a **signed token** — there is nothing to
  guess; the real defense is single-use rotation + reuse detection. Moreover this is the one
  endpoint the application calls without the user asking (startup, token expiry, tab focus) — its
  traffic arrives in bursts, and a shared IP budget would return 429 to legitimate sessions. Most
  clients read that as "you were logged out"; the result is mass logout.

---

## 5. Dual window: burst + sustained

A single window sees only one of the two attack shapes.

| Attack                           | Its need                   | What a single short window does                                                                         |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fast automated burst (seconds)   | Short window, tight limit  | Catches it                                                                                              |
| Slow, sustained guessing (hours) | Long window, total ceiling | **Cannot see it** — the window keeps resetting; the "slow yourself down, stay invisible" gap stays open |

Sensitive policies must therefore carry **at least two limiters**, and passing requires satisfying
**all of them at once**: the short window cuts the burst, the long window caps the total attempt
count. The long window's ceiling is deliberately generous — far above what a real user or a shared
office would ever produce, far below what an attack needs.

**Block duration must be stated explicitly.** Left unstated it defaults to the window duration,
which means "the price of exceeding the limit is the remainder of a window that was about to expire
anyway" — i.e., no price at all.

**How long should a block be?** That depends directly on the **tracker axis**:

- If the tracker is **IP**, a long block is a bad trade: the attacker changes address (free), while
  everyone sharing the same NAT gets locked out together.
- If the tracker is **identity** or **account**, a long block becomes meaningful.

---

## 6. Key schema

The key consists of three parts: **`<prefix>:<policy>:<tracker>`**

- **Prefix** — so throttle counters can never be confused with anything else (see §7).
- **Policy** — budgets are separated at the policy level.
- **Tracker** — the axis from §3.

**The route/handler name must not enter the key.** If it does, every endpoint gets its own budget
and the attacker multiplies the total by walking across endpoints: `login` + `admin login` +
`register` are three separate budgets. A single ceiling at the policy level produces a meaningful
bound for "the entire authentication surface".

The counter-argument: route-level isolation prevents one endpoint's heavy traffic from locking out
another. That is exactly why the separation happens **at the policy level** — endpoints with
different rhythms go into different policies, while endpoints inside one policy share a budget by
design.

---

## 7. Storage and resilience

**Redis, in a separate key space.** Counters must not share a keyspace with the cache: otherwise a
cache flush resets every rate-limit counter — i.e., cache maintenance switches off a security
control. A dedicated key prefix (or a separate DB index) is mandatory. If that requires a second
connection, that connection's lost/restored transitions must receive **the same logging treatment**
as the first.

**Window type: fixed window, accepted; not sliding.** A fixed window allows a 2× burst at the
boundary (spend the budget at the end of the window, spend it again the moment it rolls over). A
sliding window closes that but costs an ordered structure (sorted set) per tracker. Decision: **use
a fixed window and account for the 2× allowance when choosing limits.** Moving to a sliding window
goes on the table only if boundary bursts become a real problem.

**Outage behavior — a single "fail-open" answer is not enough:**

| Policy             | When Redis is down                          | Rationale                                                                                                                                                                               |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT`          | **Fail-open** (let through)                 | Not a security control; a cache outage must not take the application down.                                                                                                              |
| Sensitive policies | **Degrade to an in-process memory counter** | Imperfect (the effective limit is multiplied by the instance count) but far better than "no protection at all". A Redis outage must not be the event that opens the brute-force window. |

**Fail-open must be kept narrow.** It should swallow only the _storage_ failure, never mean "let
through no matter what happens inside the guard". Otherwise an unrelated error (say, an audit write)
silently turns into a rate-limit bypass — a failure class where cause and consequence are inversely
proportional.

---

## 8. The request flow, step by step

```
1. Request arrives
   └─ Fastify onRequest hook: audit context opens (sourceIp, userAgent, method, route)
      · sourceIp is the address resolved according to TRUST_PROXY  → §2

2. Rate-limit guard runs (BEFORE AuthGuard)
   ├─ a) Policy resolved: the endpoint's decorator → DEFAULT when absent
   ├─ b) Tracker resolved: user:<sub> when the token signature verifies, else ip:<addr>  → §3
   ├─ c) For each of the policy's limiters, the counter is incremented and checked  → §5
   └─ d) Outcome:
        ├─ All within limits → continue
        └─ Any exceeded     → 429 + Retry-After            → §9

3. AuthGuard runs
   └─ token is VERIFIED → actor is published into the audit context

4. AuthRolesGuard → role check
5. Pipes / handler
```

The rationale for the ordering: **the cheapest rejection goes first.** A rate-limit decision is a
counter increment; session validation is a Redis read. Putting the expensive one first makes us pay
the attacker's bill.

---

## 9. The violation flow

**What the client receives:**

- **429** with a **`Retry-After`** header. That header is not an optional courtesy: without it the
  client cannot know when to retry and usually retries immediately — the block then fails to reduce
  the load it exists to reduce.
- The body follows the project's standard error shape (`ErrorDefaultDto`).
- **Which limiter fired must not be disclosed.** Saying "the per-account limit was exceeded"
  confirms the account exists (user enumeration).

**What gets recorded — one record per block, not per request.** A block is **a single decision**
that rejects thousands of requests. A 60-second block under 100 requests per second produces six
thousand audit records. The audit store is exempt from the log level, retained by policy, and will
one day become a table — so a per-request record is a **write-amplification** lever any anonymous
caller can pull.

The record is therefore written **on the first request that exceeds the limit**, and **only by the
rate-limit component itself**: that is the one place that can distinguish the request that _caused_
the block from the ones merely caught behind it. Having the global exception filter record the 429
is wrong — the filter sees every rejection, not just the first.

The record must also receive **no extra identity fields**: address, user agent, method and route
already come from the ambient context. A rate-limit rejection establishes nothing beyond that.

**Metrics are a separate job.** "How many blocks, on which policy" is a question for metrics, not
audit; alerting is built there.

---

## 10. Account-level defense — where the throttle layer ends

Rate limiting measures **speed**. Part of the authentication attack surface is not fast.

Distributed credential stuffing is the canonical example: a 1000-IP botnet making 10 attempts per
minute per IP trips no IP limit — yet 10,000 attempts per minute are being made. The **account
axis** (§3) catches part of this; the rest is not the throttle layer's job:

| Layer        | Responsibility                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Throttle** | Speed. One limiter on the `account:<hash(email)>` axis.                                                                                                                     |
| **Domain**   | Failed-attempt counter, progressive delay, risk signals (unseen IP/device), CAPTCHA threshold when needed. This is a **business rule** and lives inside the login use case. |

> **Trap:** plain account lockout hands the attacker a DoS tool — anyone can lock any account by
> sending wrong passwords to its email. Progressive delay + risk signals are the safer shape. This
> is work that requires design; it is not a quick add-on.

---

## 11. Observability

The project's general rules apply here unchanged; the rate-limiting-specific distinctions are:

| Signal      | For                                                    | Rule                                                                                                                          |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Audit**   | Evidence: who was blocked, when, from where            | **One** record per block (§9). At block start, written by the rate-limit component itself.                                    |
| **Metrics** | Alerting and trends: block count, per-policy breakdown | This is what alarms are built on — not audit.                                                                                 |
| **Logs**    | Diagnosis                                              | **No** log per rejected request. For outages and the like, one record at the connection level, gated on the state transition. |

---

## 12. Implementation order

Each step assumes the previous one; the order must not be skipped.

| #   | Step                                                                                                                            | Why here                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Verify the BFF forwards `X-Forwarded-For`; pin down per-environment `TRUST_PROXY` CIDRs**                                     | Comes before any code. If this is wrong, nothing above it means anything (§2). Deployment work, not code.                                                                                                                  |
| 1   | **Skeleton:** the rate-limit concern, port + adapter + global guard, the policy decorator, an empty catalog                     | The structure everything else rides on.                                                                                                                                                                                    |
| 2   | **The `DEFAULT` policy**, single window, IP axis, a **separate key space** in Redis (§7)                                        | The simplest vertical slice; this is where we see it working end to end.                                                                                                                                                   |
| 3   | **The Swagger decorator for 429** (something like `ApiDefaultTooManyRequestsResponse`) + `Retry-After`                          | Must be written **at the same time** as the first 429-producing endpoint. The decorator was removed together with the old implementation to leave no dead code. An undocumented error state does not exist for the client. |
| 4   | **The dual window** (burst + sustained) and the **sensitive policies**: `AUTH`, `ADMIN_AUTH`, `REGISTRATION`, `SENSITIVE_WRITE` | With the mechanism standing, this is pure catalog extension.                                                                                                                                                               |
| 5   | **The identity axis** (`user:<sub>`) + implementing the guard-ordering decision (§3)                                            | Up to this point every limit is on the IP axis; this step brings the real quality.                                                                                                                                         |
| 6   | **Outage degradation for the sensitive policies** (fall back to the memory counter, §7)                                         | Meaningful only once the fail-open behavior is settled.                                                                                                                                                                    |
| 7   | **The account axis** (`account:<hash(email)>`) + the domain-layer progressive delay (§10)                                       | Requires design; deliberately last.                                                                                                                                                                                        |
| 8   | **E2E verification:** the audit context reaches the handler, `Retry-After` is returned, exactly one record per block            | Pins the behavior down.                                                                                                                                                                                                    |

---

## 13. Traps that must not be repeated in the rebuild

Mistakes whose price was paid in the previous implementation:

- **Duration units.** Whatever unit the library expects, the JSDoc and the `.env` comment must state
  **the same unit**. A millisecond value mistaken for seconds disables rate limiting **without an
  error**. Every default that fails silently in the wrong direction must be written down like this.
- **Trusting `X-Forwarded-For`.** A "trust every hop" setting lets the caller choose its own IP —
  i.e., choose its own rate-limit bucket. The same value also feeds `sourceIp` in the audit record.
- **A boolean decorator.** A decorator carrying an "is it critical?" flag collapses the moment a
  second policy is needed. It must carry a **policy name** from the start.
- **Extending a framework guard.** Extending a framework class and adding `@Inject` on the subclass
  **shadows** (does not extend) the base class's dependency metadata — the base class's injects must
  be re-declared too, or the application dies at boot.
- **Recording the rejection at every layer.** The one place that writes the record is the place that
  _establishes_ the fact. The filter sees every 429; it cannot tell the first one apart.
- **Health endpoints.** Liveness/readiness probes must not be rate-limited — if a load balancer's
  health check receives a 429, the instance is declared unhealthy and the outage amplifies itself.
