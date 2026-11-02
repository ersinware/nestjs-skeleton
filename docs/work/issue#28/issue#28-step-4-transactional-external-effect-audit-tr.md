# Issue #28 — Adım 4: Transaction İçindeki External Effect Audit

## Kapsam ve snapshot

Bu audit, `issue#28-queue-consumer-transaction-retry-safety` branch'inin aşağıdaki head'i üzerinden yapılmıştır:

```text
38ac4f6080fe70aaa4f4d42530f7c17c33edb8d1
```

Bu head, Adım 3 snapshot'ı olan:

```text
d6bda41c73d2015480f736b32e2a49d7d8d3424f
```

üzerine yalnız onaylanmış Adım 3 çalışma dokümanını ekler. Transactional production path source davranışı Adım 3 auditinden sonra değişmemiştir.

Adım 4 kapsamı yalnız production'daki transactional consumer path'leridir:

1. `UserSessionRevocationLogoutAllConsumer`
2. `UserSessionRevocationRefreshReuseConsumer`
3. `AdminSessionRevocationLogoutAllConsumer`
4. `AdminSessionRevocationRefreshReuseConsumer`

Bu path'lerde özellikle şu external effect sınıfları incelenmiştir:

- email,
- Redis,
- S3,
- application/business HTTP,
- başka external service çağrıları,
- `ITransactionPort.join()` resolve olduktan sonra outer transaction commit edilmeden önce çalışan pipeline / worker davranışı.

Established operational exceptions ayrıca ayrılmıştır:

- logging,
- tracing,
- metrics,
- transaction'dan bağımsız commit edilmesi gereken refusal audit.

Bu adımda source/config/repository değişikliği yapılmamıştır.

---

# A. Audit için kritik transaction modeli

Adım 3'te doğrulanan transaction ownership modeli şöyledir:

```text
pg-boss transactional worker
        ↓
outer PostgreSQL transaction begins
        ↓
JobQueueDatabaseAdapter.runInTransactionContext(...)
        ↓
consumer.consume(...)
        ↓
CommandPipeline
        ↓
Revoke*SessionsCommandHandler
        ↓
ITransactionPort.join(...)
        ↓
handler / pipeline / consumer returns
        ↓
pg-boss job completion
        ↓
outer transaction commit
```

Önemli nokta:

```text
join() resolves
≠
transaction committed
```

`TransactionAdapter.join()` yalnız ambient transaction'ın varlığını doğrular ve callback'i mevcut transaction içinde çalıştırır. Commit ownership pg-boss'ta kalır.

Bu nedenle Adım 4 yalnız `join()` callback'inin içine bakmakla sınırlı değildir. Aşağıdaki window ayrıca audit edilmiştir:

```text
join() success
        ↓
handler returns
        ↓
post-handler CommandPipeline behaviors
        ↓
consumer span / worker wrapper
        ↓
pg-boss commit
```

Bu window içinde commit-dependent bir business external effect çalışması da unsafe olurdu.

---

# B. Transactional consumer giriş noktaları

Dört transactional consumer'ın `consume()` implementasyonu yalnız command dispatch eder.

| Consumer | Dispatched command | Consumer içinde direct external effect | Sonuç |
| --- | --- | --- | --- |
| `UserSessionRevocationLogoutAllConsumer` | `RevokeUserSessionsCommand(..., LOGOUT_ALL, ...)` | Yok | **safe** |
| `UserSessionRevocationRefreshReuseConsumer` | `RevokeUserSessionsCommand(..., REFRESH_REUSE, ...)` | Yok | **safe** |
| `AdminSessionRevocationLogoutAllConsumer` | `RevokeAdminSessionsCommand(..., LOGOUT_ALL, ...)` | Yok | **safe** |
| `AdminSessionRevocationRefreshReuseConsumer` | `RevokeAdminSessionsCommand(..., REFRESH_REUSE, ...)` | Yok | **safe** |

