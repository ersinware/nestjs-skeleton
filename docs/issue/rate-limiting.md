# Rate Limiting — Architecture Decisions

This document owns the target architecture, policy mappings, and initial budgets.
Delivery order and acceptance criteria belong in the [implementation plan](rate-limiting-implementation-plan.md).
Implementation status is determined from code; verification results belong in CI/PR evidence.
If package or deployment behavior conflicts with a decision, resolve the conflict explicitly
and update this document rather than maintaining a second decision list.

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

Select initial limits for the operation's normal usage and resource cost, then validate them
against real traffic. Shared IPs and changing addresses limit the protection any single tracker
can provide; the selected budgets do not guarantee prevention of malicious traffic.

---

## 2. Prerequisite: a trustworthy answer to "who is calling?"

All of rate limiting is built on this answer. If the answer is wrong, every number stacked on top of
it is meaningless.

**Access decision: serve both the web BFF and mobile clients directly.** Mobile
clients do not have to traverse the web BFF. Both paths must have a defined proxy trust chain.
Illustrative paths, to be verified against each deployment:

```
Browser → CDN/LB → Web BFF → API ingress/LB → API
Mobile app → API ingress (CDN/WAF/LB as deployed) → API
```

Direct mobile access means access to the published API ingress, not a requirement to expose the
API process outside controlled networking. The API's TCP peer may be an ingress proxy rather
than the end user. Without trustworthy IP forwarding, unrelated clients may share proxy-IP budgets.

1. **Web path:** the BFF must propagate the browser IP established by its trusted upstream chain.
2. **Mobile path:** client-supplied forwarded headers are untrusted. The trusted ingress must
   sanitize/rebuild them from its observed client and trusted upstream information. A BFF-specific
   header is not required for mobile access.
3. **Both paths:** configure `TRUST_PROXY` for the actual proxy IPs/CIDRs. The limiter consumes
   Fastify's resolved `request.ip`; it does not parse arbitrary forwarded headers itself.

Deployment must define and verify the real paths, trusted networks, and header handling points.

`TRUST_PROXY` must accept only `false` or an **IP/CIDR list**; `true` and a **hop count** are
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

**Decision: independent limiters with explicit stages.** A policy can apply multiple
IP, target-account, and user limiters; every applicable limit must be satisfied. A composite
IP/account tracker does not replace independent limits. Selected endpoint mappings and initial
configurations are recorded in §4.

The tracker axes are:

| Axis         | When                                                    | Key                                  | Why                                                                               |
| ------------ | ------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| **Identity** | Policies selecting a verified principal tracker         | `principal:<sub>`                    | One budget per verified caller ID, independent of source IP.                      |
| **Account**  | Login and activation-email resend                       | `account:<sha256(normalize(email))>` | Shares the target budget across source IPs without requiring an existing account. |
| **Address**  | Policies selecting IP, on public or protected endpoints | `ip:<request.ip>`                    | Shares the source-IP budget before authentication.                                |

The three are not alternatives to one another — they are **different axes answering different
attacks**. A single login request may be counted on both the account and the address axis at once.

**Decision: two-stage rate limiting.** Apply IP/target-account limits before
`AuthenticationGuard`, then user-based limits using its verified principal afterward.
The pre-authentication stage protects authentication from excessive traffic; the post-authentication
stage enforces the caller's budget independently of IP changes. The stages share the rate-limit
mechanism; endpoint-specific policy/axis mappings and values are recorded in §4. An endpoint
runs only the axes in its selected policy; there is no mandatory extra IP or principal limiter.

`@Public()` supplies no verified principal, so public endpoints use applicable IP/target-account
limits without a user stage. On login, the target account is input to a limiter, not the caller's
identity; these limits run before password verification in the login handler.

**Decision: each limiter declares the source and required field used to derive its tracker.**
If the field is missing or unusable for key derivation, the limiter throws; it must not silently
skip the counter, switch trackers, or generate a shared empty key. Invalid client input follows
the project's invalid-input taxonomy (HTTP 400); invalid configuration or a missing principal
required after authentication is a system fault. Key extraction and normalization must agree with
the owning login rules; this does not replace validation of the rest of the payload.
A well-formed email with no existing account still receives account limiting; deriving the key
must not require an account-existence query.

Additional counter operations are an accepted cost of this ordering. Do not assume a Redis counter
increment is inherently cheaper than session validation.

**Decision: authentication owns the verified caller principal.** It verifies the access JWT and
required session state. Rate limiting does not read, decode, or verify JWTs. Its user tracker
consumes only the principal published by authentication; the pre-authentication stage uses
IP/target-account trackers. Existing login, refresh, and workflow-proof verification stays in
the owning authentication/workflow code; this decision does not move it into a limiter.

**Integration boundary:** the rate-limit concern owns its policy catalog, guard stages, and
project port/adapter boundary. The adapter integrates the selected ready-made storage package;
guards do not implement a Redis counter algorithm or embed workflow rules.

> **Never:** derive a trusted user tracker from an unverified decoded token. Rate limiting must not
> publish an actor into the audit context; authentication owns verified, session-checked identity.

