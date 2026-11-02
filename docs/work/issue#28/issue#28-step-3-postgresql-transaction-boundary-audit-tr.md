# Issue #28 — Adım 3: PostgreSQL Transaction Boundary Audit

## Kapsam ve snapshot

Bu audit, `issue#28-queue-consumer-transaction-retry-safety` branch'inin aşağıdaki head'i üzerinden yapılmıştır:

```text
d6bda41c73d2015480f736b32e2a49d7d8d3424f
```

Production source davranışı Step 1 / Step 2'de kullanılan baseline ile aynıdır; bu branch farkları Issue #28 çalışma dokümanlarıdır.

Adım 3 kapsamı:

- transactional consumer'larda pg-boss transaction → application command → `ITransactionPort.join()` zinciri,
- `join()`'ın gerçekten active pg-boss transaction'a katılması,
- nested `start()` olup olmadığı,
- transactional path'in gereksiz yere uzun olup olmadığı,
- transaction içinde yalnız kısa PostgreSQL işinin bulunması,
- command pipeline'ın transaction ownership ile uyumu,
- non-transactional consumer'larda application-owned PostgreSQL mutation gereken yerlerde `ITransactionPort.start()` kullanımı.

Bu adımda source/config değişikliği yapılmamıştır.

---

# A. Global transaction-boundary modeli

## A.1 Transactional worker transaction'ı application tarafına nasıl taşınıyor?

`JobQueueFeatureModule`, `transactional: true` consumer için pg-boss worker'ı şu modelde başlatır:

```text
pg-boss transactional worker
        ↓
JobQueueTransaction
        ↓
JobQueueDatabaseAdapter.runInTransactionContext(...)
        ↓
runInDatabaseTransactionContext(...)
        ↓
AsyncLocalStorage transactionStorage
        ↓
TOKEN_DATABASE_CLIENT proxy
        ↓
application repository / audit / pg-boss child-job writes
```

`TOKEN_DATABASE_CLIENT` normalde primary Drizzle client'i kullanır. Ambient transaction varsa proxy, bütün database çağrılarını `transactionStorage` içindeki Drizzle executor'a yönlendirir.

Bu nedenle transactional consumer içinde:

```text
application DB read/write
+
audit write
+
aggregate follow-up pg-boss insert
```

aynı pg-boss-owned PostgreSQL transaction connection'ı üzerinden yürüyebilir.

## A.2 `join()` ne yapıyor?

`TransactionAdapter.join()` yeni transaction açmaz ve commit etmez.

Davranışı:

```text
ambient transaction yok
→ reject

ambient transaction var
→ callback'i mevcut transaction context'inde çalıştır
→ outer transaction ownership pg-boss'ta kalır
```

Dolayısıyla `join()` transaction scope'unu oluşturan mekanizma değildir; mevcut owner'a explicit katılım / guard mekanizmasıdır.

Önemli sonuç:

> Transactional consumer'da transaction, `join()` callback'inden önce başlamıştır ve consumer / command pipeline boyunca aktiftir.

Bu yüzden revocation handler'larındaki aggregate `load()` çağrısının `join()` satırından önce olması transaction dışı read anlamına gelmez. Primary DB proxy ambient pg-boss transaction'ı seçtiği için bu read de aynı outer transaction içindedir.

## A.3 `start()` nested transaction'ı engelliyor

`TransactionAdapter.start()`:

```text
ambient transaction varsa
→ SystemException
→ work çalıştırılmaz
→ yeni transaction açılmaz
```

Bu davranış unit ve e2e testlerle korunmaktadır.

Sonuç olarak transactional consumer içinde yanlışlıkla `start()` kullanılması sessiz nested transaction üretmez; fail-fast olur.

---

# B. Transactional consumer audit

Production'da dört transactional consumer vardır:

1. `UserSessionRevocationLogoutAllConsumer`
2. `AdminSessionRevocationLogoutAllConsumer`
3. `UserSessionRevocationRefreshReuseConsumer`
4. `AdminSessionRevocationRefreshReuseConsumer`

Dördü de `batchSize: 1` kullanır ve ilgili user/admin revocation command handler'ına gider.