Consumer constructor dependency'si yalnız `CommandPipeline`'dır.

Consumer katmanında:

- email port yok,
- Redis/session port yok,
- S3/storage port yok,
- HTTP client/port yok,
- başka business external service port'u yok.

Dolayısıyla transactional worker entry seviyesinde external business effect başlamamaktadır.

---

# C. Revoke command handler dependency audit

## C.1 User handler

`RevokeUserSessionsCommandHandler` yalnız şu dependency'lere sahiptir:

```text
ITransactionPort
IUserWriterPort
IAuditPort
```

Execution:

```text
load user from PostgreSQL
        ↓
user.revokeSessions(reason)
        ↓
join(
    save aggregate + durable jobs
    success audit
)
```

## C.2 Admin handler

`RevokeAdminSessionsCommandHandler` yalnız şu dependency'lere sahiptir:

```text
ITransactionPort
IAdminWriterPort
IAuditPort
```

Execution aynı modeldedir:

```text
load admin from PostgreSQL
        ↓
admin.revokeSessions(reason)
        ↓
join(
    save aggregate + durable jobs
    success audit
)
```

## C.3 Direct external dependency sonucu

Her iki handler'da da aşağıdakiler bulunmamaktadır:

```text
IEmailerPort
ICachePort
ISessionPort
IStoragePort
HTTP client
provider SDK
başka business external-service port'u
```

Bu nedenle handler'ın kendisi transaction içinde email / Redis / S3 / HTTP / başka business external service çağrısı yapmamaktadır.

---

# D. Domain mutation external effect üretmiyor

`User.revokeSessions(...)` ve `Admin.revokeSessions(...)` yalnız:

1. in-memory session/revocation version state'ini değiştirir,
2. `updatedAt` değerini günceller,
3. aggregate içindeki durable job listesine job definition ekler.

`AggregateRoot.addJob(...)` yalnız in-memory array'e job ekler.

`AggregateRoot.pullJobs()` yalnız bu in-memory job listesi üzerinde çalışır.

Dolayısıyla aggregate mutation sırasında:

- Redis çağrısı yok,
- email gönderimi yok,
- S3 çağrısı yok,
- HTTP çağrısı yok,
- provider SDK çağrısı yok.

External effect yerine durable follow-up intent üretilmektedir.

---

# E. Revocation reason bazında üretilen durable follow-up job'lar

## E.1 `LOGOUT_ALL`

User ve admin path'lerinde:

```text
revokeSessions(LOGOUT_ALL)
        ↓
SESSION_RECONCILE durable job
```

üretilir.

Email notice üretilmez.

## E.2 `REFRESH_REUSE`

User path'i:

```text
revokeSessions(REFRESH_REUSE)
        ↓
UserJobQueue.SESSION_RECONCILE
+
UserJobQueue.REFRESH_REUSE_NOTICE
```

Admin path'i:

```text
revokeSessions(REFRESH_REUSE)
        ↓
AdminJobQueue.SESSION_RECONCILE
+
AdminJobQueue.REFRESH_REUSE_NOTICE
```

Bu job'lar aggregate state mutation'ı sırasında yalnız in-memory olarak raise edilir; `UserWriterAdapter.save()` / `AdminWriterAdapter.save()` sırasında PostgreSQL-backed pg-boss queue'ya persist edilir.

---

# F. Follow-up job persistence business external effect değildir

`UserWriterAdapter.save()` ve `AdminWriterAdapter.save()` sırasıyla:

```text
optimistic-lock aggregate write
        ↓
aggregate.pullJobs()
        ↓
JobQueueWriterAdapter.enqueue(...)
```

çalıştırır.

`JobQueueWriterAdapter.enqueue()` pg-boss `insert()` çağrısını:

```text
{ db: fromDrizzle(TOKEN_DATABASE_CLIENT, sql) }
```

ile yapar.