---

## 4. The policy catalog — an endpoint knows no numbers, only a name

**Decision: use a centralized, named policy catalog.** Every endpoint must explicitly declare a
policy, never inline numbers. Missing or invalid policies fail startup; no implicit default policy
is assigned. Declarations belong on handlers, never controller classes. Only liveness/readiness
probes are explicitly exempt. An active policy must contain at least one limiter; an individual
stage may have none. Numbers live in the central configuration.

**Default-policy decision: use one shared default policy unless a concrete special need exists.**
Do not create a separate policy for every endpoint. An endpoint must explicitly select even the
default policy; this is not an automatic fallback for missing metadata. Create a special policy
only for a concrete protection or independent-budget requirement. `logout` and `logout-all`
select the default policy, without endpoint-specific policies or mandatory extra principal limiters;
preserve their existing authentication and business workflows. Default-policy endpoints share
budgets for the same limiter/tracker (§6). Selected login/refresh policies and health-probe
exemptions remain unchanged.

**Default tracker decision: IP only.** Apply the default policy before authentication
using the trusted full IP for both public and protected endpoints. Do not add a principal limiter
or user/IP fallback. Users behind the same IP and endpoints selecting this policy share its IP
budgets. Consider principal-based protection in a special policy only for a concrete need.

**Default initial values: two IP windows with short blocks.**

| Limiter  | Request limit | Sliding window | Block duration |
| -------- | ------------: | -------------: | -------------: |
| IP short |           600 |     60 seconds |     10 seconds |
| IP long  |         6,000 |    900 seconds |     30 seconds |

These are starting values, not measured capacity; tune for shared-IP traffic. The budget covers
the aggregate of default-policy endpoints for the same IP, not each endpoint separately. Login
and refresh retain independent policy budgets. Requests do not extend active blocks; after
expiry, normal counter checks apply and admission is not guaranteed.

**Remaining general-endpoint mapping: default policy.** Profile/list/detail reads,
account deletion, ban/unban, permission updates, audit reads, and job-operations list/redrive/
discard/status endpoints select the default policy. Preserve existing authentication,
authorization, and workflow rules; add no special job-mutation policy. The protected detailed
health endpoint also selects default; liveness/readiness probes remain explicitly exempt.
Previously selected special mappings take precedence. Default endpoints share the same IP
budgets. Request-rate limits do not establish per-request job-count or payload resource limits.

**Policy-value source decision: one typed TypeScript catalog.** Store `limit`,
`windowSeconds`, and `blockDurationSeconds` values in a readonly object literal checked with
`satisfies` against an exhaustive policy-specific limiter catalog type. Do not use JSON or
per-policy environment variables, and do not hide mismatches with unchecked casts. This catches
missing policy/limiter entries and wrong field types during type checking without a JSON loader,
parser, or external-file schema-validation mechanism.

TypeScript's `number` does not guarantee positivity or integrality. Retain small startup checks
for numeric invariants (positive integer limits, valid positive durations, and library bounds)
and existing endpoint/policy integrity validation. Keep endpoint mappings, tracker sources, and
stage selection in code. Convert seconds to milliseconds at library boundaries.
Policy-value changes require a new build/deployment; do not dynamically reload the file.
Declare ordered counters, tracker sources, stages and numeric budgets together; add policies
only with their complete limiter sets.

**Selected policy identifiers.** The following names identify the agreed policy groups;
endpoint mappings and initial configurations are specified below. Add policies only with their
complete limiter sets, following the implementation plan.

| Enum                                      | Policy value                              |
| ----------------------------------------- | ----------------------------------------- |
| `DEFAULT`                                 | `default`                                 |
| `USER_LOGIN`                              | `user-login`                              |
| `ADMIN_LOGIN`                             | `admin-login`                             |
| `REFRESH_TOKEN`                           | `refresh-token`                           |
| `PASSWORD_CHANGE_EMAIL_CHANGE_INITIATE`   | `password-change-email-change-initiate`   |
| `USER_ACTIVATION_RESEND`                  | `user-activation-resend`                  |
| `USER_REGISTRATION_ADMIN_USER_ACTIVATION` | `user-registration-admin-user-activation` |
| `ADMIN_INVITATION`                        | `admin-invitation`                        |
| `AVATAR_UPLOAD_INITIATE`                  | `avatar-upload-initiate`                  |

Use user/admin prefixes only for policies specific to that principal kind. Shared policies have
no principal-kind prefix. Renaming a policy changes its key identity and starts a new budget.

**Selected limiter identifiers.** Reuse these names within each policy; the policy segment
already provides isolation. Do not encode numeric durations or repeat policy names here.

| Tracker               | Short window           | Long window           |
| --------------------- | ---------------------- | --------------------- |
| IP                    | `ip-short`             | `ip-long`             |
| Target account/email  | `target-account-short` | `target-account-long` |
| Verified principal ID | `principal-short`      | `principal-long`      |

**Endpoint mapping summary.** Paths below are relative to the API global/version prefix;
`{user,admin}` denotes both controller paths. Special mappings take precedence over the general
default group. Each endpoint still declares its selected policy explicitly.