| Consumer                                     | Handler                             | `join()` active pg-boss tx'e katılıyor mu? | Nested `start()` | Transaction içindeki application işi                                                                                | External business effect transaction içinde mi? | Sonuç           |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------- |
| `UserSessionRevocationLogoutAllConsumer`     | `RevokeUserSessionsCommandHandler`  | Evet                                       | Yok              | User load, session/revocation mutation, optimistic-lock save, follow-up job insert, success audit                   | Hayır                                           | **appropriate** |
| `UserSessionRevocationRefreshReuseConsumer`  | `RevokeUserSessionsCommandHandler`  | Evet                                       | Yok              | User load, session/revocation mutation, optimistic-lock save, session-reconcile + notice job insert, success audit  | Hayır                                           | **appropriate** |
| `AdminSessionRevocationLogoutAllConsumer`    | `RevokeAdminSessionsCommandHandler` | Evet                                       | Yok              | Admin load, session/revocation mutation, optimistic-lock save, follow-up job insert, success audit                  | Hayır                                           | **appropriate** |
| `AdminSessionRevocationRefreshReuseConsumer` | `RevokeAdminSessionsCommandHandler` | Evet                                       | Yok              | Admin load, session/revocation mutation, optimistic-lock save, session-reconcile + notice job insert, success audit | Hayır                                           | **appropriate** |

## B.1 `join()` gerçekten pg-boss transaction'ına katılıyor

Worker callback'i consumer'ı `JobQueueDatabaseAdapter.runInTransactionContext(transaction, ...)` içinde çalıştırır.

Adapter yalnız kendi `JobQueueTransaction` tipini kabul eder ve onun Drizzle executor'ını `transactionStorage` içine yerleştirir.

Handler daha sonra:

```ts
await transactionPort.join(async () => {
    await writerPort.save(...);
    await auditPort.record(...);
});
```

çağrısını yapar.

`join()` ambient transaction yoksa reject ettiği için bu path'in yanlışlıkla standalone çalışması transaction ownership'i sessizce kaybetmez.

## B.2 Aggregate save ve follow-up job aynı transaction'da

`UserWriterAdapter.save()` / `AdminWriterAdapter.save()`:

1. aggregate row'unu optimistic lock ile update eder,
2. aggregate'in `pullJobs()` çıktısını `JobQueueWriterAdapter.enqueue()` ile yazar.

`JobQueueWriterAdapter`, pg-boss insert için:

```text
fromDrizzle(TOKEN_DATABASE_CLIENT)
```

kullanır.

Transactional consumer context'inde `TOKEN_DATABASE_CLIENT` ambient queue transaction'ına yöneldiği için:

```text
aggregate save
+
follow-up job insert
+
success audit
+
source job completion
```

aynı outer pg-boss transaction tarafından commit / rollback edilir.

## B.3 Transaction gereksiz yere uzun mu?

Mevcut transactional revocation path'i şu işlemlerle sınırlıdır:

```text
primary PostgreSQL aggregate read
↓
in-memory domain mutation
↓
PostgreSQL optimistic-lock save
↓
follow-up pg-boss row insert(s)
↓
PostgreSQL audit insert
↓
job completion
```

Transaction içinde aşağıdakiler yoktur:

- email send,
- Redis session mutation,
- S3 operation,
- application HTTP call,
- uzun-running external service call.

Bu nedenle transaction süresi mevcut source'a göre kısa PostgreSQL work ile sınırlıdır.

### `join()` öncesindeki load hakkında not

Handler aggregate'i `join()` callback'inden önce yükler. Bu ilk bakışta transaction dışında görünse de gerçek transaction scope worker entry'de başladığı için load aynı pg-boss transaction'ındadır.

Bu yapı için Step 3 correction gerekmemektedir.

## B.4 Refusal audit istisnası

Domain refusal `isExceptionWithAudit(...)` olduğunda audit:

```text
runOutsideDatabaseTransaction(...)
```

ile ambient queue transaction'dan bilinçli olarak çıkarılır ve bağımsız commit edilir.

Böylece:

```text
refusal audit commits independently
+
consumer failure throws
+
outer pg-boss transaction rolls back
```

modeli korunur.

Bu nested `start()` değildir ve established refusal-audit exception'ıdır.

Outer queue transaction bu kısa bağımsız audit insert'i tamamlanana kadar açık kalabilir; ancak path kısa bir PostgreSQL write ile sınırlıdır ve mevcut tasarım amacıyla uyumludur.

## B.5 Command pipeline transaction ownership ile uyumlu

Command pipeline sırası:

```text
TracingBehavior
    ↓
CacheInvalidationBehavior
    ↓
Command handler
```

Revocation command'ları `ICacheInvalidatingCommand` implement etmez.