Transactional consumer context'inde `TOKEN_DATABASE_CLIENT` ambient pg-boss transaction executor'ına yönelir.

Bu nedenle follow-up job creation:

- ayrı bir business external service call değildir,
- aynı PostgreSQL transaction'da durable row insert'tir,
- aggregate mutation commit olmazsa follow-up job da commit olmaz,
- doğru outbox/durable-job handoff rolünü görür.

Hedef model mevcut source'ta zaten vardır:

```text
BEGIN
aggregate mutation
create durable follow-up job(s)
success audit
source job completion
COMMIT
```

---

# G. Redis effect separation audit

Transactional revocation path Redis'e doğrudan yazmaz.

Her revocation `SESSION_RECONCILE` job'ı üretir.

## User

```text
UserSessionRevocation*Consumer       transactional: true
        ↓
User aggregate save
        ↓
UserJobQueue.SESSION_RECONCILE job
        ↓
COMMIT
        ↓
UserSessionConsumer                 transactional: false
        ↓
ReconcileUserSessionCommandHandler
        ↓
PostgreSQL current sessionVersion read
        ↓
ISessionPort.setVersion(...)
        ↓
Redis
```

## Admin

```text
AdminSessionRevocation*Consumer     transactional: true
        ↓
Admin aggregate save
        ↓
AdminJobQueue.SESSION_RECONCILE job
        ↓
COMMIT
        ↓
AdminSessionConsumer                transactional: false
        ↓
ReconcileAdminSessionCommandHandler
        ↓
PostgreSQL current sessionVersion read
        ↓
ISessionPort.setVersion(...)
        ↓
Redis
```

`UserSessionConsumer` ve `AdminSessionConsumer` açıkça `transactional = false` tanımlar.

Sonuç:

```text
Redis effect inside shared transaction: 0
```

Redis effect commit-dependent durable follow-up job üzerinden ayrılmıştır.

---

# H. Email effect separation audit

Refresh-token reuse notice doğrudan transactional revocation handler'dan gönderilmez.

## User

```text
UserSessionRevocationRefreshReuseConsumer    transactional: true
        ↓
aggregate save
        ↓
UserJobQueue.REFRESH_REUSE_NOTICE durable job
        ↓
COMMIT
        ↓
UserRefreshReuseNoticeConsumer               transactional: false
        ↓
SendUserRefreshReuseNoticeCommandHandler
        ↓
IEmailerPort.sendEmail(...)
        ↓
Resend
```

## Admin

```text
AdminSessionRevocationRefreshReuseConsumer   transactional: true
        ↓
aggregate save
        ↓
AdminJobQueue.REFRESH_REUSE_NOTICE durable job
        ↓
COMMIT
        ↓
AdminRefreshReuseNoticeConsumer              transactional: false
        ↓
SendAdminRefreshReuseNoticeCommandHandler
        ↓
IEmailerPort.sendEmail(...)
        ↓
Resend
```

`UserRefreshReuseNoticeConsumer` ve `AdminRefreshReuseNoticeConsumer` açıkça `transactional = false` tanımlar.

`EmailerAdapter` provider çağrısını Resend SDK üzerinden yalnız bu downstream non-transactional path'te yapar.

Sonuç:

```text
email provider effect inside shared transaction: 0
```

Email retry / idempotency correctness bu adımın kapsamı değildir; plan gereği Adım 6–8'de ayrıca değerlendirilecektir. Adım 4 yalnız effect'in uncommitted PostgreSQL state'e bağlı biçimde transaction içinde çalışmadığını doğrular.

---

# I. S3 / storage effect audit

Dört transactional revocation path'in:

- consumer'larında,
- command'larında,
- command handler'larında,
- aggregate revocation mutation'larında,
- writer adapter'larında,
- queue writer path'inde

storage/S3 dependency bulunmamaktadır.

Revocation mutation'ları avatar/storage job'ı da üretmez.