| Policy                                    | Endpoints                                                                                                                                                                 | Stage and trackers             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `user-login`                              | `POST auth/user/login`                                                                                                                                                    | Pre-auth: IP + target email    |
| `admin-login`                             | `POST auth/admin/login`                                                                                                                                                   | Pre-auth: IP + target email    |
| `refresh-token`                           | `POST auth/refresh`                                                                                                                                                       | Pre-auth: IP                   |
| `password-change-email-change-initiate`   | `PATCH {user,admin}/me/password`; `POST {user,admin}/me/email/initiate`                                                                                                   | Post-auth: caller principal ID |
| `user-activation-resend`                  | `POST user/activation/resend`                                                                                                                                             | Pre-auth: IP + target email    |
| `user-registration-admin-user-activation` | `POST user/registration/initiate`; `POST user/registration/complete`; `POST user/activation/complete`; `POST admin/activation/initiate`; `POST admin/activation/complete` | Pre-auth: IP                   |
| `admin-invitation`                        | `POST admin/invite`; `POST admin/:id/re-invite`                                                                                                                           | Post-auth: caller admin ID     |
| `avatar-upload-initiate`                  | `POST {user,admin}/me/avatar/initiate`                                                                                                                                    | Post-auth: caller principal ID |
| `default`                                 | All other API endpoints, including logout/logout-all, email confirmation, profile changes/reads, administration, audit/job operations, and protected detailed health      | Pre-auth: IP                   |
| Explicit exemption                        | Liveness/readiness probes                                                                                                                                                 | No limiter                     |

**Login policy decision: separate user and admin policies.** `auth/user/login` and
`auth/admin/login` use independent policies, budgets, and configurable limits. This allows stricter
admin settings without imposing them on user login. Selected initial values are below. Web and
mobile clients using the same endpoint share its policy, without client-application-specific
budgets. `user-login` and `admin-login` are the selected identifiers.

**Login tracker decision: independent IP and target-account limiters.** Both login
policies require both budgets to pass before password verification. Use the resolved full IP and
SHA-256(normalize(email)) trackers from §6, without checking account existence. Successful and
unsuccessful login requests consume the same budgets; password success does not reset them.
Public login supplies no verified principal, so no principal-ID limiter applies. User and admin
policy budgets remain independent.

**Login window decision: short and long windows for both tracker axes.** Each
login policy has four independent limiters: IP short, IP long, target-account short, and
target-account long. All applicable budgets must pass. Use the selected ready-made Sliding
Window Counter algorithm. Selected initial limits and block durations are below.

**User-login initial limits: balanced values.**

| Limiter              | Request limit | Sliding window |
| -------------------- | ------------: | -------------: |
| IP short             |            60 |     60 seconds |
| IP long              |           300 |    900 seconds |
| Target-account short |             5 |     60 seconds |
| Target-account long  |            20 |    900 seconds |

These are selected starting values, not a standards requirement or a load-tested capacity claim.
The selected Sliding Window Counter's approximate counting semantics apply.

**Admin-login initial limits.**

| Limiter              | Request limit | Sliding window |
| -------------------- | ------------: | -------------: |
| IP short             |            20 |     60 seconds |
| IP long              |           100 |    900 seconds |
| Target-account short |             5 |     60 seconds |
| Target-account long  |            10 |    900 seconds |

These are selected starting values, not a standards requirement or a load-tested capacity claim.
The selected Sliding Window Counter's approximate counting semantics apply.

**User-login block durations.** IP short and target-account short use 60-second
blocks; IP long and target-account long use 300-second blocks. Each duration starts when its
limiter establishes the block. Requests during an active block do not extend it. After expiry,
normal counter checks apply; admission is not guaranteed (§5). These are starting values.

**Admin-login block durations: same durations as user login.** IP short and
target-account short use 60-second blocks; IP long and target-account long use 300-second
blocks. The same non-extending expiry and recheck rules apply. Equal durations do not merge
user and admin budgets; their policies remain independent.

**Refresh tracker decision: IP only, with an independent policy/budget.** Apply
pre-auth limiting using the trusted full IP. Do not verify JWTs in the limiter, hash raw tokens
as trackers, or use unverified user/session IDs. Preserve the existing refresh verification,
rotation, and reuse-detection workflow; add no post-verification session limiter. Choose wider
budgets than login to accommodate automatic refreshes and shared IPs. Limit violations return 429; required storage
unavailability returns 503 (§7).

**Refresh initial values: two IP windows with short blocks.**

| Limiter  | Request limit | Sliding window | Block duration |
| -------- | ------------: | -------------: | -------------: |
| IP short |           300 |     60 seconds |     10 seconds |
| IP long  |         3,000 |    900 seconds |     30 seconds |

These are starting values, not measured capacity; tune for shared-IP traffic. Requests do not
extend active blocks, and expiry does not guarantee admission: normal counter checks resume.
Clients must not discard sessions solely because of 429/503; honor Retry-After for 429.

