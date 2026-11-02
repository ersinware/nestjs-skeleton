# Issue #28 — Adım 5: Non-transactional Consumer Effect Ordering Audit

## Kapsam ve snapshot

Branch:

```text
issue#28-queue-consumer-transaction-retry-safety
```

Head:

```text
c697f4fba10ab8684db031663dd6b74516951d98
```

Production'daki **16 non-transactional consumer** için PostgreSQL mutation ile email, Redis, S3 ve diğer effect'lerin sırası incelendi. Bu adımda source/config değişikliği yapılmadı.

---

## A. Genel sonuç

| Grup                   | Sayı | DB davranışı                       | External effect                   | Sonuç           |
| ---------------------- | ---: | ---------------------------------- | --------------------------------- | --------------- |
| Cache invalidation     |    1 | PostgreSQL yok                     | Redis `DEL`                       | **appropriate** |
| Session reconciliation |    2 | Yalnız `SELECT`                    | Redis version update              | **appropriate** |
| Email delivery         |    8 | Yalnız `SELECT`                    | Email                             | **appropriate** |
| Avatar reconciliation  |    4 | `start()` içinde save + audit      | S3; user path'inde Redis eviction | **appropriate** |
| Dead-letter redrive    |    1 | Application aggregate mutation yok | pg-boss queue mutation            | **appropriate** |

```text
unsafe ordering findings: 0
missing start() findings: 0
commit-dependent external effect before commit: 0
```

---

## B. Redis ve email consumer'ları

### Redis

```text
UserCacheConsumer
→ Redis DEL
```

```text
UserSessionConsumer
AdminSessionConsumer
→ PostgreSQL SELECT
→ Redis session-version update
```

Bu path'lerde application-owned PostgreSQL mutation yoktur; `ITransactionPort.start()` gerekmez.

### Email

Aşağıdaki sekiz consumer gerekli state'i PostgreSQL'den yalnız okur ve ardından email gönderir:

```text
AdminInviteConsumer
UserActivationConsumer
UserEmailConfirmationConsumer
AdminEmailConfirmationConsumer
UserRefreshReuseNoticeConsumer
AdminRefreshReuseNoticeConsumer
UserEmailChangeNotificationConsumer
AdminEmailChangeNotificationConsumer
```

Model:

```text
PostgreSQL SELECT
→ email send
```

Aynı handler içinde commit edilmesi gereken DB mutation bulunmadığından transaction açılmaması doğrudur.

Email retry/idempotency güvenliği Adım 6–8 kapsamındadır; burada yalnız ordering değerlendirilmiştir.

---

## C. Avatar consumer'ları

Application-owned PostgreSQL mutation yapan dört non-transactional path:

```text
UserAvatarReplaceConsumer
UserAvatarFinalizeConsumer
AdminAvatarReplaceConsumer
AdminAvatarFinalizeConsumer
```

Normal `PENDING → FINALIZED` akışı:

```text
DB aggregate load
↓
S3 HEAD / copy / reconciliation
↓
domain transition
↓
ITransactionPort.start()
    aggregate save
    audit insert
    user path: durable cache-invalidation job insert
COMMIT
↓
S3 source / obsolete-object cleanup
↓
user path: pipeline Redis eviction
```

`TransactionAdapter.start()` ancak DB transaction commit tamamlandıktan sonra resolve olur. Bu nedenle `start()` sonrasındaki S3 cleanup post-commit'tir.

User avatar command'ları `ICacheInvalidatingCommand` implement eder. `CacheInvalidationBehavior` Redis eviction'ı handler başarıyla döndükten sonra çalıştırdığı için bu effect de post-commit'tir. Admin avatar command'larında Redis eviction yoktur.

### Commit öncesindeki S3 copy

S3 `HEAD` / `copy` işlemleri transaction'dan önce yapılır; ancak bunlar committed DB state'e bağlı destructive cleanup değildir.

Copy sonrası DB commit başarısız olursa destination object korunur ve retry mevcut destination'ı yeniden kullanarak reconciliation'a devam eder. Destructive `deleteObject()` cleanup ise state transition commit edilmeden çalıştırılmaz.

Mevcut avatar handler testleri de:

- DB write failure olduğunda cleanup yapılmadığını,
- save/audit'in obsolete-object cleanup'tan önce gerçekleştiğini,
- commit sonrası cleanup failure retry'ında ikinci DB mutation gerekmediğini

doğrular.

Sonuç olarak kaçınılması gereken model bulunmadı:

```text
BEGIN
DB mutation
S3 cleanup
COMMIT
```

Mevcut mutation path'i:

```text
BEGIN
DB mutation + audit (+ durable cache job)
COMMIT

S3 cleanup
Redis best-effort eviction (user)
```

---

## D. Dead-letter redrive

`DeadLetterRedriveConsumer` application aggregate/audit mutation yapmaz.

```text
RedriveDeadLetterJobsCommandHandler
→ pg-boss redrive(...)
```

Bu pg-boss-owned queue mutation'ıdır; application `ITransactionPort.start()` boundary'si gerektirmez.

---

## E. Correction sonucu

```text
Step 5 correction required: none
```

Adım 9 correction listesine yeni effect-ordering işi eklenmemektedir.

---

## F. Acceptance review

- [x] **Non-transactional consumer paths use `ITransactionPort.start()` for related database writes where a transaction is required, and commit-dependent external effects run only after commit.**

Dört avatar path'i related DB writes için kısa `start()` transaction'ı kullanır ve commit-dependent S3/Redis effect'leri commit sonrasında çalışır. Diğer 12 non-transactional consumer application-owned PostgreSQL mutation yapmadığından `start()` gerektirmez.

```text
Step 5 status: COMPLETE
ordering corrections: 0
```

---

## İncelenen temel alanlar

```text
16 production non-transactional consumer
ilgili command handler'ları
user/admin reader ve writer adapter'ları
TransactionAdapter
CacheInvalidationBehavior
JobQueueOperationsAdapter
4 avatar handler unit test'i
```