Sonuç:

```text
S3/storage effect inside shared transaction: 0
S3/storage follow-up required for these paths: no
```

---

# J. Application/business HTTP ve diğer external service audit

Transactional revocation command path'inde application/business HTTP client veya provider SDK dependency'si yoktur.

Business execution zinciri şu dependency sınırında kalır:

```text
PostgreSQL
+
pg-boss PostgreSQL insert
+
audit PostgreSQL insert
```

Aşağıdaki business provider çağrıları yoktur:

- Resend/email provider,
- S3/AWS storage provider,
- Redis,
- başka HTTP API,
- başka application external service.

### pg-boss notu

`JobQueueWriterAdapter` içindeki `boss.insert(...)` bir provider/business remote effect olarak sınıflandırılmamıştır; explicit Drizzle DB executor ile aynı PostgreSQL transaction'a yapılan durable queue insert'idir.

---

# K. `join()` sonrasındaki uncommitted window audit

Bu Adım 4'ün kritik kısmıdır.

Handler'da success path şu satırla biter:

```text
await transactionPort.join(...)
```

`join()` döndüğünde transaction henüz commit olmamıştır.

Bu nedenle handler sonrasındaki CommandPipeline incelenmiştir.

## K.1 CommandPipeline sırası

```text
TracingBehavior
        ↓
CacheInvalidationBehavior
        ↓
CommandBus / handler
```

## K.2 CacheInvalidationBehavior

Behavior handler success'ten sonra Redis `delete()` çalıştırabilir, ancak yalnız command:

```text
ICacheInvalidatingCommand
```

contract'ını implement ediyorsa.

`RevokeUserSessionsCommand` ve `RevokeAdminSessionsCommand` yalnız `Command<void>` extend eder ve `invalidatedKeys()` implement etmez.

Dolayısıyla revocation handler `join()` resolve ettikten sonra:

```text
CacheInvalidationBehavior
→ Redis effect: none
```

Bu önemlidir; aksi durumda aşağıdaki unsafe model oluşurdu:

```text
join() resolves
        ↓
Redis delete succeeds
        ↓
outer pg-boss transaction commit fails
```

Mevcut revocation command'larında bu failure window yoktur.

## K.3 TracingBehavior

Handler'dan sonra yalnız span lifecycle tamamlanır:

```text
span status / exception metadata
span.end()
```

Bu tracing established exception'ıdır ve business external effect değildir.

## K.4 Consumer-level span

`runInJobConsumerSpan(...)` da consumer başarıyla döndükten sonra span'ı kapatır.

Bu da tracing/observability kapsamındadır.

## K.5 Success-path sonucu

`join()` sonrasında outer transaction commit edilmeden önce:

```text
email:       none
Redis:       none
S3:          none
business HTTP: none
other business external service: none
```

çalışmaktadır.

---

# L. Failure-path operational effect audit

Business success path dışında, failure handling sırasında outer transaction açıkken bazı operational observability effect'leri bulunur.

Bunlar business state/effect olarak sınıflandırılmamıştır.

## L.1 Tracing

Hem CQRS `TracingBehavior` hem `runInJobConsumerSpan(...)` failure'ı span'a kaydeder ve span'ı sonlandırır.

Bu established tracing exception'ıdır.

## L.2 Error reporting: Pino + Sentry

`JobQueueFeatureModule.consume()` reportable bir consumer failure yakaladığında:

```text
ErrorReporterAdapter.report(...)
        ↓
LoggerAdapter.error(...)
        ↓
Pino

+

ExceptionTrackerAdapter.captureException(...)
        ↓
Sentry.captureException(...)
```

çalışabilir ve ardından aynı error tekrar throw edilir.

Bu davranış outer transaction rollback olmadan önce gerçekleşebilir.

Sınıflandırma:

```text
business effect: no
commit-dependent effect: no
operational observability: yes
transaction outcome'u değiştiren awaited remote call: no
```