**Activation resend decision: independent IP and target-account policy.**
`user/activation/resend` selects a special pre-auth policy, requiring both tracker budgets to
pass. Use the trusted full IP and SHA-256(normalize(email)) without account-existence queries.
Count valid email inputs regardless of whether the workflow sends mail. Preserve the workflow's
anti-enumeration 204 behavior; limiter rejection returns 429 and required storage unavailability
returns 503. Budgets are independent of login and default policies. The selected identifier is `user-activation-resend`.

**Activation resend initial values.**

| Limiter              | Request limit | Sliding window | Block duration |
| -------------------- | ------------: | -------------: | -------------: |
| IP short             |            20 |     60 seconds |     60 seconds |
| IP long              |           100 |  3,600 seconds |    300 seconds |
| Target-account short |             1 |     60 seconds |     60 seconds |
| Target-account long  |             5 |  3,600 seconds |    300 seconds |

These are starting values. Count requests, not delivered emails. Approximate Sliding Window
Counter semantics apply: the short account limit does not guarantee a minimum 60-second gap
between sends. Requests do not extend active blocks; expiry triggers normal checks, not
guaranteed admission.

**Registration/activation decision: shared special policy, IP only.** User
`registration/initiate`, `registration/complete`, and `activation/complete`, plus admin
`activation/initiate` and `activation/complete`, share one pre-auth policy and trusted full-IP
budget, independent of login, default, and activation-resend policies. Add no target-account
or principal limiter. A normal registration consumes at least two API calls; retries and calls
whose workflows fail also consume budget. Direct avatar uploads to storage do not pass through
this API limiter. Preserve existing proof/avatar validation, account creation, and activation
job behavior. Preserve user activation's existing password verification and admin activation's
initial-password/proof workflow. Accept that user activation has no cross-IP per-account budget;
the limiter does not verify tokens or derive trackers from unverified claims. The selected identifier is `user-registration-admin-user-activation`.

**Registration/activation initial values.**

| Limiter  | Request limit | Sliding window | Block duration |
| -------- | ------------: | -------------: | -------------: |
| IP short |            20 |     60 seconds |     60 seconds |
| IP long  |           100 |  3,600 seconds |    300 seconds |

These are starting values, not measured capacity. All five endpoints share the same IP budgets;
normal registration consumes at least two calls. Requests do not extend active blocks; normal
counter checks resume after expiry without guaranteeing admission.

**Admin invitation decision: shared special policy, caller principal ID.**
`admin/invite` and `admin/:id/re-invite` share a post-authentication policy keyed by the verified
caller ID. Do not automatically add default/IP limiting. Preserve existing authorization and
business checks. Add no recipient counter or account lookup for tracker derivation. Changing IP
does not grant the caller a new budget; different administrators do not share a recipient budget,
an accepted initial limitation. Count calls reaching the policy check, not delivered emails.
The selected identifier is `admin-invitation`.

**Admin invitation initial values.**

| Limiter                | Request limit | Sliding window | Block duration |
| ---------------------- | ------------: | -------------: | -------------: |
| Caller principal short |             3 |     60 seconds |     60 seconds |
| Caller principal long  |            10 |  3,600 seconds |    300 seconds |

Invite and re-invite calls share the caller's budgets, including calls whose downstream workflow
fails. The tracker is the verified caller admin ID, not the IP or target admin ID. These are
starting values, not measured capacity. Requests do not extend active blocks; normal checks
resume after expiry.

**Avatar upload initiation decision: shared special policy, verified principal ID.**
User and admin `POST me/avatar/initiate` share the same policy definition; each verified
principal ID has its own budget. Apply it after authentication without adding IP/default
limiting. User and admin `PATCH me` select the default policy. Preserve existing upload-proof
and profile/avatar validation. Direct storage uploads do not pass through this API limiter;
file-size and total-storage controls remain separate concerns. The selected identifier is `avatar-upload-initiate`.

**Avatar upload initiation initial values.**

| Limiter         | Request limit | Sliding window | Block duration |
| --------------- | ------------: | -------------: | -------------: |
| Principal short |             3 |     60 seconds |     60 seconds |
| Principal long  |            10 |  3,600 seconds |    300 seconds |

These are starting values, not measured capacity. Count API upload-authorization preparation
calls; direct storage attempts with the same authorization do not consume this API budget.
Requests do not extend active blocks; normal checks resume after expiry.

**Email-change confirmation decision: default policy.** User and admin `POST me/email/confirm`
select the default IP policy, without a special confirmation policy or extra principal limiter.
Preserve existing session, signed-token, ownership, and pending-request validity checks. These
requests share the default IP budget, not the password-proof budget below. Normal 429 and
required limiter-storage-unavailable 503 rules apply.

**Authenticated password-proof policy: shared special policy, verified principal ID only.** User and admin `PATCH me/password` and `POST me/email/initiate` select the
same policy definition. Apply it after authentication using the verified principal ID (§6).
For the same principal, both operations consume a shared budget; different IDs have separate
budgets. Do not automatically add an IP limiter or the default policy to these endpoints.
Preserve password verification in the existing workflow and existing auth/session/audit
identity semantics. The selected identifier is `password-change-email-change-initiate`.

**Authenticated password-proof initial values.**