Dolayısıyla transactional revocation path'inde `CacheInvalidationBehavior` handler sonrasında Redis effect üretmez.

`TracingBehavior` span açar / kapatır ve error kaydeder; business external effect oluşturmaz.

Sonuç:

```text
pg-boss transaction ownership
+
CommandPipeline
+
Revoke*SessionsCommandHandler.join()
```

birbiriyle uyumludur.

---

# C. Non-transactional consumer audit

Production'daki 16 non-transactional consumer üç gruba ayrılır.

## C.1 Application-owned PostgreSQL mutation yapmayan consumer'lar

Aşağıdaki consumer'lar application-owned PostgreSQL mutation yapmaz; dolayısıyla `ITransactionPort.start()` gerektirmez:

| Consumer                               | PostgreSQL kullanımı        | Effect              | `start()` gerekli mi? | Sonuç           |
| -------------------------------------- | --------------------------- | ------------------- | --------------------- | --------------- |
| `UserCacheConsumer`                    | Yok                         | Redis `DEL`         | Hayır                 | **appropriate** |
| `UserSessionConsumer`                  | Primary read                | Redis version floor | Hayır                 | **appropriate** |
| `AdminSessionConsumer`                 | Primary read                | Redis version floor | Hayır                 | **appropriate** |
| `AdminInviteConsumer`                  | Eligibility/contact read    | Email               | Hayır                 | **appropriate** |
| `UserActivationConsumer`               | Eligibility/contact read    | Email               | Hayır                 | **appropriate** |
| `UserEmailConfirmationConsumer`        | Pending request read        | Email               | Hayır                 | **appropriate** |
| `AdminEmailConfirmationConsumer`       | Pending request read        | Email               | Hayır                 | **appropriate** |
| `UserRefreshReuseNoticeConsumer`       | Current contact read        | Email               | Hayır                 | **appropriate** |
| `AdminRefreshReuseNoticeConsumer`      | Current contact read        | Email               | Hayır                 | **appropriate** |
| `UserEmailChangeNotificationConsumer`  | Immutable notification read | Email               | Hayır                 | **appropriate** |
| `AdminEmailChangeNotificationConsumer` | Immutable notification read | Email               | Hayır                 | **appropriate** |

Bu path'lerde PostgreSQL read ile external effect arasında application transaction açılması gerekmemektedir.

Retry / idempotency doğruluğu ayrı olarak Adım 6–8 kapsamındadır.

## C.2 Application-owned PostgreSQL mutation yapan avatar consumer'ları

Dört avatar consumer non-transactional kalır; çünkü S3 reconciliation transaction dışında yürümelidir.

| Consumer                      | Pre-transaction work             | `start()` içi                                       | Post-transaction work                                    | Sonuç           |
| ----------------------------- | -------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | --------------- |
| `UserAvatarReplaceConsumer`   | DB load + S3 HEAD/copy/reconcile | User save + success audit + aggregate follow-up job | S3 cleanup; ardından pipeline user-cache eviction        | **appropriate** |
| `UserAvatarFinalizeConsumer`  | DB load + S3 HEAD/copy/reconcile | User save + success audit + aggregate follow-up job | S3 source cleanup; ardından pipeline user-cache eviction | **appropriate** |
| `AdminAvatarReplaceConsumer`  | DB load + S3 HEAD/copy/reconcile | Admin save + success audit                          | S3 cleanup                                               | **appropriate** |
| `AdminAvatarFinalizeConsumer` | DB load + S3 HEAD/copy/reconcile | Admin save + success audit                          | S3 source cleanup                                        | **appropriate** |

### Boundary doğrulaması

Avatar handler'larda transaction yalnız state gerçekten değiştiğinde açılır:

```ts
if (changed) {
    await transactionPort.start(async () => {
        await writerPort.save(...);
        await auditPort.record(...);
    });
}
```

Bu doğru boundary'dir.

Özellikle uzun / failure-prone S3 işleri:

```text
HEAD
copy
reconciliation probes
cleanup
```

`start()` callback'i dışında kalır.

Böylece transaction S3 latency boyunca connection / row state tutmaz.

User writer save sırasında üretilen durable cache-repair job'ı da aynı `start()` transaction'ına katılır; `start()` commit ettikten sonra handler devam eder.

Refusal audit gerekiyorsa `markExceptionAsAudited` path'i transaction'dan bağımsız commit edilir.

### Non-transactional read-before-start modeli