`IErrorReporterPort.report()` `void` döner; Sentry `captureException()` da bu path'te awaited business call değildir. Failure telemetry'sinin rollback'ten bağımsız görünmesi istenen davranıştır.

Planın established exception listesinde `logging / tracing / metrics` açıkça sayılmıştır. Sentry exception tracking aynı operational-observability concern'inde, logger ile aynı `ErrorReporterAdapter` altında çalıştığı için bu auditte unsafe business external effect olarak sınıflandırılmamıştır.

Bu bir source correction gerektirmemektedir.

## L.3 Metrics

Bu transactional revocation path'lerinde application-level awaited metrics provider çağrısı bulunmamıştır.

Observability instrumentation gelecekte metric export üretebilse bile commit-dependent business effect olarak değerlendirilmemelidir.

---

# M. Refusal audit established exception

Domain mutation `isExceptionWithAudit(...)` failure üretirse handler:

```text
AuditAdapter.record(..., { markExceptionAsAudited: error })
```

çağırır.

Adapter bu durumda:

```text
runOutsideDatabaseTransaction(...)
        ↓
independent primary PostgreSQL audit insert
        ↓
mark exception audited
        ↓
rethrow refusal
        ↓
outer pg-boss transaction rollback
```

modelini uygular.

Bu bilinçli exception'dır:

- business mutation commit olmasa da refusal evidence kalmalıdır,
- outer transaction'dan bağımsız commit edilir,
- email / Redis / S3 / remote business effect değildir,
- Adım 4'ün established refusal-audit exception'ıyla uyumludur.

Sonuç:

```text
refusal audit finding: appropriate established exception
```

---

# N. Consumer bazında external-effect matrisi

| Transactional consumer | PostgreSQL mutation | Durable follow-up | Direct Redis | Direct email | Direct S3 | Direct business HTTP / provider | `join()` sonrası business effect | Sonuç |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `UserSessionRevocationLogoutAllConsumer` | Evet | `SESSION_RECONCILE` | Yok | Yok | Yok | Yok | Yok | **safe** |
| `UserSessionRevocationRefreshReuseConsumer` | Evet | `SESSION_RECONCILE` + `REFRESH_REUSE_NOTICE` | Yok | Yok | Yok | Yok | Yok | **safe** |
| `AdminSessionRevocationLogoutAllConsumer` | Evet | `SESSION_RECONCILE` | Yok | Yok | Yok | Yok | Yok | **safe** |
| `AdminSessionRevocationRefreshReuseConsumer` | Evet | `SESSION_RECONCILE` + `REFRESH_REUSE_NOTICE` | Yok | Yok | Yok | Yok | Yok | **safe** |

Operational exceptions ayrı tutulur:

| Operational effect | Transaction açıkken olabilir mi? | Business effect mi? | Değerlendirme |
| --- | --- | --- | --- |
| CQRS tracing span | Evet | Hayır | Established tracing exception |
| Job producer/consumer span | Evet | Hayır | Established tracing exception |
| Pino failure logging | Evet, failure path | Hayır | Established logging exception |
| Sentry exception capture | Evet, failure path | Hayır | Operational error-reporting / logging concern; safe |
| Refusal audit independent commit | Evet, refusal path | Hayır; durable refusal evidence | Established refusal-audit exception |

---

# O. Unsafe external-effect listesi

Audit sonucunda transactional consumer path'lerinde unsafe business external effect bulunmamıştır.

```text
unsafe email effects:                0
unsafe Redis effects:                0
unsafe S3/storage effects:           0
unsafe business HTTP effects:        0
unsafe other business-service calls: 0
unsafe post-join business effects:   0
---------------------------------------
total unsafe business effects:       0
```

---

# P. Follow-up-job dönüşüm planı

Yeni dönüşüm gerekmemektedir.