| Limiter         | Request limit | Sliding window | Block duration |
| --------------- | ------------: | -------------: | -------------: |
| Principal short |             5 |     60 seconds |     60 seconds |
| Principal long  |            10 |    900 seconds |    300 seconds |

Both operations share these budgets for the same principal; successful and unsuccessful calls
count, without resetting on success. These are starting values, not measured capacity. Requests
do not extend active blocks; normal checks resume after expiry without guaranteeing admission.

```
Endpoint  ──selects──▶  Policy  ──consists of──▶  one or more limiters
                                                   (each limiter: window + limit + block duration)
```

**Catalog extensibility:** adding a policy that uses existing tracker sources and stages changes
the catalog and endpoint metadata, without policy-specific branches in the guard. A policy may
contain multiple limiter definitions. The policy/limiter mapping must be exhaustive at compile
time; endpoint metadata completeness is checked at startup.

Special policies address concrete guessing, email-delivery, upload-preparation, or independent
budget needs, as recorded above. Password-guessing protection is not the only reason to select
a special policy. Refresh uses its independent IP budget for processing load; 429/503 does not
establish invalid credentials and must not by itself cause a client to discard its session.

---

## 5. Dual window: burst + sustained

A single window sees only one of the two attack shapes.

| Attack                           | Its need                   | What a single short window does                                                                         |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fast automated burst (seconds)   | Short window, tight limit  | Catches it                                                                                              |
| Slow, sustained guessing (hours) | Long window, total ceiling | **Cannot see it** — the window keeps resetting; the "slow yourself down, stay invisible" gap stays open |

Every selected policy has a short and long limiter for each of its tracker axes. Each applicable
limiter must allow the request, in the sequential order specified in §8. The long window adds a
sustained-traffic budget; neither window guarantees prevention of malicious traffic. With early
rejection, later counters are not updated and earlier mutations are retained (§8).

**Block duration must be stated explicitly** in each limiter's configuration; do not rely on
library defaults. Selected durations are recorded in §4.

**Decision: requests during an active block do not extend its expiry.** Set the expiry
when the block starts. After it expires, apply normal Sliding Window Counter admission; expiry
alone does not guarantee acceptance. Verify this behavior in the selected adapter version without
implementing a custom counter algorithm.

**How long should a block be?** That depends directly on the **tracker axis**:

- If the tracker is **IP**, a long block is a bad trade: the attacker changes address (free), while
  everyone sharing the same NAT gets locked out together.
- If the tracker is **identity** or **account**, a long block becomes meaningful.

---

## 6. Key schema

**Decision: shared budgets per policy.** Endpoints share a budget when their policy,
limiter, and tracker match. Different policies have independent budgets; no cross-policy aggregate
ceiling is included. A custom key scheme with a central key builder is selected:
**`<serviceNamespace>:rl:<policy>:<limiter>:<tracker>`**. **No separate schema-version segment**
is included. This is the logical counter-key scheme; verify any physical key wrapping or companion
keys generated by the selected storage adapter. If Redis Cluster is used, verify that each Lua
operation's keys satisfy hash-slot requirements. Future key-format changes require an explicit migration plan.

- **Prefix (`<serviceNamespace>:rl`)** — the service namespace is environment-configurable;
  `api` is an example value, not a hardcoded identifier. `rl` identifies rate limiting.
  Use service-wide `SERVICE_NAME`, centrally boot-validated and read through ConfigService/ENV. Instances sharing a service budget use the same namespace; independent
  services use distinct namespaces. This separates key names, not Redis failure or flush domains (§7).
- **Policy** — budgets are separated at the policy level.
- **Limiter** — separates independent counters, including short and long windows.
- **Tracker** — the axis from §3.

**Decision: account trackers use the hexadecimal SHA-256 digest of the normalized email.**
Use the same normalization as login. No HMAC or additional secret is used; deriving the tracker
requires no account lookup.

**Decision: IP trackers use the full source address resolved through the trusted-proxy configuration.**
Normalize equivalent address representations, including IPv4-mapped IPv6 to IPv4. Do not group
IPv4 or IPv6 addresses by subnet; IPv6 /64 grouping is not used. Different IPv6 addresses receive
separate budgets, an accepted limitation; account and principal limits remain independent.

**Decision: principal trackers use the verified ID without an admin/user discriminator.** This
choice applies only to rate-limit keys, not authentication, session, or audit identity semantics.
Admin and user tables have independent primary keys; no cross-table uniqueness constraint is
implied by this choice.

**The route/handler name must not enter the key.** Moving between endpoints within one policy
does not grant a fresh budget. Different policies intentionally grant separate budgets; this
design does not establish a single ceiling for the entire authentication surface.

The counter-argument: route-level isolation prevents one endpoint's heavy traffic from locking out
another. That is exactly why the separation happens **at the policy level** — endpoints with
different rhythms go into different policies, while endpoints inside one policy share a budget by
design.

---

## 7. Storage and resilience