Avatar aggregate read'i `start()` öncesinde yapılır. Uzun S3 reconciliation da transaction dışında gerçekleşir.

Mutation aşamasında optimistic locking uygulanır:

```text
loaded aggregate version
+
conditional save
→ stale state ise CONCURRENT_MODIFICATION
```

Bu nedenle uzun external reconciliation'ı transaction içine almak yerine kısa final mutation transaction'ı açılması bilinçli ve doğru modeldir.

## C.3 Dead-letter redrive consumer

`DeadLetterRedriveConsumer` application-owned aggregate / audit mutation yapmaz.

Handler:

```text
RedriveDeadLetterJobsCommandHandler
→ operatorPort.redriveDeadLetterJobs(100)
→ pg-boss redrive operation
```

şeklinde bounded library-owned queue mutation'ları yürütür.

Bu path'in application `ITransactionPort.start()` kullanmaması eksik transaction boundary değildir:

- mutation pg-boss-owned queue state'indedir,
- application aggregate transaction'ı yoktur,
- operation pg-boss adapter sınırı içinde tutulur,
- orchestration job'ın completion transaction'ıyla atomik olmak istenmez; retry kalan DLQ state'inden devam eder.

Dolayısıyla Step 3 acceptance criterion açısından `start()` eklenmesi önerilmemektedir.

---

# D. Nested transaction audit

Production consumer path'lerinde:

```text
transactional consumer → transactionPort.start()
```

desenine rastlanmadı.

Dört transactional revocation handler yalnız `join()` kullanır.

Non-transactional avatar handler'lar yalnız ambient transaction bulunmayan path'te `start()` kullanır.

Infrastructure ayrıca nested `start()`'ı explicit olarak reddeder.

Sonuç:

```text
nested start findings: 0
```

---

# E. Transaction duration / connection ownership sonucu

## Transactional consumers

Outer transaction pg-boss tarafından worker invocation başında açılır ve source job completion ile birlikte settle edilir.

Bu nedenle transaction şu sürenin tamamında açıktır:

```text
consumer dispatch
+
CommandPipeline
+
aggregate read
+
domain mutation
+
join(save + audit + jobs)
+
worker completion
```

Current revocation path'lerinde bu zincir yalnız kısa DB / in-memory iş içerdiği için uygundur.

`join()` callback'inin kısa olması tek başına transaction süresini belirlemez; gerçek outer scope worker callback'idir. Bu distinction dokümantasyonda korunmalıdır.

## Non-transactional consumers

Application transaction yalnız avatar state transition sırasında `start()` ile açılır.

S3 ve email gibi external effect'ler application transaction'ın dışında kalır.

Bu model connection pinning süresini bounded tutar.

---

# F. Existing regression coverage

Mevcut testler boundary modelinin önemli kısımlarını zaten doğrulamaktadır.

`transaction.adapter.spec.ts`:

- ambient transaction içinde nested `start()` reject edilir;
- ambient transaction yokken `join()` reject edilir;
- `join()` yeni transaction açmaz;
- joined failure propagation doğrulanır;
- `start()` commit failure'ı callback başarısından sonra bile caller'a taşır.

`transactional-consumer.e2e-spec.ts`:

- application write + child job aynı transactional worker transaction'ına katılır;
- consumer failure outer transaction'ı rollback eder;
- commit-time failure application write ve child job'ı rollback eder;
- nested `start()` gerçek transaction context'inde reject edilir;
- transactional failure retry'a giderken uncommitted application effect görünmez.

`session-revocation-jobs.e2e-spec.ts`:

- dört production revocation route'unun owner aggregate state'ini,
- success audit'i,
- session reconcile job'ını,
- refresh-reuse notice job'ını

beklenen queue / principal ownership altında commit ettiği doğrulanır.

Step 3 için yeni regression test zorunluluğu doğuran açık boundary bug bulunmamıştır.

---

# G. Step 3 bulguları

## Correct

