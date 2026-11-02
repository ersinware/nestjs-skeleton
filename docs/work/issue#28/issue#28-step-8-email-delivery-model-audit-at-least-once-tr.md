# Issue #28 — Adım 8: Email Delivery Modeli Audit

## Snapshot

```text
branch: issue#28-queue-consumer-transaction-retry-safety
head:   1570712f70506ed23f310bde4056107e6693429c
```

Sekiz email consumer source, Adım 1–7 kararları ve Resend'in güncel idempotency davranışıyla doğrulandı. Bu adımda source/config değişikliği yapılmadı.

## Sonuç

```text
provider idempotency → yalnız bounded duplicate-risk reduction
exactly-once email   → garanti edilmez
```

- Logical `deliveryId` retry ve DLQ/redrive'da doğru korunuyor.
- Mevcut provider key yanlış: `${queueName}/${deliveryId}/${contentHash}`.
- Hedef key: `${queueName}/${deliveryId}`.
- Dört path normal domain flow'da payload-stable, dört path mutable account state nedeniyle unstable.
- Resend key retention'ı güncel provider dokümanında **24 saat**; bu süre architecture guarantee değil, bounded provider capability'dir.
- Sekiz path'in tamamında retention sonrası redrive duplicate physical email üretebilir.

## Consumer bazında payload stability

`from`, bütün path'lerde process başında okunan `EMAIL_FROM_ADDRESS` değeridir. Aşağıdaki stability, aynı deployment config/template/signing secret altında normal domain flow içindir.

| Consumer                               | `deliveryId`                  | `to / subject / html` kaynağı                      | Sonuç                                                                            |
| -------------------------------------- | ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `AdminInviteConsumer`                  | persisted `inviteId`          | Pending admin email/name + fixed invitation claims | **stable** — pending admin profile/email değiştiremez; re-invite yeni ID üretir. |
| `UserActivationConsumer`               | persisted `activationId`      | Pending user email/name + fixed activation claims  | **stable** — pending user profile/email değiştiremez; resend yeni ID üretir.     |
| `UserEmailConfirmationConsumer`        | `pendingEmailRequestId`       | Stable target/token + current `user.name`          | **unstable** — name değişirse HTML değişir.                                      |
| `AdminEmailConfirmationConsumer`       | `pendingEmailRequestId`       | Stable target/token + current `admin.name`         | **unstable** — name değişirse HTML değişir.                                      |
| `UserRefreshReuseNoticeConsumer`       | committed notice UUID         | Current user email + current name                  | **unstable** — recipient ve HTML değişebilir.                                    |
| `AdminRefreshReuseNoticeConsumer`      | committed notice UUID         | Current admin email + current name                 | **unstable** — recipient ve HTML değişebilir.                                    |
| `UserEmailChangeNotificationConsumer`  | immutable notification row ID | Immutable previous email + `createdAt`             | **stable** — insert-only historical row okunur.                                  |
| `AdminEmailChangeNotificationConsumer` | immutable notification row ID | Immutable previous email + `createdAt`             | **stable** — user path'iyle aynı.                                                |

Invite, activation ve email-confirmation token'ları fixed claim order + `noTimestamp: true` ile yeniden üretildiğinden aynı secret altında deterministiktir.

Config, signing secret veya template/code version değişirse stable dört path'te bile exact provider payload pinlenmez. Adım 9 aynı `deliveryId` için payload semantics'ini ayrı bir delivery ledger oluşturmadan stabil hale getirmelidir.

## Provider key invariant

Mevcut:

```text
${queueName}/${deliveryId}/${sha256(from,to,subject,html)}
```

Bu model same `deliveryId` + different payload durumunu yeni provider identity'ye çevirir; logical-delivery invariant violation görünmez ve ikinci physical send mümkün olur.

Hedef:

```text
${queueName}/${deliveryId}
```

Kurallar:

- retry/redrive aynı key'i kullanır;
- payload drift key'i değiştirmez;
- gerçekten farklı email yeni `deliveryId` alır;
- `contentHash` provider key'den kaldırılır.

## Provider error classification kararı

Resend davranışı:

| Provider sonucu                                                | Application classification                                      | Queue disposition                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Same key + same payload, retention içinde                      | success / cached provider result                                | complete                                                                    |
| `409 invalid_idempotent_request`                               | `ResourceConflictException` — logical-delivery payload conflict | email-send use-case sınırında `TerminalJobException`; normal retry yok, DLQ |
| `409 concurrent_idempotent_requests`                           | `DependencyUnavailableException`                                | retryable                                                                   |
| `429 rate_limit_exceeded`, recognized `5xx`, `resource_locked` | `DependencyUnavailableException`                                | retryable                                                                   |

`EmailerAdapter` doğrudan `TerminalJobException` throw etmemelidir. Provider-specific `invalid_idempotent_request` adapter'da transport-neutral `ResourceConflictException`'a çevrilmeli; send command handler yalnız email port çağrısından gelen bu conflict'i queue terminal disposition'ına çevirmelidir.