**Storage decision: a dedicated rate-limit Redis instance/deployment.** Keep counters
separate from both cache and session Redis to isolate cache eviction and resource contention.
This requires an independently configured service and resource budget, not necessarily a separate
physical host. A prefix or DB index does not provide that resource isolation. Preserve the selected
service namespace in key names (§6).

**Production hosting decision: AWS ElastiCache or a comparable managed service.** Do not
plan self-operated production Redis servers or containers. Select provider and service mode as
deployment decisions; preserve separate cache/session/rate-limit resource and failure isolation. Compose
memory limits describe local containers, not managed-service sizing. Validate package/Lua,
connection topology, eviction, persistence, and failover compatibility when selecting the service.

Do not reset rate-limit state with FLUSHDB/FLUSHALL, including in test cleanup; isolate test
namespaces and clean only owned keys. Cache/session cleaners do not own rate-limit state.
Log rate-limit Redis connection lost/restored transitions under the existing connection-level rules.

**Persistence decision: AOF with `appendonly yes` and `appendfsync everysec`.**
Use a persistent disk/volume to restore counters and active blocks after restart without reviving
expired entries. Accept approximately the last second of changes being lost in a sudden crash;
this is not a zero-data-loss guarantee. These concrete AOF/volume settings describe local Redis.
Do not assume a managed service exposes them or provides equivalent recovery guarantees;
record any required adaptation after provider validation. Session recovery from lost or stale
state retains its own security requirements, separate from accepted rate-limit counter loss.

**Failover decision: accept possible loss of recent counter/block updates.**
Return 503 while Redis is unavailable; resume checks against the available state when the new
primary is ready. Asynchronous replication can lose recent updates, allowing additional budget
or losing recent blocks. Do not assume a fixed one-second loss bound: AOF everysec does not
guarantee replica freshness. This decision does not require deploying replicas or Sentinel;
it defines behavior if the deployment uses failover.

**Memory decision: an explicit `maxmemory` limit with `noeviction`.** Do not evict
counters or blocks early under memory pressure; normal TTL expiration continues. If a recognized
Redis out-of-memory rejection prevents the required limit check, return dependency-unavailable
503, not 429 or admission. Monitor memory usage and rejected writes, and alert before capacity
is exhausted. Size the memory budget for deployment capacity, leaving process/container headroom
for AOF and other Redis memory overhead. Capacity exhaustion may deny legitimate traffic too.

**Selected rate-limit Redis starting budget: `maxmemory 128mb`, container memory limit `512m`.**
Use `noeviction` with the selected AOF everysec and persistent volume. These are deployment
settings, not policy TypeScript configuration. They are starting values, not measured capacity
or an OOM-prevention guarantee; verify headroom under traffic and persistence activity. These
budgets apply to local Compose; select production capacity for the managed service. Initial
alert thresholds are recorded in §11.

**Local Redis memory budgets:**

| Service               |   Redis maxmemory | Container memory limit | Eviction      |
| --------------------- | ----------------: | ---------------------: | ------------- |
| `redis-cache`         | 128 MiB (`128mb`) |       256 MiB (`256m`) | `allkeys-lru` |
| `redis-session`       | 256 MiB (`256mb`) |           1 GiB (`1g`) | `noeviction`  |
| `redis-rate-limiting` | 128 MiB (`128mb`) |       512 MiB (`512m`) | `noeviction`  |

Keep local budgets in `docker-compose.yml`. Cache has no persistence; session uses AOF everysec,
snapshots, and a persistent volume.
These budgets allow headroom for buffers, persistence, and other process overhead; they are
starting values, not measured capacity or an OOM-prevention guarantee. Container limits are
local upper bounds, not reserved memory or production managed-service capacity.

**Timeout/retry decision: bounded waiting without automatic counter-operation retry.**
If the connection is not ready, reject with 503 without offline queuing. Each `consume()` call
bounds waiting for a complete `storage.increment()` operation using
`REDIS_RATE_LIMIT_COMMAND_TIMEOUT=1` in seconds. Script loading and execution share this timeout;
there is no shared stage deadline. A timeout returns 503 and stops the runner's further counter checks.
The timeout does not cancel the package operation: it can continue in the background, including
issuing a later command after script loading. Redis may apply a mutation after the request has
already failed. Do not retry an operation whose outcome is uncertain. A known `NOSCRIPT` fallback
remains owned by the package.

Read this value and Redis connection settings through central boot-validated EnvironmentVariables
and ConfigService + ENV. Convert seconds to milliseconds at library boundaries. Keep connection
establishment timeout separate. Keep offline queueing disabled and do not replay uncertain mutations.
Per-policy limits, windows and block durations remain typed TypeScript configuration (§4).

**Policy-change decision: retain compatible counter state.** A limit-only change
keeps the same key and count and applies the new threshold. A block-duration change preserves
the expiry of active blocks; new blocks use the new duration. Changes to the window or tracker
source that alter state semantics use a new limiter identity: a fresh budget starts and old keys
expire naturally. Add no separate version segment, counter-conversion mechanism, or bulk reset.
Ordinary deployments do not reset counters. Plan deployment transitions to prevent incompatible
configurations from serving traffic concurrently, and verify these semantics when changing the package version.

