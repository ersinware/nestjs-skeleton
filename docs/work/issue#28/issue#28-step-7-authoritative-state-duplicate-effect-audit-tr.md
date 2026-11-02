# Issue #28 — Adım 7: Authoritative-State ve Duplicate-Effect Audit

## Snapshot

Branch:

```text
issue#28-queue-consumer-transaction-retry-safety
```

İncelenen head:

```text
c8a4b2d902dbcad8d29af15f3c7ad2d568209485
```

Production'daki **20 consumer** için:

- retry / DLQ / redrive sırasında current authoritative state'in yeniden okunması,
- repeated external effect guarantee'i,
- logical `deliveryId` semantiği,
- physical pg-boss job identity ile logical delivery identity ayrımı,
- sekiz email path'inde payload stability ve provider identity

source ile birlikte doğrulandı.

Bu adımda source/config değişikliği yapılmadı.

---

## Classification anlamı

- **atomic:** committed business effect ile source-job completion aynı PostgreSQL transaction'ında; aynı delivery için ayrık duplicate-effect window'u yok.
- **idempotent:** aynı effect tekrarlandığında sonuç değişmiyor veya monotonic olarak converge ediyor.
- **deduplicated:** aynı logical delivery'nin ikinci physical effect'i kalıcı olarak engelleniyor.
- **safe-to-repeat:** retry current authoritative state'i yeniden okuyup kalan reconciliation / cleanup işini güvenle tamamlıyor.
- **unsafe:** normal retry veya delayed DLQ/redrive sonrasında duplicate ya da yanlış destructive effect mümkün.

Bounded provider retention yalnız sınırlı süreli dedup sağlar; bu raporda kalıcı `deduplicated` guarantee olarak sayılmamıştır.

---

## Genel sonuç

```text
atomic:         4
idempotent:     3
safe-to-repeat: 3
unsafe:        10
deduplicated:   0 (unbounded guarantee olarak)
```

Authoritative-state sonucu:

```text
gereken current-state read mevcut: 20/20 path
incorrect stale/replica read:        0
fresh read'e rağmen unsafe:         10
```

`fresh read'e rağmen unsafe` grubu:

- sekiz email consumer: provider retention ve/veya same-delivery payload drift;
- iki avatar replace consumer: authoritative read ile destructive delete arasında yeniden seçilme race'i — Issue #30.

Önemli ayrım:

```text
current authoritative state'i yeniden okumak
≠
same logical delivery için payload'ı sabit tutmak
```

Email confirmation ve refresh-reuse notice path'lerinde fresh account state okumak eligibility/contact freshness sağlar; fakat aynı `deliveryId` altında `to` veya HTML değişebildiği için logical-delivery invariant'ını tek başına sağlamaz.

---

## Logical identity ve DLQ/redrive sonucu

### 1. Physical ve logical identity ayrılmıştır

Producer her enqueue için bağımsız physical pg-boss ID üretir:

```text
physical pg-boss job id → uuidv7()
```

Owner-defined work identity ise job data içinde taşınır:

```text
data.deliveryId
data.aggregateId
data.payload? 
```

Kaynak:

- `src/core/job-queue/adapter/job-queue-writer.adapter.ts:45-64`
- `src/shared/domain/job/job-definition.type.ts:20-39`

Consumer boundary physical `job.id`'yi yalnız telemetry için kullanır; business command'lara `job.data` içindeki `deliveryId` / `aggregateId` gider.

Kaynak:

- `src/core/job-queue/job-queue-feature.module.ts:155-180`

### 2. DLQ/redrive logical identity'yi korur

Shared DLQ source payload'ı korur. `boss.redrive(...)` işi recorded source queue'ya geri taşırken application adapter payload'ı yeniden üretmez veya `deliveryId`'yi değiştirmez:

```text
physical pg-boss job id → redrive sırasında değişebilir
data.deliveryId         → korunur
data.aggregateId        → korunur
data.payload            → korunur
```

Kaynak:

- `src/core/job-queue/adapter/job-queue-operations.adapter.ts:178-189`
- Adım 6 DLQ/redrive identity doğrulaması

Bu nedenle email için redrive sonrası da aynı logical identity mevcuttur:

```text
queueName + deliveryId
```

### 3. Producer semantiği genel olarak doğrudur

Email producer'larında bir logical email request/notice için bir `deliveryId` vardır:

- admin invitation → persisted `inviteId`;
- user activation → persisted `activationId`;
- email confirmation → persisted `pendingEmailRequestId`;
- refresh-reuse notice → committed revocation attempt'in ürettiği yeni UUID;
- email-change notice → immutable notification row ID.

Yeni request / resend / yeni security notice gerçekten yeni logical email olduğunda yeni identity üretilir. Transactional revocation retry'ında retry sırasında üretilmiş fakat rollback olmuş UUID'ler committed logical delivery sayılmaz; source completion, state mutation ve follow-up job aynı transaction'da commit olur.

Kaynak örnekleri:

- `src/module/admin/domain/aggregate/admin.aggregate.ts:638-650`
- `src/module/admin/domain/aggregate/admin.aggregate.ts:723-754`
- `src/module/admin/domain/aggregate/admin.aggregate.ts:929-953`
- `src/module/user/domain/aggregate/user.aggregate.ts:621-633`
- `src/module/user/domain/aggregate/user.aggregate.ts:705-736`
- `src/module/user/domain/aggregate/user.aggregate.ts:847-871`

---

## Retry / dedup guarantee tablosu