Mevcut source'ta:

- `concurrent_idempotent_requests` doğru biçimde retryable;
- `invalid_idempotent_request` generic `SystemException` olur;
- non-transactional worker yalnız `TerminalJobException` için retry'ı atladığından conflict gereksiz retry'lardan sonra DLQ'ya gider.

## Retention ve delayed-redrive kararı

Resend aynı key + payload'ı yalnız 24 saatlik retention içinde deduplicate eder. Retention sonrasında aynı key unutulmuş olabilir ve redrive yeni bir physical email gönderebilir.

Seçilen delivery strategy:

```text
aynı logical delivery retry/redrive
→ aynı deliveryId ve provider key
→ süre geçmiş olsa da gönderimi yeniden dene

provider retention içinde
→ provider dedup duplicate riskini azaltır

provider retention sonrasında
→ duplicate physical email mümkün ve kabul edilen risk
→ at-least-once delivery için redrive engellenmez
```

Application-level `sendAttemptDeadline` veya email delivery ledger eklenmemelidir. Provider çağrısını retention süresi geçti diye bastırmak at-least-once delivery hedefini bozar. Gerçekten farklı bir email gönderilecekse yine yeni logical delivery ve yeni `deliveryId` üretilir.

Bu model exactly-once garanti etmez. Provider retention'ı aşan retry/redrive'da delivery kaybı yerine duplicate-send riski bilinçli olarak kabul edilir.

## Exactly-once claim kontrolü

Yanlış bir explicit exactly-once claim bulunmadı. `agent/jobs-and-messaging.md` provider dedup window'unun exactly-once sağlamadığını zaten söylüyor.

Ancak aynı dokümandaki şu guidance target invariant ile çelişiyor:

```text
changed content counts as a new send
```

Same `deliveryId` altında changed content yeni send değil, invariant violation olmalıdır. Guidance Adım 9/11'de düzeltilmelidir. `docs/idempotency-retry-inventory.md` plan gereği Adım 13'e kadar değiştirilmemelidir.

## Adım 9 correction listesi

1. Provider key'i yalnız `${queueName}/${deliveryId}` yap; `contentHash` ve ilgili export/test beklentilerini kaldır.
2. `invalid_idempotent_request` → `ResourceConflictException` → scoped `TerminalJobException` mapping'ini ekle.
3. `concurrent_idempotent_requests` retryable `DependencyUnavailableException` olarak kalsın.
4. Mutable name/recipient kullanımını mevcut immutable operation verisi veya immutable queue job payload'ı ile stabil hale getir; yeni email delivery kaydı oluşturma.
5. Ayrı delivery ledger/deadline ekleme; retention sonrası retry/redrive'ı engelleme.
6. Regression testleri ekle: exact key, stable/changed payload, iki `409` sınıfı ve DLQ/redrive identity.
7. `agent/jobs-and-messaging.md` ve email port JSDoc'unu at-least-once/duplicate-risk semantics'iyle güncelle; inventory'yi yalnız Adım 13'te güncelle.

## Acceptance review

- [ ] **Email delivery does not claim exactly-once guarantees beyond the provider-supported idempotency behavior, including delayed DLQ/redrive beyond provider retention.**

Audit tamamlandı; criterion mevcut implementation için henüz sağlanmıyor. Key identity, payload stability ve terminal conflict mapping Adım 9'da uygulanmalıdır. Delayed redrive duplicate riski kabul edilir; exactly-once iddiası yoktur.

```text
Step 8 audit status: COMPLETE
acceptance criterion: NOT YET SATISFIED
source/config corrections applied: 0
```

## Temel evidence

```text
src/core/email/email-idempotency-key.util.ts
src/core/email/adapter/emailer.adapter.ts
src/core/email/adapter/emailer.adapter.spec.ts
src/core/email/port/emailer.port.ts
src/core/job-queue/job-queue-feature.module.ts
src/core/security/token/adapter/token.adapter.ts

src/module/user/application/{consumer,command}/**email**
src/module/user/application/command/send-user-activation/**
src/module/user/infrastructure/adapter/user-reader.adapter.ts
src/module/user/infrastructure/adapter/user-email-change-notification-writer.adapter.ts
src/module/user/domain/aggregate/user.aggregate.ts

src/module/admin/application/{consumer,command}/**email**
src/module/admin/application/command/send-admin-invite/**
src/module/admin/infrastructure/adapter/admin-reader.adapter.ts
src/module/admin/infrastructure/adapter/admin-email-change-notification-writer.adapter.ts
src/module/admin/domain/aggregate/admin.aggregate.ts
```

Provider references:

- https://resend.com/changelog/idempotency-keys
- https://resend.com/blog/engineering-idempotency-keys