**Algorithm decision: Sliding Window Counter.** Use the selected Redis adapter's
ready-made algorithm, not a custom counter implementation. Accept weighted approximate counts
across adjacent windows; do not use per-request Sliding Window Log storage. This choice balances
boundary-burst protection and bounded per-tracker storage; validate capacity against workload.
The chosen published version must include the storage adapter's millisecond-TTL correction
referenced in its v2.0.1 release notes. This is an adapter release, not this application's version.
Verify compatibility against the published versions in the lockfile, including on upgrades.

**Package decision: `@nestjs/throttler` with `@nestjs-redis/throttler-storage`.**
The former is the official NestJS package; the latter is the CSenshi/nestjs-redis community adapter,
explicitly selected despite the general preference for official packages. Use the lockfile as the
version source; verify published-version support and compatibility on upgrades.
Use its ready-made counter algorithm rather than implementing one from scratch.

The selected adapter requires the `redis` (node-redis) client. Integrate that client for rate
limiting without treating this decision as a migration of existing cache/session `ioredis` clients.
**Connection ownership decision: our own factory/provider, without changing packages.**
Do not use `@nestjs-redis/client`. Create a separate node-redis factory analogous to the existing
ioredis `createRedisClient`; do not pass the ioredis client directly to the selected storage.
The rate-limit concern owns the connection through a provider/DI token and manages shutdown.
The factory integrates central configuration and connection lost/restored logging; pass its
node-redis instance to the storage adapter. Preserve the selected offline-queue, bounded-wait,
and uncertain-mutation replay rules.
Project integration must cover explicit policy validation, pre/post-authentication guard stages,
tracker/key derivation, required-field errors, outage 503, standard Retry-After, and the project's
error/metrics contracts. Technical rate-limit events do not produce audit records (§9).

Verify the selected algorithm's window alignment and fixed block-expiry behavior against its
published implementation. Selected initial policy values and window configurations are in §4.

**Outage behavior — reject when rate-limit storage is unavailable.** This applies to every
policy, including general-traffic policies: do not proceed without the required counter check. There is no
fail-open path or in-process memory fallback. Rate-limited endpoints therefore depend on Redis
availability; liveness/readiness probes remain exempt (§4).

Translate recognized Redis availability failures, including the explicit memory-capacity rejection
above, to `DependencyUnavailableException` (**503**).
Reserve **429** for an established limit violation (§9); an unavailable counter does not establish
one and must not create a block audit record. Authentication, configuration, other command, programming,
and unknown failures must not be flattened into dependency unavailability; propagate them according
to the project's exception rules.

---

## 8. Request flow — two-stage rate limiting

1. Fastify's `onRequest` hook opens the audit context with transport facts before guards;
   `sourceIp` follows `TRUST_PROXY` (§2).
2. The pre-authentication rate-limit stage applies the policy's IP/target-account limiters.
3. `AuthenticationGuard` verifies credentials and session state before publishing a principal or
   audit actor; `@Public()` skips authentication and supplies no principal.
4. The post-authentication rate-limit stage applies the policy's user limiters using the verified
   principal. Public endpoints have no user stage.
5. `AuthorizationGuard` checks permissions; pipes and the handler follow.

Each rate-limit stage uses the endpoint's explicitly declared policy and checks its applicable
limiters (§5): within limits → continue; exceeded → **429 + Retry-After** (§9);
storage unavailable → **503** (§7). A rejection stops subsequent stages.

**Multiple-limiter decision: sequential checks, stopping at the first rejection or error.** Within the pre-authentication stage use `ip-short` → `ip-long` →
`target-account-short` → `target-account-long`; after authentication use `principal-short`
→ `principal-long`. Run only the limiters present in the selected policy. Do not evaluate
remaining limiters after rejection. Earlier counter mutations remain; do not add cross-counter
transactions or rollback. Existing timeout and dependency-failure rules still apply.

For public login, the IP/target-account limits precede password verification in the handler.
The selected policy-to-stage/tracker mappings are recorded in the API inventory (§4).

---

## 9. The violation flow

**What the client receives:**

- **429** with a **`Retry-After`** header. That header is not an optional courtesy: without it the
  client cannot know when to retry and usually retries immediately — the block then fails to reduce
  the load it exists to reduce.
- The body follows the project's standard error shape (`ErrorDefaultDto`).
- `Retry-After` reports the first rejecting limiter's remaining block time in seconds, without
  exposing its name. It is not the maximum wait across all limiters or a promise of admission
  after that time; a later check may still reject the request.
- **Which limiter fired must not be disclosed.** Keep one client-facing rejection contract
  without revealing the tracker axis, account input, counter key, or limiter name. A target-account
  limit does not establish account existence; valid unknown emails receive the same limiting.

**Recording decision: metrics, without technical rate-limit audit.** Track rejected
requests by policy and Redis availability/capacity failures through metrics and alerts. Do not
promise a distinct block-start count from the standard storage result. Do not add block IDs,
audit deduplication, or durable event delivery for limiter decisions. Neither the limiter nor the
global exception filter writes audit records for 429 responses.