1. pg-boss transactional worker transaction'ı application Drizzle context'ine doğru aktarılıyor.
2. `ITransactionPort.join()` active ambient transaction'ı doğruluyor ve yeni transaction açmıyor.
3. Dört transactional consumer'ın tamamı `join()` kullanıyor.
4. Transactional consumer path'lerinde nested `start()` yok.
5. Transactional revocation path'leri kısa PostgreSQL / in-memory işle sınırlı; uzun external business effect yok.
6. Command pipeline transactional ownership'i bozacak Redis / S3 / email effect üretmiyor.
7. Refusal audit bilinçli olarak ambient transaction dışında bağımsız commit ediliyor.
8. Non-transactional application-owned PostgreSQL mutation yapan dört avatar path'i doğru şekilde `start()` kullanıyor.
9. Avatar S3 reconciliation `start()` transaction'ının dışında tutuluyor.
10. Read-only / external-effect-only non-transactional consumer'larda gereksiz transaction açılmıyor.
11. Dead-letter redrive library-owned pg-boss mutation olduğundan application `start()` gerektirmiyor.

## Correction required

```text
none
```

Step 3 sonucu Adım 9 correction listesine yeni transaction-boundary işi eklememektedir.

---

# H. Acceptance review

- [x] **Transactional consumer paths perform only short PostgreSQL work and use `ITransactionPort.join()` for application-owned database transactions.**

    Dört transactional revocation consumer'ın tamamı active pg-boss transaction context'inde çalışır; application mutation'ı `join()` altında yapılır ve transaction içinde uzun external business effect bulunmaz.

- [x] **Non-transactional consumer paths use `ITransactionPort.start()` for related database writes where a transaction is required.**

    Application-owned PostgreSQL mutation yapan dört non-transactional avatar consumer'ın tamamı mutation + audit (+ varsa follow-up job) için kısa `start()` transaction'ı kullanır. Diğer non-transactional consumer'lar application DB mutation yapmadığı için `start()` gerektirmez; dead-letter redrive pg-boss-owned mutation sınırıdır.

```text
Step 3 status: COMPLETE
transaction-boundary corrections: 0
```

---

# I. İncelenen source / test dosyaları

## Core transaction / queue infrastructure

```text
src/core/database/module.ts
src/core/database/database-client.token.ts
src/core/database/database-transaction-context.ts
src/core/database/adapter/transaction.adapter.ts
src/core/database/adapter/transaction.adapter.spec.ts

src/core/job-queue/job-queue-feature.module.ts
src/core/job-queue/job-queue-transaction.ts
src/core/job-queue/adapter/job-queue-database.adapter.ts
src/core/job-queue/adapter/job-queue-writer.adapter.ts
src/core/job-queue/adapter/job-queue-operations.adapter.ts

src/core/cqrs/command.pipeline.ts
src/core/cqrs/module.ts
src/core/cqrs/cache-invalidation.behavior.ts
src/core/cqrs/tracing.behavior.ts

src/core/observability/audit/adapter/audit.adapter.ts
```

## Transactional production paths

```text
src/module/user/application/consumer/user-session-revocation-logout-all.consumer.ts
src/module/user/application/consumer/user-session-revocation-refresh-reuse.consumer.ts
src/module/admin/application/consumer/admin-session-revocation-logout-all.consumer.ts
src/module/admin/application/consumer/admin-session-revocation-refresh-reuse.consumer.ts

src/module/user/application/command/revoke-user-sessions/handler.ts
src/module/admin/application/command/revoke-admin-sessions/handler.ts
src/module/user/infrastructure/adapter/user-writer.adapter.ts
src/module/admin/infrastructure/adapter/admin-writer.adapter.ts
```

## Non-transactional production paths

```text
src/module/user/application/command/reconcile-user-session/handler.ts
src/module/admin/application/command/reconcile-admin-session/handler.ts
src/module/admin/application/command/send-admin-invite/handler.ts
src/module/user/application/command/send-user-activation/handler.ts
src/module/user/application/command/send-user-email-confirmation/handler.ts
src/module/admin/application/command/send-admin-email-confirmation/handler.ts
src/module/user/application/command/send-user-refresh-reuse-notice/handler.ts
src/module/admin/application/command/send-admin-refresh-reuse-notice/handler.ts
src/module/user/application/command/send-user-email-change-notification/handler.ts
src/module/admin/application/command/send-admin-email-change-notification/handler.ts

src/module/user/application/command/replace-user-avatar/handler.ts
src/module/user/application/command/finalize-user-avatar/handler.ts
src/module/admin/application/command/replace-admin-avatar/handler.ts
src/module/admin/application/command/finalize-admin-avatar/handler.ts

src/module/job-queue-operations/application/consumer/dead-letter-redrive.consumer.ts
src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/handler.ts
```

## Integration coverage

```text
test/core/job-queue/transactional-consumer.e2e-spec.ts
test/module/auth/session-revocation-jobs.e2e-spec.ts
```