Mevcut source zaten hedef modeli kullanmaktadır.

## Redis

```text
transactional state mutation
→ durable SESSION_RECONCILE job
→ commit
→ non-transactional session consumer
→ Redis
```

## Refresh-reuse email

```text
transactional state mutation
→ durable REFRESH_REUSE_NOTICE job
→ commit
→ non-transactional notice consumer
→ Resend email
```

Dolayısıyla:

```text
follow-up-job conversions required: none
```

Adım 9 correction listesine Adım 4 kaynaklı yeni external-effect işi eklenmemelidir.

---

# Q. Adım 4'ün kanıtlamadığı şeyler

Bu audit yalnız transaction/external-effect ordering'i doğrular.

Aşağıdaki sorular ayrı Adım 6–8 kapsamındadır:

- downstream non-transactional Redis effect retry-safe mi?
- email provider çağrısı effect başarılı + job completion başarısız window'unda duplicate üretir mi?
- aynı logical `deliveryId` retry'da aynı payload'ı üretir mi?
- Resend idempotency key doğru logical identity'yi kullanıyor mu?
- `invalid_idempotent_request` / concurrent idempotency failure classification'ı doğru mu?
- `REFRESH_REUSE_NOTICE` consumer'larının `batchSize: 10` değeri final olarak uygun mu?

Bu nedenle Adım 4 sonucu:

```text
transaction ordering safe
```

anlamına gelir; bütün downstream effect'lerin retry/idempotency safety'sinin tamamlandığı anlamına gelmez.

---

# R. Existing regression / integration evidence

`test/module/auth/session-revocation-jobs.e2e-spec.ts` dört source revocation route'u için:

- owner aggregate state'in commit edilmesini,
- success audit'i,
- `SESSION_RECONCILE` follow-up job'ını,
- yalnız `REFRESH_REUSE` için `REFRESH_REUSE_NOTICE` follow-up job'ını,
- yanlış owner/source queue'lara job üretilmemesini

doğrular.

Bu test durable handoff'ın production routing'ini korur.

Adım 3'te incelenen transactional worker coverage ayrıca application write + child job'ın aynı transaction'da commit/rollback olduğunu doğrulamaktadır.

Adım 4 auditinde source-level external-effect bug bulunmadığı için yeni correction-specific regression test zorunluluğu doğmamıştır.

---

# S. Adım 4 bulguları

## Correct

1. Dört transactional consumer'ın hiçbiri direct external business effect çalıştırmıyor.
2. Revocation command handler'larında email, Redis, S3, HTTP veya başka business external-service port'u yok.
3. Aggregate revocation mutation'ları yalnız in-memory state değiştiriyor ve durable job intent raise ediyor.
4. User/admin writer'lar follow-up job'ları aggregate save ile aynı ambient PostgreSQL transaction'da persist ediyor.
5. Session reconciliation Redis effect'i `transactional: false` user/admin session consumer'lara ayrılmış.
6. Refresh-reuse email effect'i `transactional: false` user/admin notice consumer'lara ayrılmış.
7. Transactional revocation path'lerinde S3/storage effect yok.
8. Transactional revocation path'lerinde application/business HTTP/provider effect yok.
9. `join()` sonrasında `CacheInvalidationBehavior` revocation command'ları için Redis eviction çalıştırmıyor; command'lar `ICacheInvalidatingCommand` implement etmiyor.
10. `join()` sonrasında yalnız tracing/worker observability lifecycle'ı tamamlanıyor; business external effect yok.
11. Failure path Pino/Sentry reporting operational observability'dir; business transaction sonucuna bağlı effect değildir.
12. Refusal audit outer transaction dışında bilinçli şekilde independent commit edilir ve established exception ile uyumludur.

## Correction required

```text
none
```

## Follow-up-job conversion required

```text
none
```

---

# T. Acceptance review

- [x] **Transactional consumer paths do not perform external business effects inside the shared transaction or after `join()` under an uncommitted assumption.**