Existing login, authorization, and business-workflow audit rules remain unchanged. A request
rejected before the login handler runs is not a failed-password event. Authentication alone
publishes verified identity into the ambient audit context; limiter trackers never become actors.

---

## 10. Account-level defense — where the throttle layer ends

**Scope decision: rate limiting only in this work.** Implement the selected
IP, target-account, and verified-principal budgets according to the policy inventory. The
account tracker counts requests independently of whether password verification would succeed.

Do not add failed-password counters, progressive delays, device/IP risk scoring, CAPTCHA, or
hard account lockout in this work. Preserve existing login behavior and workflow audit rules.
Additional login defenses require a separate security design; rate limiting does not cover every
credential-stuffing scenario. Account-based request limiting remains in scope.

---

## 11. Observability

**Delivery decision: implement Redis observability for cache, session, and rate limiting
together, after the limiter policies.** Preserve
existing connection logs, health checks, and failure behavior. Production uses ElastiCache or
a comparable managed service (§7), so map provider metrics into the existing Grafana Cloud
alerting approach; do not assume access to production container metrics.

Use early capacity warnings plus critical failure alerts. Initial thresholds, to validate against
the selected provider's capacity definitions and observed traffic:

| Signal                                           | Warning                 | Critical               |
| ------------------------------------------------ | ----------------------- | ---------------------- |
| Session/rate-limit Redis capacity usage          | Above 75% for 5 minutes | Above 90% for 1 minute |
| Memory usage of all three local Redis containers | Above 80% for 5 minutes | Above 90% for 1 minute |
| Writes rejected due to memory exhaustion         | —                       | On first detection     |
| Redis unavailable or monitoring data missing     | —                       | After 1 minute         |
| Persistence failure where persistence is enabled | —                       | On first detection     |

Local container thresholds are not production managed-service thresholds. Select corresponding
provider memory/capacity, availability, persistence, and failover signals during the final work
item. Cache maxmemory saturation or normal eviction alone does not trigger an alert; monitor
cache hit ratio and eviction rate and derive their thresholds from actual traffic.

The project's general rules apply here unchanged; the rate-limiting-specific distinctions are:

| Signal      | For                                                              | Rule                                                                                                                              |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Audit**   | Existing business/security evidence                              | No technical rate-limit audit (§9); existing workflow audit rules remain unchanged.                                               |
| **Metrics** | Alerting and trends: rejected requests by policy, Redis failures | No distinct block-start count is promised; avoid tracker/IP/account metric labels.                                                |
| **Logs**    | Diagnosis                                                        | No additional limiter/filter log per rejection; preserve HTTP access logs. Record outage transitions once per connection episode. |

---

## 12. Compatibility and deployment acceptance

- Verify published package behavior against the lockfile, including on upgrades: algorithm,
  millisecond TTLs, window alignment, fixed blocks, policy changes, physical key wrapping,
  atomicity, and timeout/retry behavior. README or branch-head behavior is insufficient evidence.
- Select ElastiCache or a comparable managed service and mode. Validate topology, TLS/ACL, Lua,
  hash slots if clustered, resource isolation, persistence/recovery, failover and capacity (§7).
  Local Redis tests do not establish production compatibility or session-recovery safety.
- Verify actual web/mobile paths, trusted IPs/CIDRs and header cleanup per environment (§2).
- Validate runtime bootstrap, offline Swagger generation and emitted HTTP schemas as well as
  real Redis effects. Contract fuzzing that only reaches 401/403/404 does not verify authenticated
  success paths; report its actual scope.
- Implement all-three-Redis observability together (§11), mapping provider metrics and validating
  alert thresholds. Do not treat container memory limits as managed-service capacity.

---

## 13. Integration constraints

- Application duration values use seconds; convert to library units at the boundary. Keep config
  field names, environment documentation, and actual conversions consistent.
- Use the trusted `request.ip`; never let arbitrary client headers select a bucket or audit IP.
- Endpoint metadata carries a policy name, not a boolean flag or inline numeric limits.
- If framework guards are extended, inspect the selected version's DI metadata and defaults;
  preserve required injections and override any defaults conflicting with this design, including
  key scope, IP normalization, headers, and limiter ordering.
- Technical limiter rejection produces no audit record. Preserve existing business/auth audit.
- Liveness/readiness are explicitly exempt; protected detailed health uses `default`. Do not let
  dependency failure turn a liveness probe into a request to restart an otherwise healthy process.

---

## 14. Sources

These sources describe framework/library capabilities and operational behavior. The policy
choices and numeric values above are project decisions, not thresholds prescribed by the sources.
Published-version and managed-service validation remains required as stated in §12.

- [NestJS rate limiting](https://docs.nestjs.com/security/rate-limiting)
- [NestJS guards and execution order](https://docs.nestjs.com/guards)
- [Official NestJS throttler package](https://github.com/nestjs/throttler)
- [Selected community Redis storage adapter](https://github.com/CSenshi/nestjs-redis/tree/main/packages/throttler-storage)
- [Redis Lua execution](https://redis.io/docs/latest/develop/programmability/eval-intro/)
- [Redis eviction and memory accounting](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis replication and failover limitations](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