| # | Consumer | Retry'da authoritative state | Repeated-effect guarantee | DLQ/redrive identity | Sonuç |
| ---: | --- | --- | --- | --- | --- |
| 1 | `UserCacheConsumer` | Current business state gerekmiyor; `aggregateId` cache key'i belirliyor. | Redis `DEL` aynı key için tekrar güvenlidir. | Physical ID'den bağımsız aynı aggregate key'i silinir. | **idempotent** |
| 2 | `UserSessionConsumer` | Primary DB'den current `sessionVersion`, soft-deleted row dahil, her attempt'te yeniden okunur. | Redis Lua `max(stored, candidate)` uygular ve TTL'i kısaltmaz. | `deliveryId` effect identity değildir; aggregate bazında converge eder. | **idempotent** |
| 3 | `AdminInviteConsumer` | Primary DB current eligibility, exact `inviteId`, expiry ve revocation snapshot'ını yeniden kontrol eder. | Normal domain flow'da payload stabil; provider dedup yalnız retention süresi içinde. Delayed redrive duplicate email üretebilir. | `deliveryId = inviteId`; redrive'da korunur. | **unsafe** |
| 4 | `AdminSessionConsumer` | Primary DB current version, soft-deleted row dahil, yeniden okunur. | User path'iyle aynı monotonic Redis update. | Aggregate bazında converge eder. | **idempotent** |
| 5 | `UserActivationConsumer` | Primary DB current eligibility, exact `activationId`, expiry ve revocation snapshot'ını yeniden kontrol eder. | Normal domain flow'da payload stabil; provider retention sonrası duplicate send mümkün. | `deliveryId = activationId`; redrive'da korunur. | **unsafe** |
| 6 | `UserAvatarReplaceConsumer` | Current aggregate ve S3 source/destination state'i yeniden okunur. | Same-delivery copy/commit/cleanup reconciliation tekrar güvenlidir; fakat `SUPERSEDED` read sonrası destructive cleanup eski proof ile yeniden seçilmiş avatarı silebilir. | `deliveryId` immutable S3 version identity'sidir; payload'daki `previousAvatarId` korunur. | **unsafe — #30** |
| 7 | `UserAvatarFinalizeConsumer` | Current aggregate delivery state ve S3 destination/source state'i yeniden okunur. | Existing immutable destination reuse edilir; finalized cleanup tekrarlanabilir; `SUPERSEDED` cleanup yapmaz. | `deliveryId` S3 version identity'si olarak korunur. | **safe-to-repeat** — yalnız #28 failure window'ları; broader lifecycle #30 |
| 8 | `AdminAvatarReplaceConsumer` | User replace ile aynı current aggregate + S3 reconciliation. | Aynı `SUPERSEDED` cleanup + replayable proof race'i vardır. | Logical avatar identity ve cleanup payload'ı redrive'da korunur. | **unsafe — #30** |
| 9 | `AdminAvatarFinalizeConsumer` | Current aggregate ve S3 object state'i yeniden okunur. | User finalize ile aynı scoped reconciliation guarantee'i. | `deliveryId` korunur. | **safe-to-repeat** — yalnız #28 failure window'ları; broader lifecycle #30 |
| 10 | `UserEmailConfirmationConsumer` | Primary DB current eligibility ve exact pending request'i yeniden okur. | Current mutable `user.name` aynı delivery'nin HTML'ini değiştirebilir; mevcut hash key bunu yeni provider identity yapar. Retention sonrası aynı payload da tekrar gönderilebilir. | `deliveryId = pendingEmailRequestId`; redrive'da korunur. | **unsafe** |
| 11 | `UserRefreshReuseNoticeConsumer` | Primary DB current email/name'i yeniden okur. | Recipient ve body aynı delivery altında değişebilir; hash key sessizce değişir. Retention sonrası duplicate de mümkündür. | Committed notice UUID'si redrive'da korunur. | **unsafe** |
| 12 | `AdminEmailConfirmationConsumer` | User confirmation ile aynı current eligibility/request read'i. | Current mutable `admin.name` payload drift üretir; retention riski de vardır. | `deliveryId = pendingEmailRequestId`; korunur. | **unsafe** |
| 13 | `AdminRefreshReuseNoticeConsumer` | Primary DB current email/name'i yeniden okur. | User refresh-reuse path'iyle aynı payload drift ve delayed-redrive riski. | Committed notice UUID'si korunur. | **unsafe** |
| 14 | `UserEmailChangeNotificationConsumer` | Current account yerine doğru olarak immutable notification row okunur. | Domain-derived payload stabil ve retention içinde provider-deduplicated; retention sonrası duplicate physical email mümkündür. | `deliveryId = notification row id`; redrive'da korunur. | **unsafe** |
| 15 | `AdminEmailChangeNotificationConsumer` | User notification ile aynı immutable historical row read'i. | Domain payload stabil; bounded provider dedup unbounded guarantee değildir. | Notification ID korunur. | **unsafe** |
| 16 | `UserSessionRevocationLogoutAllConsumer` | Current aggregate primary writer ile yeniden yüklenir. | Mutation, audit, follow-up jobs ve source completion tek pg-boss transaction'ında commit/rollback olur; committed repeated external effect yoktur. | `deliveryId` audit correlation'dır; ayrı inbox gerekmez. | **atomic** |
| 17 | `DeadLetterRedriveConsumer` | Her batch current eligible DLQ rows üzerinde çalışır; daha önce taşınanlar sonraki batch/retry'da artık eligible değildir. | Batch retry kalan DLQ işlerinden devam eder. | Redrive orchestration physical job'undan bağımsız source jobs kendi logical identity'lerini korur. | **safe-to-repeat** |
| 18 | `AdminSessionRevocationLogoutAllConsumer` | Current aggregate primary writer ile yeniden yüklenir. | User logout-all ile aynı atomic commit/rollback guarantee'i. | `deliveryId` audit correlation'dır. | **atomic** |
| 19 | `UserSessionRevocationRefreshReuseConsumer` | Current aggregate yeniden yüklenir. | Revocation + audit + session-reconcile/notice jobs + source completion atomiktir. | Committed follow-up email yeni logical UUID alır; rollback attempt'leri delivery oluşturmaz. | **atomic** |
| 20 | `AdminSessionRevocationRefreshReuseConsumer` | User refresh-reuse revocation ile aynı. | Aynı atomic guarantee. | Aynı logical-identity semantiği. | **atomic** |

### Transactional consumer scope sınırı

Dört `atomic` classification şu failure window'u kapatır:

```text
same claimed source delivery
→ business mutation commit
→ source completion kaybolur
→ duplicate committed mutation
```

Çünkü business mutation ile completion aynı transaction'dadır. Bu sonuç, application dışından ayrıca enqueue edilmiş iki farklı physical job'ın aynı `deliveryId` ile business-command dedup'una sahip olduğu anlamına gelmez; ayrı persisted inbox bulunmamaktadır. Issue #28'de incelenen queue retry/DLQ-redrive path'i için ek inbox gerekli görünmemiştir.