Dört transactional revocation consumer'ın tamamında business mutation ve durable follow-up-job creation PostgreSQL transaction içinde kalır. Redis reconciliation ve refresh-reuse email delivery yalnız transaction commit olduktan sonra çalışabilecek ayrı non-transactional durable consumers'a bırakılmıştır. `join()` resolve olduktan sonra commit öncesi pipeline/worker window'unda da Redis, email, S3, business HTTP veya başka business external-service effect bulunmamaktadır.

```text
Step 4 status: COMPLETE
unsafe external business effects: 0
follow-up-job conversions: 0
Step 4 corrections: 0
```

---

# U. İncelenen source / test dosyaları

## Transaction ownership / worker

```text
src/core/database/adapter/transaction.adapter.ts
src/core/database/database-transaction-context.ts
src/core/job-queue/adapter/job-queue-database.adapter.ts
src/core/job-queue/job-queue-feature.module.ts
```

## Transactional production consumers

```text
src/module/user/application/consumer/user-session-revocation-logout-all.consumer.ts
src/module/user/application/consumer/user-session-revocation-refresh-reuse.consumer.ts
src/module/admin/application/consumer/admin-session-revocation-logout-all.consumer.ts
src/module/admin/application/consumer/admin-session-revocation-refresh-reuse.consumer.ts
```

## Commands / handlers

```text
src/module/user/application/command/revoke-user-sessions/command.ts
src/module/user/application/command/revoke-user-sessions/handler.ts
src/module/admin/application/command/revoke-admin-sessions/command.ts
src/module/admin/application/command/revoke-admin-sessions/handler.ts
```

## Aggregate / persistence / durable-job handoff

```text
src/module/user/domain/aggregate/user.aggregate.ts
src/module/admin/domain/aggregate/admin.aggregate.ts
src/shared/domain/aggregate-root/aggregate-root.ts
src/shared/domain/aggregate-root/principal-aggregate-root.ts
src/module/user/infrastructure/adapter/user-writer.adapter.ts
src/module/admin/infrastructure/adapter/admin-writer.adapter.ts
src/core/job-queue/adapter/job-queue-writer.adapter.ts
src/core/job-queue/job-trace-context.ts
```

## Command pipeline / post-handler behavior

```text
src/core/cqrs/command.pipeline.ts
src/core/cqrs/module.ts
src/core/cqrs/cache-invalidation.behavior.ts
src/core/cqrs/tracing.behavior.ts
```

## Operational observability / refusal audit

```text
src/core/observability/audit/adapter/audit.adapter.ts
src/core/observability/error-reporter/port/error-reporter.port.ts
src/core/observability/error-reporter/adapter/error-reporter.adapter.ts
src/core/observability/logger/adapter/logger.adapter.ts
src/core/observability/exception-tracker/adapter/exception-tracker.adapter.ts
```

## Downstream non-transactional external-effect consumers

```text
src/module/user/application/consumer/user-session.consumer.ts
src/module/admin/application/consumer/admin-session.consumer.ts
src/module/user/application/consumer/user-refresh-reuse-notice.consumer.ts
src/module/admin/application/consumer/admin-refresh-reuse-notice.consumer.ts

src/module/user/application/command/reconcile-user-session/handler.ts
src/module/admin/application/command/reconcile-admin-session/handler.ts
src/module/user/application/command/send-user-refresh-reuse-notice/handler.ts
src/module/admin/application/command/send-admin-refresh-reuse-notice/handler.ts

src/core/security/session/adapter/session.adapter.ts
src/core/email/adapter/emailer.adapter.ts
```

## Existing integration evidence

```text
test/module/auth/session-revocation-jobs.e2e-spec.ts
```

## Previous Issue #28 audit input

```text
docs/work/issue#28/issue#28-step-3-postgresql-transaction-boundary-audit-tr.md
```