---

## Authoritative-state ayrıntıları

### Session reconciliation

User/admin readers `TOKEN_DATABASE_CLIENT` kullanır; replica kullanılmaz. Soft-deleted row filtresi özellikle uygulanmaz, böylece deletion sonrasındaki yüksek session floor Redis'e taşınabilir.

Redis `VERSION_LUA`:

```text
version = max(storedVersion, candidateVersion)
ttl     = max(existingTtl, requiredTtl)
```

Bu nedenle duplicate, out-of-order ve concurrent delivery converge eder.

Kaynak:

- `src/module/user/infrastructure/adapter/user-reader.adapter.ts:178-200`
- `src/module/admin/infrastructure/adapter/admin-reader.adapter.ts:173-194`
- `src/core/security/session/adapter/session.adapter.ts:127-138`
- `src/core/security/session/adapter/session.adapter.ts:291-301`

### Email eligibility reads

Admin invite, user activation ve user/admin email confirmation queries primary DB'de:

- account eligibility,
- exact logical request identity,
- expiry,
- revocation snapshot

koşullarını aynı read'de kontrol eder. Stale/replaced/expired delivery send yapmadan tamamlanır.

Kaynak:

- `src/module/admin/infrastructure/adapter/admin-reader.adapter.ts:111-149`
- `src/module/admin/infrastructure/adapter/admin-reader.adapter.ts:247-289`
- `src/module/user/infrastructure/adapter/user-reader.adapter.ts:117-154`
- `src/module/user/infrastructure/adapter/user-reader.adapter.ts:254-295`

Bu check send ile atomik değildir; state read sonrasında değişebilir. Invitation/activation/confirmation link'lerinin consumption path'i authoritative state'i tekrar doğruladığı için stale link yetki vermez. Ancak email external effect'inin duplicate olmamasını bu recheck garanti etmez.

### Historical notification reads

Email-change notification'ın recipient'i current account'tan okunmamalıdır. User/admin consumer'lar doğru olarak immutable notification row'u `deliveryId` ile okur; bu, eski adrese gönderim semantics'ini ve domain payload stability'yi korur.

Kaynak:

- `src/module/user/infrastructure/adapter/user-reader.adapter.ts:297-322`
- `src/module/admin/infrastructure/adapter/admin-reader.adapter.ts:291-316`

### Avatar reconciliation

Dört avatar handler her attempt'te aggregate'i primary writer ile yeniden yükler ve S3 `HEAD` ile source/destination state'ini yeniden okur. Immutable, `deliveryId`-derived destination daha önce yaratılmışsa copy tekrarlanmaz; DB transition commit edilmişse yalnız cleanup resume edilir.

Kaynak:

- `src/module/user/application/command/replace-user-avatar/handler.ts:59-166`
- `src/module/user/application/command/finalize-user-avatar/handler.ts:59-160`
- `src/module/admin/application/command/replace-admin-avatar/handler.ts:62-169`
- `src/module/admin/application/command/finalize-admin-avatar/handler.ts:62-163`

Replace path'lerindeki problem state'in stale kaynaktan okunması değildir. Problem, `SUPERSEDED` sonucundan sonra koşulsuz destructive cleanup yapılması ve delete anında selection'ın hâlâ superseded olduğunun koordineli biçimde garanti edilmemesidir. Bu cross-cutting lifecycle defect'i **Issue #30**'a aittir.

---

## Email logical-delivery invariant sonucu

Hedef:

```text
deliveryId
→ logical email delivery identity

provider idempotency key
→ `${queueName}/${deliveryId}`
```

Mevcut source:

```text
provider idempotency key
→ `${queueName}/${deliveryId}/${sha256(from,to,subject,html)}`
```

Kaynak:

- `src/core/email/email-idempotency-key.util.ts:6-23`
- `src/core/email/adapter/emailer.adapter.ts:45-54`
- `src/core/email/port/emailer.port.ts:31-45`

Sonuç:

| Kural | Mevcut durum | Değerlendirme |
| --- | --- | --- |
| Retry/redrive aynı logical delivery için aynı `deliveryId` kullanmalı | Tüm sekiz consumer job data'daki aynı `deliveryId`'yi geçiriyor; redrive payload'ı koruyor. | **sağlanıyor** |
| Provider key yalnız `${queueName}/${deliveryId}` olmalı | Key'e `contentHash(from,to,subject,html)` ekleniyor. | **sağlanmıyor** |
| Aynı `deliveryId` altında payload semantik olarak stabil olmalı | Dört path normal domain flow'da stabil; dört path mutable account state nedeniyle drift edebilir. Cross-version/config değişikliği ayrıca pinlenmiyor. | **kısmen** |
| Same `deliveryId` + different payload invariant violation olmalı | Hash değişip yeni provider identity üretildiği için conflict görünmez; application invariant'ı enforce edilmiyor. | **sağlanmıyor** |
| Gerçekten farklı email yeni `deliveryId` almalı | Yeni invite/activation/email-change request, refresh-reuse notice ve historical notification yeni identity üretir. | **sağlanıyor** |
| Payload değişikliği provider identity'yi sessizce değiştirmemeli | Mevcut hash tam olarak bunu yapıyor. | **sağlanmıyor** |

### Consumer bazında email payload stability

| Consumer | Logical `deliveryId` | `to` / body kaynağı | Same-delivery normal-domain stability | Delayed DLQ/redrive |
| --- | --- | --- | --- | --- |
| `AdminInviteConsumer` | Persisted `inviteId` | Pending admin email/name + fixed invitation metadata | **stable**: pending account profile/contact mutation'a uygun değildir; re-invite yeni `inviteId` üretir. | Identity korunur; retention sonrası duplicate mümkündür. |
| `UserActivationConsumer` | Persisted `activationId` | Pending user email/name + fixed activation metadata | **stable**: pending user self-service profile mutation'a uygun değildir; resend yeni `activationId` üretir. | Identity korunur; retention sonrası duplicate mümkündür. |
| `UserEmailConfirmationConsumer` | `pendingEmailRequestId` | Fixed pending target/request + **current mutable user name** | **unstable**: name değişikliği aynı logical delivery'nin HTML'ini değiştirir. | Aynı `deliveryId`, farklı hash/key ve duplicate physical send mümkün. |
| `AdminEmailConfirmationConsumer` | `pendingEmailRequestId` | Fixed pending target/request + **current mutable admin name** | **unstable** | User confirmation ile aynı. |
| `UserRefreshReuseNoticeConsumer` | Committed notice UUID | **Current user email + current name** | **unstable**: recipient ve body değişebilir. | Aynı `deliveryId`, farklı payload/hash ve duplicate mümkün. |
| `AdminRefreshReuseNoticeConsumer` | Committed notice UUID | **Current admin email + current name** | **unstable** | User refresh-reuse ile aynı. |
| `UserEmailChangeNotificationConsumer` | Immutable notification row ID | Immutable previous email + createdAt | **stable** | Aynı identity/payload korunur; retention sonrası duplicate yine mümkündür. |
| `AdminEmailChangeNotificationConsumer` | Immutable notification row ID | Immutable previous email + createdAt | **stable** | User notification ile aynı. |

### Stability scope notu

Yukarıdaki `stable` classification current source snapshot'ındaki **normal domain flow** içindir. Exact provider request'in `from / to / subject / html` bütünü ayrıca:

- `EMAIL_FROM_ADDRESS`,
- frontend URL configuration,
- token signing secret / serialization,
- deployed template/code version

değişikliklerinden etkilenebilir. Source aynı logical delivery için payload fingerprint'ini persist etmez veya önceki payload ile karşılaştırmaz. Bu nedenle long-lived DLQ işi farklı deployment/config altında redrive edildiğinde exact payload stability application tarafından genel olarak enforce edilmemektedir.

Bu nokta, normal domain flow'da stabil dört path'in mevcut content-hash modelini doğru yapmaz. Target identity yine yalnız:

```text
${queueName}/${deliveryId}
```

olmalı; payload drift yeni identity üretmek yerine açık invariant violation'a dönüşmelidir.

---

## Provider retention ve guarantee sınırı

Hedef key düzeltildikten sonra bile:

```text
same deliveryId
→ same provider key
→ provider retention süresi içinde dedup
```

fakat:

```text
same deliveryId
→ DLQ'da retention süresinden uzun bekleme
→ redrive
→ provider eski key'i artık hatırlamıyor
→ duplicate physical email mümkün
```

Bu nedenle sekiz email path'inin hiçbiri mevcut application-level kalıcı dedup kaydı veya eşdeğer delayed-redrive stratejisi olmadan DLQ/redrive dahil `deduplicated` sayılamaz.

Exactly-once email guarantee yoktur ve bu adım böyle bir guarantee önermemektedir.

---

## Adım 8/9'a taşınan correction listesi

1. Provider idempotency key'den `contentHash` kaldırılmalı; key yalnız `${queueName}/${deliveryId}` olmalı.
2. `EmailDeliveryIdentity` ve Jobs & Messaging guidance, payload'ın aynı identity altında yeni send sayılabileceğini söylememeli.
3. Aynı key + farklı payload provider sonucunun logical-delivery payload drift olduğu açıkça sınıflandırılmalı; normal retry döngüsüne bırakılmayan terminal application disposition Adım 8'de kesinleştirilmeli.
4. Dört mutable-payload path için aynı `deliveryId` altında stable semantics sağlayan delivery-fact/payload stratejisi belirlenmeli.
5. Normal domain flow'da stabil dört path için cross-version/config drift sınırı implementation ve deployment davranışında açıklaştırılmalı.
6. Sekiz email path için provider retention'ı aşan delayed redrive duplicate-effect stratejisi Adım 8'de belirlenmeli.
7. `UserAvatarReplaceConsumer` / `AdminAvatarReplaceConsumer` remediation'ı Issue #28 içinde yapılmamalı; **Issue #30** ownership'i korunmalı.

---

## Acceptance review

- [ ] **Repeated external effects are idempotent, deduplicated where supported, or explicitly documented as safely repeatable across retry and DLQ/redrive.**

Audit tamamlandı; ancak criterion mevcut implementation için henüz sağlanmıyor:

- sekiz email consumer provider retention ve/veya payload drift nedeniyle `unsafe`;
- iki avatar replace consumer `unsafe — #30`;
- unbounded `deduplicated` consumer yok.

```text
Step 7 audit status: COMPLETE
acceptance criterion: NOT YET SATISFIED
source/config corrections applied: 0
new Issue #28 corrections identified: email identity, payload stability, delayed-redrive strategy
cross-cutting follow-up retained: avatar replace lifecycle → Issue #30
```

---

## İncelenen temel source alanları

```text
docs/work/issue#28/issue#28-queue-consumer-transaction-retry-safety-plan-tr.md
docs/work/issue#28/issue#28-step-1-queue-consumer-inventory-final-tr.md
docs/work/issue#28/issue#28-step-2-transaction-worker-dispatch-audit-tr.md
docs/work/issue#28/issue#28-step-3-postgresql-transaction-boundary-audit-tr.md
docs/work/issue#28/issue#28-step-4-transactional-external-effect-audit-tr.md
docs/work/issue#28/issue#28-step-5-non-transactional-effect-ordering-audit-tr.md
docs/work/issue#28/issue#28-step-6-consumer-retry-failure-window-audit-tr.md

src/core/job-queue/**
src/core/email/**
src/core/security/session/**
src/core/cache/adapter/cache-eviction.adapter.ts
src/shared/domain/job/**

src/module/user/application/consumer/**
src/module/user/application/command/{send-*,reconcile-*,replace-user-avatar,finalize-user-avatar,revoke-user-sessions}/**
src/module/user/infrastructure/adapter/{user-reader,user-writer}.adapter.ts
src/module/user/domain/aggregate/user.aggregate.ts

src/module/admin/application/consumer/**
src/module/admin/application/command/{send-*,reconcile-*,replace-admin-avatar,finalize-admin-avatar,revoke-admin-sessions}/**
src/module/admin/infrastructure/adapter/{admin-reader,admin-writer}.adapter.ts
src/module/admin/domain/aggregate/admin.aggregate.ts

src/module/job-queue-operations/application/consumer/dead-letter-redrive.consumer.ts
src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/**
```
