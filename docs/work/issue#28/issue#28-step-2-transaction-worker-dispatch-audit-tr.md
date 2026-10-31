# Issue #28 — Adım 2: Transaction Mode, WorkerOptions ve Dispatch Audit

## Kapsam ve snapshot

Bu audit, `issue#28-queue-consumer-transaction-retry-safety` branch'inin aşağıdaki head'i üzerinden yapılmıştır:

```text
1481d0db98f2e5e0ffc29396c922825ebfc0ce55
```

Branch, source baseline olan aşağıdaki commit'ten yalnızca Issue #28 çalışma dokümanlarıyla ayrılmaktadır:

```text
57434bfff11612cc2d923cb10d37298ff79cb737
```

Bu nedenle Adım 1'de inventory edilen production consumer source davranışı değişmemiştir.

Bu adımda source code, queue configuration veya worker configuration değiştirilmemiştir.

Audit kapsamı:

- 20 production `IJobConsumer`,
- transaction mode (`transactional: true/false`),
- `localConcurrency`,
- `pollingIntervalSeconds`,
- `batchSize`,
- mevcut polling-only dispatch,
- hedef `LISTEN/NOTIFY` dispatch,
- multi-node claim davranışı,
- queue-pool connection budget,
- batch settlement / parallelism davranışı.

Repo `package-lock.json` üzerinde kullanılan pg-boss sürümü:

```text
pg-boss 12.33.2
```

Adım 2 sırasında pg-boss davranışı bu exact sürümün source ve API dokümantasyonu üzerinden ayrıca doğrulanmıştır.

---

# A. Global transaction-mode doğrulaması

## Transactional worker'ın gerçek garantisi

pg-boss `transactional: true` worker'da handler'a açtığı PostgreSQL transaction ile job completion'ı aynı transaction içinde commit eder.

Projede bu transaction:

```text
pg-boss transactional worker
        ↓
JobQueueDatabaseAdapter.beginTransaction()
        ↓
JobQueueTransaction
        ↓
runInTransactionContext()
        ↓
application database AsyncLocalStorage
        ↓
ITransactionPort.join()
```

zinciriyle application-owned PostgreSQL mutation'larına aktarılmaktadır.

Transactional consumer yalnız şu garanti gerçekten gerekliyse kullanılmalıdır:

```text
business PostgreSQL writes
+
durable follow-up jobs / audit
+
job completion
=
same PostgreSQL transaction
```

Bu modelin maliyeti de vardır:

- her in-flight transactional handler queue pool'dan bir PostgreSQL connection'ı transaction süresince pinler;
- `perJobResults` ile birlikte kullanılamaz;
- uzun-running external effect için uygun değildir;
- transaction kısa PostgreSQL işiyle sınırlı tutulmalıdır.

## Dört transactional consumer'ın justification'ı

Şu dört consumer `transactional: true` kullanmaktadır:

1. `UserSessionRevocationLogoutAllConsumer`
2. `AdminSessionRevocationLogoutAllConsumer`
3. `UserSessionRevocationRefreshReuseConsumer`
4. `AdminSessionRevocationRefreshReuseConsumer`

Bu dört consumer'da command şu business transition'ı yapar:

```text
sessionVersion++
revocationVersion = sessionVersion
updatedAt update
+
session reconciliation follow-up job
+
REFRESH_REUSE ise security notice follow-up job
+
success audit
```

Aggregate save sırasında follow-up pg-boss job'ları da aynı ambient transaction üzerinden yazılır.

Bu consumer'ların non-transactional olması halinde şu failure window oluşabilir:

```text
business session revocation commits
        ↓
follow-up jobs / audit commit
        ↓
job completion fails
        ↓
same delivery retries
        ↓
revocation command runs again
        ↓
sessionVersion / revocationVersion advance again
        ↓
new follow-up delivery IDs may be generated
```

Özellikle `REFRESH_REUSE` path'inde retry yeniden yeni notice delivery identity üretebilir.

Dolayısıyla bu dört consumer için atomic consumer write + job completion gereksinimi gerçektir.

### Sonuç

```text
transactional consumers reviewed: 4
transactional mode justified:    4
unnecessary transactional:       0
```

Dördü de `transactional: true` kalmalıdır.

---

# B. Non-transactional consumer mode doğrulaması

Diğer 16 consumer için `transactional: false` seçimi doğrudur.

Ana gerekçeler:

### Redis-only / DB-read + Redis paths

- `UserCacheConsumer`
- `UserSessionConsumer`
- `AdminSessionConsumer`

Bu path'lerde external Redis effect PostgreSQL transaction'a katılamaz.

Session reconciliation yalnız authoritative PostgreSQL state'i okur ve Redis'te monotonic/convergent version-floor update yapar. Job completion ile atomic commit edilmesi gereken business PostgreSQL mutation yoktur.

### Email paths

- `AdminInviteConsumer`
- `UserActivationConsumer`
- `UserEmailConfirmationConsumer`
- `AdminEmailConfirmationConsumer`
- `UserRefreshReuseNoticeConsumer`
- `AdminRefreshReuseNoticeConsumer`
- `UserEmailChangeNotificationConsumer`
- `AdminEmailChangeNotificationConsumer`

Email provider çağrısı external business effect'tir ve PostgreSQL worker transaction'ı içinde yapılmamalıdır.

Bu consumer'ların DB işi ağırlıklı olarak authoritative eligibility/contact read'idir; provider delivery ile job completion arasında exactly-once atomicity sağlanamaz.

Dolayısıyla retry/idempotency modeli non-transactional olarak kurulmalıdır.

### S3 avatar reconciliation paths

- `UserAvatarReplaceConsumer`
- `UserAvatarFinalizeConsumer`
- `AdminAvatarReplaceConsumer`
- `AdminAvatarFinalizeConsumer`

S3 `HEAD` / copy / delete çağrıları external effect'tir.

Bu path'ler:

```text
authoritative state read
+
S3 reconciliation
+
gerekiyorsa ITransactionPort.start() ile local DB mutation/audit/follow-up
+
post-commit cleanup
```

modelini kullanır.

Consumer'ın kendisini transactional yapmak S3 işlemlerini uzun-lived pg-boss transaction içine taşıma riski yaratır ve mevcut reconciliation tasarımını bozar.

### Dead-letter redrive

- `DeadLetterRedriveConsumer`

Redrive consumer'ın görevi bir long transaction içinde tüm DLQ'yu taşımak değildir.

Handler internal bounded batch `100` ile:

```text
redrive batch
commit
redrive batch
commit
...
```

şeklinde ilerler.

Queue `exclusive` olduğu için aynı anda bir redrive orchestration operation çalışır; consumer'ın worker-level transactional olması gereksiz ve uzun transaction riski yaratır.

### Sonuç

```text
non-transactional consumers reviewed: 16
non-transactional mode justified:    16
incorrect non-transactional mode:     0
```

---

# C. Consumer bazında transaction-mode sonucu

|   # | Consumer                                     | Current mode      | Step 2 sonucu       | Justification                                                                               |
| --: | -------------------------------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------- |
|   1 | `UserCacheConsumer`                          | Non-transactional | **keep**            | Redis `DEL` external effect; atomic PostgreSQL mutation yok                                 |
|   2 | `UserSessionConsumer`                        | Non-transactional | **keep**            | Primary DB read + monotonic Redis version update; business DB write yok                     |
|   3 | `AdminInviteConsumer`                        | Non-transactional | **keep**            | DB eligibility read + email provider external effect                                        |
|   4 | `AdminSessionConsumer`                       | Non-transactional | **keep**            | Primary DB read + monotonic Redis update                                                    |
|   5 | `UserActivationConsumer`                     | Non-transactional | **keep**            | DB eligibility read + email provider external effect                                        |
|   6 | `UserAvatarReplaceConsumer`                  | Non-transactional | **keep**            | S3 reconciliation dışarıda; related DB writes gerektiğinde local `start()` transaction'ında |
|   7 | `UserAvatarFinalizeConsumer`                 | Non-transactional | **keep**            | S3 reconciliation + local DB transaction; worker tx uygun değil                             |
|   8 | `AdminAvatarReplaceConsumer`                 | Non-transactional | **keep**            | S3 external effect + local DB transaction                                                   |
|   9 | `AdminAvatarFinalizeConsumer`                | Non-transactional | **keep**            | S3 external effect + local DB transaction                                                   |
|  10 | `UserEmailConfirmationConsumer`              | Non-transactional | **keep**            | DB eligibility read + external email                                                        |
|  11 | `UserRefreshReuseNoticeConsumer`             | Non-transactional | **keep**            | DB contact read + external email                                                            |
|  12 | `AdminEmailConfirmationConsumer`             | Non-transactional | **keep**            | DB eligibility read + external email                                                        |
|  13 | `AdminRefreshReuseNoticeConsumer`            | Non-transactional | **keep**            | DB contact read + external email                                                            |
|  14 | `UserEmailChangeNotificationConsumer`        | Non-transactional | **keep**            | Immutable notification row read + external email                                            |
|  15 | `AdminEmailChangeNotificationConsumer`       | Non-transactional | **keep**            | Immutable notification row read + external email                                            |
|  16 | `UserSessionRevocationLogoutAllConsumer`     | Transactional     | **keep — required** | Revocation mutation + audit + session reconcile job + completion atomic olmalı              |
|  17 | `DeadLetterRedriveConsumer`                  | Non-transactional | **keep**            | Bounded independently committed redrive batches; long worker tx istenmiyor                  |
|  18 | `AdminSessionRevocationLogoutAllConsumer`    | Transactional     | **keep — required** | Revocation mutation + audit + session reconcile job + completion atomic olmalı              |
|  19 | `UserSessionRevocationRefreshReuseConsumer`  | Transactional     | **keep — required** | Revocation + audit + reconcile + notice job + completion atomic olmalı                      |
|  20 | `AdminSessionRevocationRefreshReuseConsumer` | Transactional     | **keep — required** | Revocation + audit + reconcile + notice job + completion atomic olmalı                      |

---

# D. WorkerOptions audit modeli

Mevcut worker ayarları şu üç değerden oluşur:

```ts
{
    localConcurrency,
    pollingIntervalSeconds,
    batchSize,
}
```

Adım 2 değerlendirmesi şu modeli kullanır:

```text
latency requirement
+
expected workload / throughput
+
replica count
+
PostgreSQL / pg-boss pool capacity
+
external dependency capacity
+
retry / settlement semantics
=
workerOptions assessment
```

## Deployment-level concurrency

Mevcut toplam:

```text
23 worker slots / process
```

`R` worker topology replica için:

```text
23 × R
```

Bu sayı 23 dedicated DB connection anlamına gelmez.

Queue pool:

```text
JOB_QUEUE_POOL_SIZE = 20
```

Non-transactional worker external effect sırasında queue-pool connection'ını sürekli tutmaz.

Transactional worker ise handler süresince bir queue-pool connection pinleyebilir.

Mevcut transactional maximum:

```text
4 transactional queues
× localConcurrency 1
=
4 potentially pinned transactional connections / process
```

Hedef LISTEN/NOTIFY ile ayrıca:

```text
1 pinned listener connection / pg-boss instance
```

gerekecektir.

Statik worst-case pinned queue-pool budget:

```text
4 transactional handler connections
+
1 LISTEN connection
=
5 pinned connections
```

20 connection'lık queue pool içinde yaklaşık 15 connection fetch/fail/completion/maintenance gibi diğer queue operasyonlarına kalır.

Bu production kapasite garantisi değildir; ancak mevcut statik topology açısından doğrudan pool exhaustion mismatch'i görünmemektedir.

---

# E. WorkerOptions consumer bazında değerlendirme

Assessment anlamı:

- **appropriate** — mevcut `LC / poll / batch` workload semantiğiyle tutarlı baseline.
- **review** — mevcut değer doğrudan yanlış görünmüyor ancak sonraki retry/idempotency audit sonucu olmadan final kabul edilmemeli.
- **change recommended** — Adım 2'de açık mismatch saptandı.

|   # | Consumer                                     | Current `(LC / poll / batch)` | Workload / pressure                                                | Assessment      | Step 2 workerOptions kararı                                                                                    |
| --: | -------------------------------------------- | ----------------------------: | ------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------- |
|   1 | `UserCacheConsumer`                          |                 `1 / 5s / 20` | Cheap/idempotent Redis delete; DB business write yok               | **appropriate** | Koru. Batch 20 repeated-safe Redis `DEL` için makul                                                            |
|   2 | `UserSessionConsumer`                        |                  `2 / 1s / 5` | Primary DB read + Redis Lua; security/session latency-sensitive    | **appropriate** | Koru. LC2 explicit bounded throughput sağlar; batch5 monotonic effect için güvenli baseline                    |
|   3 | `AdminInviteConsumer`                        |                 `1 / 15s / 5` | Low-frequency email + DB read                                      | **appropriate** | Koru. LC1 provider pressure'ı sınırlar; batch5 deterministic/idempotency-supported delivery için makul         |
|   4 | `AdminSessionConsumer`                       |                  `2 / 1s / 5` | Primary DB read + Redis Lua                                        | **appropriate** | User session ile aynı                                                                                          |
|   5 | `UserActivationConsumer`                     |                  `2 / 2s / 5` | Interactive email; LC2 provider throughput'u artırır               | **appropriate** | Koru. LC2 modest ve explicit; provider capacity production'da doğrulanmalı                                     |
|   6 | `UserAvatarReplaceConsumer`                  |                  `1 / 5s / 1` | S3 + DB/audit; comparatively expensive                             | **appropriate** | Koru. Batch1 storage/reconciliation blast radius'ını sınırlar                                                  |
|   7 | `UserAvatarFinalizeConsumer`                 |                  `1 / 5s / 1` | S3 + DB/audit + durable cache repair                               | **appropriate** | Koru                                                                                                           |
|   8 | `AdminAvatarReplaceConsumer`                 |                  `1 / 5s / 1` | S3 + DB/audit                                                      | **appropriate** | Koru                                                                                                           |
|   9 | `AdminAvatarFinalizeConsumer`                |                  `1 / 5s / 1` | S3 + DB/audit                                                      | **appropriate** | Koru                                                                                                           |
|  10 | `UserEmailConfirmationConsumer`              |                  `1 / 3s / 5` | Interactive email; deterministic token, current name payload'a girer | **appropriate** | WorkerOptions uygun. Payload-stability / provider-key semantiği Adım 7–8 konusu                                |
|  11 | `UserRefreshReuseNoticeConsumer`             |                `1 / 15s / 10` | Security notice; recipient/content current account state'ten gelir | **review**      | Batch10 final kararı Adım 6–8'e bağlı. Payload değişirse provider idempotency key değişebilir                  |
|  12 | `AdminEmailConfirmationConsumer`             |                  `1 / 3s / 5` | Interactive email; deterministic token, current name payload'a girer | **appropriate** | WorkerOptions uygun. Payload-stability / provider-key semantiği Adım 7–8 konusu                                |
|  13 | `AdminRefreshReuseNoticeConsumer`            |                `1 / 15s / 10` | User refresh notice ile aynı                                       | **review**      | Batch10 final kararı Adım 6–8'e bağlı                                                                          |
|  14 | `UserEmailChangeNotificationConsumer`        |                `1 / 30s / 10` | Immutable notification row + stable provider key                   | **appropriate** | LISTEN/NOTIFY yeni delivery latency'sini kaldırır; batch10 stable idempotency evidence nedeniyle savunulabilir |
|  15 | `AdminEmailChangeNotificationConsumer`       |                `1 / 30s / 10` | User email-change ile aynı                                         | **appropriate** | Koru                                                                                                           |
|  16 | `UserSessionRevocationLogoutAllConsumer`     |                  `1 / 1s / 1` | Transactional/security-critical                                    | **appropriate** | Koru. Transactional batch1 invariant doğru                                                                     |
|  17 | `DeadLetterRedriveConsumer`                  |                 `1 / 30s / 1` | Exclusive orchestration; handler internal batch100 drain           | **appropriate** | Koru. Notify ile operator request prompt olacak; worker batch1 doğru                                           |
|  18 | `AdminSessionRevocationLogoutAllConsumer`    |                  `1 / 1s / 1` | Transactional/security-critical                                    | **appropriate** | Koru                                                                                                           |
|  19 | `UserSessionRevocationRefreshReuseConsumer`  |                  `1 / 1s / 1` | Transactional/security-critical + two follow-ups                   | **appropriate** | Koru                                                                                                           |
|  20 | `AdminSessionRevocationRefreshReuseConsumer` |                  `1 / 1s / 1` | Transactional/security-critical + two follow-ups                   | **appropriate** | Koru                                                                                                           |

## WorkerOptions sonucu

Adım 1'de polling-only topology altında daha konservatif olarak `12 appropriate / 8 review` sınıflandırılmıştı.

Adım 2'de exact pg-boss dispatch semantics ve hedef LISTEN/NOTIFY topology'si doğrulandıktan sonra sınıflandırma şu hale gelmiştir:

```text
appropriate:         18
review:               2
change recommended:   0
```

`review` kalan consumer'lar:

1. `UserRefreshReuseNoticeConsumer`
2. `AdminRefreshReuseNoticeConsumer`

Bunun nedeni worker throughput'tan çok, `batchSize: 10` ile external email effect settlement window'unun ve retry sırasında değişebilen content hash / provider idempotency key'in birlikte değerlendirilmesi gereğidir.

Bu konu Adım 6, 7 ve 8 tamamlanmadan kapatılmamalıdır.

---

# F. LISTEN/NOTIFY dispatch audit

## Mevcut durum

Current source **polling-only** çalışmaktadır.

### 1. PgBoss constructor

Mevcut constructor:

```ts
new PgBoss({
    db: jobQueueDatabaseAdapter,
    migrate: ...,
    schedule: false,
})
```

`useListenNotify: true` yoktur.

### 2. Custom DB adapter

`JobQueueDatabaseAdapter` şu pg-boss DB capabilities'i sağlar:

```text
executeSql()
beginTransaction()
```

Ancak:

```text
listen()
```

implementation'ı yoktur.

pg-boss 12.33.2 custom DB adapter ile LISTEN/NOTIFY için `listen(channel, onNotification, onReconnect)` capability'si beklemektedir.

### 3. Queue provisioning

`provisionJobQueue()` şu mutable queue config'lerini reconcile eder:

```text
retryLimit
retryDelay
retryBackoff
deadLetter
```

Ancak:

```text
notify
```

create/update/reconciliation modeline dahil değildir.

### 4. Warning observability

Current code:

```text
boss.on('error', ...)
```

kullanır.

Repo'da `boss.on('warning', ...)` bulunmamıştır.

pg-boss listener kurulamazsa `listen_notify_unavailable` warning üretir. Bu warning mevcut application observability path'inde açıkça ele alınmamaktadır.

### Dispatch sonucu

LISTEN/NOTIFY hedefi doğrudur fakat şu an uygulanmamıştır.

Bu nedenle Adım 9 için gerçek implementation gap vardır.

---

# G. pg-boss 12.33.2 LISTEN/NOTIFY davranışının doğrulanması

## Yeni immediately-runnable job

Queue:

```text
notify: true
```

ve instance:

```text
useListenNotify: true
```

ise immediately-runnable job insert'i transaction commit ile birlikte queue adı payload'ı taşıyan PostgreSQL `NOTIFY` üretir.

NOTIFY:

```text
job ownership
```

değildir.

Yalnız:

```text
fetch now
```

wake-up hint'idir.

Worker'lar yine normal pg-boss PostgreSQL fetch / claim / locking ile job alır.

## Multi-node

Örnek:

```text
PostgreSQL NOTIFY
    ├── Node A
    ├── Node B
    └── Node C
```

Listening instance'lar notification'ı alabilir ve kendi local worker'larını uyandırabilir.

Sonrasında:

```text
A ─┐
B ─┼─→ PostgreSQL claim
C ─┘
```

olur.

Aynı job için yalnız claim'i başarıyla alan worker execution attempt'i çalıştırır.

Dolayısıyla broadcast notification duplicate ownership mekanizması değildir.

## Listener reconnect

pg-boss custom `listen()` contract'ında adapter'ın başarılı re-subscribe sonrası `onReconnect()` çağırması beklenir.

pg-boss reconnect sonrası notify-enabled worker'ları bir kez force-fetch ederek connection outage sırasında kaçırılmış notification gap'ini recover eder.

## Listener unavailable

Listener unavailable olduğunda worker:

```text
pollingIntervalSeconds
```

cadence'ine döner.

Bu mevcut consumer değerlerinin listener-unavailable fallback olarak korunmasını doğrular.

---

# H. Önemli Adım 2 düzeltmesi — universal 30s backstop doğru değil

Step 1 sırasında başlangıç modeli olarak:

```text
notifyPollingIntervalSeconds: 30
```

tüm notify-enabled queue'lar için düşünülmüştü.

Adım 2'de pg-boss 12.33.2 retry ve redrive source davranışı incelendiğinde bunun **global tek değer olarak doğru olmadığı** sonucuna varıldı.

## Neden?

### 1. NOTIFY yalnız immediately-runnable insert için

pg-boss notify-enabled queue'da yeni job insert ederken yalnız:

```text
start_after <= now
```

olan inserted job için NOTIFY üretir.

Future / delayed job maturity notification üretmez.

### 2. Retry'lar future `start_after` ile yaratılıyor

Repo queue defaults:

```text
retryLimit: 10
retryDelay: 15
retryBackoff: true
```

Failure sonrası pg-boss retry row'unu future `start_after` ile yeniden oluşturur.

Örnek:

```text
attempt fails
    ↓
retry start_after = now + backoff
    ↓
job henüz runnable değil
    ↓
vade geldi
    ↓
yeni NOTIFY yok
    ↓
worker polling ile bulur
```

LISTEN/NOTIFY aktifken worker normalde `pollingIntervalSeconds` yerine:

```text
notifyPollingIntervalSeconds
```

kullanır.

Universal `30s` kullanılırsa security-critical retry, kendi backoff süresi dolduktan sonra ayrıca yaklaşık `0–30s` discovery gecikmesi yaşayabilir.

### 3. Redrive destination jobs

pg-boss 12.33.2 `redrive()` implementation'ı destination/source queue'lara job'ları SQL ile yeniden insert eder; incelenen redrive SQL path'inde destination queue için `pg_notify` üretilmez.

Bu nedenle redriven job'ın prompt discovery'si de ilgili destination worker'ın polling backstop'una bağlı olabilir.

## Sonuç

`notifyPollingIntervalSeconds` yalnız "missed NOTIFY safety net" değildir.

Aynı zamanda:

- future/deferred maturity,
- retry maturity,
- redrive sonrası runnable job discovery

için correctness/latency path'idir.

Bu nedenle:

```text
notifyPollingIntervalSeconds = 30 for every queue
```

kararı **revize edilmelidir**.

---

# I. Standart polling profilleri

Adım 2 sonunda polling cadence değerleri consumer bazında serbest sayı olarak bırakılmayacak; dört standart workload profiline bağlanacaktır.

Kararlaştırılan hedef:

| Profile    | `pollingIntervalSeconds` | `notifyPollingIntervalSeconds` | Kullanım amacı                                                                                                                       |
| ---------- | -----------------------: | -----------------------------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `critical` |                     `1s` |                           `5s` | Session / security remediation; listener arızasında agresif fallback, healthy LISTEN modunda kısa retry / delayed / redrive backstop |
| `high`     |                     `5s` |                          `10s` | Interactive veya hızlı eventual-reconciliation işleri                                                                                |
| `medium`   |                    `15s` |                          `30s` | Interactive fakat retry gecikmesine toleranslı işler; LISTEN healthy iken initial delivery immediate                                 |
| `low`      |                    `30s` |                          `60s` | Non-blocking notification / deferred / maintenance işleri                                                                            |

Semantics:

```text
pollingIntervalSeconds
→ LISTEN/NOTIFY unavailable olduğunda fallback cadence

notifyPollingIntervalSeconds
→ LISTEN/NOTIFY healthy iken retry / delayed / redrive maturity backstop cadence
```

Tüm profillerde `notifyPollingIntervalSeconds`, listener-unavailable fallback olan `pollingIntervalSeconds` değerinden daha seyrektir. Böylece immediately-runnable yeni job NOTIFY ile anında wake-up alırken healthy LISTEN modunda idle polling yükü azaltılır. Retry / delayed / redrive maturity ise profile göre 5–60 saniyelik bounded backstop polling ile keşfedilir.

## Consumer → profile eşlemesi

### `critical`

- `UserSessionConsumer`
- `AdminSessionConsumer`
- `UserSessionRevocationLogoutAllConsumer`
- `AdminSessionRevocationLogoutAllConsumer`
- `UserSessionRevocationRefreshReuseConsumer`
- `AdminSessionRevocationRefreshReuseConsumer`

### `high`

- `UserCacheConsumer`

### `medium`

- `UserActivationConsumer`
- `UserAvatarReplaceConsumer`
- `UserAvatarFinalizeConsumer`
- `AdminAvatarReplaceConsumer`
- `AdminAvatarFinalizeConsumer`
- `UserEmailConfirmationConsumer`
- `AdminEmailConfirmationConsumer`

### `low`

- `AdminInviteConsumer`
- `UserRefreshReuseNoticeConsumer`
- `AdminRefreshReuseNoticeConsumer`
- `UserEmailChangeNotificationConsumer`
- `AdminEmailChangeNotificationConsumer`
- `DeadLetterRedriveConsumer`

Bu standardizasyon mevcut değerlerin yanlış olduğu anlamına gelmez. Örneğin activation / email-confirmation path'lerindeki `2s` / `3s` değerlerin `medium = 15s` fallback'e, admin-invite / refresh-reuse notice path'lerindeki `15s` değerlerin `low = 30s` fallback'e normalize edilmesi bir **policy standardization** değişikliğidir; Adım 2 `change recommended` mismatch sayısını artırmaz. Healthy LISTEN/NOTIFY altında immediately-runnable initial delivery bu fallback sürelerini beklemez.

### Interface sonucu

Adım 9'da worker-level explicit profile veya aynı semantiği taşıyan config modellenmelidir.

Örnek hedef:

```ts
workerOptions: {
    profile: 'critical' | 'high' | 'medium' | 'low',
    localConcurrency,
    batchSize,
}
```

`pollingIntervalSeconds` ve `notifyPollingIntervalSeconds` consumer tarafından ayrıca verilmemelidir. Bunlar merkezi profile mapping'den türetilmelidir:

```text
critical → 1s / 5s
high     → 5s / 10s
medium   → 15s / 30s
low      → 30s / 60s
```

Böylece profile tek source of truth olur; consumer'lar rastgele ara polling değerleri tanımlayamaz ve profile ile explicit süreler arasında çelişki oluşmaz.

---

# J. Queue notify topology sonucu

Notify-enabled olması gereken queue'lar:

```text
worker'ı bulunan 20 application queue
```

Storage-only shared DLQ:

```text
application-dead-letter
```

worker çalıştırmadığı için notify-enabled olmak zorunda değildir.

`application-dead-letter-redrive` ise worker'ı bulunduğu için notify-enabled olmalıdır.

Provisioner'ın `notify` mutable topology'sini reconcile etmesi gerekir.

Bu değişiklik Adım 9'a aittir; Adım 2'de implementation yapılmamıştır.

---

# K. Queue pool / listener kapasite audit sonucu

Current:

```text
JOB_QUEUE_POOL_SIZE=20
```

Hedef LISTEN/NOTIFY:

```text
1 dedicated listener connection / process
```

Transactional worker'lar idle durumda kendilerine dedicated connection ayırmaz.

Connection kullanımı üç ayrı durumda değerlendirilmelidir:

```text
idle worker
→ dedicated connection tutmaz

poll / fetch
→ pool'dan kısa süreli connection alır
→ query tamamlanınca connection pool'a geri döner

transactional job claimed + running
→ transaction için bir queue-pool connection pinlenir
→ handler + job completion aynı transaction içinde tamamlanana kadar tutulur
→ COMMIT / ROLLBACK sonrası connection pool'a geri döner
```

Mevcut dört transactional consumer'ın her birinde:

```text
localConcurrency = 1
```

olduğu için, **yalnız dört transactional job aynı anda gerçekten execution / transaction içindeyse** worst-case transactional pinning:

```text
4 × localConcurrency 1
=
4 in-flight transactional connections
```

olabilir.

Bu `+4`, worker'ların idle beklemesi veya polling yapması nedeniyle sürekli pinned kalan dört connection anlamına gelmez. Poll/fetch işlemleri connection'ı yalnız query süresince kısa süreli kullanır.

Teorik worst-case in-flight pin:

```text
listener:                 1   # sürekli session-pinned
active transactions:     +4   # yalnız 4 transactional job aynı anda çalışıyorsa
---------------------------
pinned max:               5
```

Bu worst-case anında statik model:

```text
20 - 5 = 15
```

connection'ı queue fetch/failure/completion/maintenance gibi diğer kısa süreli queue operasyonları için bırakır. Normal idle durumda ise transactional consumer'lar bu dört connection'ı pinlemez; sürekli pinned olan connection yalnız LISTEN/NOTIFY listener connection'ıdır.

Dolayısıyla mevcut `JOB_QUEUE_POOL_SIZE=20` ile LISTEN/NOTIFY **statik olarak uygulanabilir görünmektedir**.

Ancak:

```text
pool size × replica count
```

database toplam connection budget'ını lineer büyütür.

Örneğin yalnız queue pool:

```text
5 replicas × 20 = 100 potential queue-pool connections
```

Bu nedenle production deployment'ta:

- PostgreSQL `max_connections`,
- proxy/pool topology,
- app DB pool'ları,
- queue pool,
- listener pinned sessions,
- replica autoscaling

birlikte capacity-test edilmelidir.

Bu Adım 2'de mevcut pool size'ı değiştirmek için yeterli gerekçe değildir.

---

# L. Batch / parallelism audit

## Non-transactional settlement

Current non-transactional worker:

```text
perJobResults: true
```

kullanır.

Application code batch'i sequential işler:

```text
job A
    ↓
result A

job B
    ↓
result B

job C
    ↓
result C
```

Her job'ın sonucu ayrı olarak:

```text
completed
failed
deadletter
```

döner.

Normal bir job failure'ı diğer batch üyelerini topluca fail ettirmez.

Ancak pg-boss contract gereği handler'ın kendisi batch-level throw ederse tüm batch fail olabilir. Current application code per-job `try/catch` ile ordinary consumer failure'larını result array'e dönüştürmektedir.

## Transactional settlement

Transactional worker:

```text
perJobResults
```

kullanamaz.

Current dört transactional consumer'ın hepsinde:

```text
batchSize: 1
```

bulunmaktadır.

Bu doğru invariant'tır ve korunmalıdır.

## Generic parallelization

Aşağıdaki generic değişiklik önerilmemektedir:

```ts
await Promise.all(jobs.map(...))
```

Çünkü concurrency:

```text
localConcurrency
×
batchSize
×
replicaCount
```

şeklinde gizli büyüyebilir.

Örnek:

```text
LC 2
× batch 10
× 5 replicas
=
100 simultaneous effects
```

Bu:

- email provider rate limit,
- S3 request pressure,
- Redis load,
- primary PostgreSQL load

üzerinde implicit multiplier yaratır.

Ayrıca external effect tamamlandıktan sonra result array settle edilmeden process crash olursa job tekrar delivery alabilir.

Batch'i parallel yapmak bu failure window'u çözmez; yalnız aynı anda failure window'una giren effect sayısını büyütebilir.

### Karar

```text
LISTEN/NOTIFY
→ dispatch latency

localConcurrency
→ bounded execution parallelism

batchSize
→ fetch / settlement granularity
```

Generic batch parallelization uygulanmamalıdır.

---

# M. LISTEN/NOTIFY sonrası batch-size değerlendirmesi

LISTEN/NOTIFY gelmesi:

```text
batchSize = 1 everywhere
```

anlamına gelmemelidir.

Önemli pg-boss 12.33.2 davranışı:

- bir notify-enabled insert statement queue için tek wake-up notification üretebilir;
- notification tüm local worker'ları uyandırabilir;
- worker bir fetch'te en fazla `batchSize` kadar job alır;
- default davranışta full batch işlendikten sonra yeni notification yoksa worker notify backstop interval'a döner.

Bu nedenle büyük backlog için `batchSize` hâlâ throughput aracı olabilir.

Özellikle:

```text
UserCacheConsumer batch 20
```

gibi ucuz/idempotent workload'da batch avantajlıdır.

External effect queue'larında ise batch büyüdükçe settlement-before-crash window'unda tekrar edebilecek effect sayısı büyüyebilir.

Bu nedenle mevcut batch değerleri Adım 2'de topluca küçültülmemiştir.

## `burstWhenBatchFull` notu

pg-boss 12.33.2 ayrıca:

```text
burstWhenBatchFull: true
```

seçeneğiyle full batch geldikçe worker'ın delay vermeden tekrar fetch etmesini destekler.

Bu, ileride:

```text
large batch
```

ile:

```text
backlog drain
```

i birbirine bağlama ihtiyacını azaltabilir.

Ancak external provider queue'larında burst mode sustained request pressure yaratabileceği için global olarak açılmamalıdır.

Adım 9 için yalnız consumer-specific, capacity-justified optimization adayıdır; mevcut issue kapsamında zorunlu correction değildir.

---

# N. Consumer bazında dispatch / LISTEN-NOTIFY sonucu

| Consumer                                     | Profile    | Target poll | Target notify-poll | Step 2 dispatch sonucu                                                                     |
| -------------------------------------------- | ---------- | ----------: | -----------------: | ------------------------------------------------------------------------------------------ |
| `UserCacheConsumer`                          | `high`     |        `5s` |              `10s` | Notify immediate; cache repair için bounded backstop                                       |
| `UserSessionConsumer`                        | `critical` |        `1s` |               `5s` | Security/session latency; listener failure'da 1s fallback                                  |
| `AdminInviteConsumer`                        | `low`      |       `30s` |              `60s` | Initial invite NOTIFY ile immediate; fallback/retry non-critical                           |
| `AdminSessionConsumer`                       | `critical` |        `1s` |               `5s` | User session ile aynı                                                                      |
| `UserActivationConsumer`                     | `medium`   |       `15s` |              `30s` | Initial activation NOTIFY ile immediate; retry/fallback latency tolerable                  |
| `UserAvatarReplaceConsumer`                  | `medium`   |       `15s` |              `30s` | Initial reconciliation NOTIFY ile immediate; fallback/retry medium priority                |
| `UserAvatarFinalizeConsumer`                 | `medium`   |       `15s` |              `30s` | Initial reconciliation NOTIFY ile immediate; fallback/retry medium priority                |
| `AdminAvatarReplaceConsumer`                 | `medium`   |       `15s` |              `30s` | Initial reconciliation NOTIFY ile immediate; fallback/retry medium priority                |
| `AdminAvatarFinalizeConsumer`                | `medium`   |       `15s` |              `30s` | Initial reconciliation NOTIFY ile immediate; fallback/retry medium priority                |
| `UserEmailConfirmationConsumer`              | `medium`   |       `15s` |              `30s` | Initial confirmation NOTIFY ile immediate; retry/fallback medium priority                  |
| `UserRefreshReuseNoticeConsumer`             | `low`      |       `30s` |              `60s` | Critical revocation ayrı path'te; notice non-blocking, `batchSize: 10` review devam ediyor |
| `AdminEmailConfirmationConsumer`             | `medium`   |       `15s` |              `30s` | Initial confirmation NOTIFY ile immediate; retry/fallback medium priority                  |
| `AdminRefreshReuseNoticeConsumer`            | `low`      |       `30s` |              `60s` | Critical revocation ayrı path'te; notice non-blocking, `batchSize: 10` review devam ediyor |
| `UserEmailChangeNotificationConsumer`        | `low`      |       `30s` |              `60s` | Notify initial delivery'yi prompt yapar; non-blocking retry backstop                       |
| `AdminEmailChangeNotificationConsumer`       | `low`      |       `30s` |              `60s` | User ile aynı                                                                              |
| `UserSessionRevocationLogoutAllConsumer`     | `critical` |        `1s` |               `5s` | Security-critical remediation                                                              |
| `DeadLetterRedriveConsumer`                  | `low`      |       `30s` |              `60s` | Operator request notify ile immediate; maintenance retry backstop                          |
| `AdminSessionRevocationLogoutAllConsumer`    | `critical` |        `1s` |               `5s` | Security-critical remediation                                                              |
| `UserSessionRevocationRefreshReuseConsumer`  | `critical` |        `1s` |               `5s` | Security-critical remediation                                                              |
| `AdminSessionRevocationRefreshReuseConsumer` | `critical` |        `1s` |               `5s` | Security-critical remediation                                                              |

Bu değerler Adım 2'de **target policy** olarak kesinleştirilmiştir; source/config değişikliği Adım 9'da yapılacaktır. Production load/SLO testi profile seçiminin yeniden değerlendirilmesine neden olabilir, ancak canonical profile süreleri tek noktadan değiştirilmelidir.

---

# O. Adım 9'a taşınacak correction listesi

Adım 2 sonunda transaction mode için correction gerekmemektedir.

Worker execution / dispatch için aşağıdaki correction'lar doğrulanmıştır:

## Required

1. `JobQueueDatabaseAdapter` custom pg-boss `listen()` capability'sini implemente et.
2. Listener için dedicated session-pinned connection lifecycle:
    - subscribe,
    - reconnect,
    - `onReconnect`,
    - close,
    - pool error handling
      davranışını ekle.
3. `PgBoss` instance'ını `useListenNotify: true` ile başlat.
4. Worker'ı olan application queue'larda `notify: true` reconcile et.
5. Shared storage-only `application-dead-letter` queue'sunu notify-required olarak işaretleme.
6. `application-dead-letter-redrive` queue'sunu notify-enabled yap.
7. Queue provisioner'ın `notify` drift'ini detect/update etmesini sağla.
8. `listen_notify_unavailable` warning'ini application observability'ye taşı.
9. Universal hard-coded `notifyPollingIntervalSeconds: 30` kullanma.
10. Standart `critical / high / medium / low` worker polling profile configuration ekle.
11. Canonical profile değerlerini uygula:
    - `critical`: `1s / 5s`
    - `high`: `5s / 10s`
    - `medium`: `15s / 30s`
    - `low`: `30s / 60s`
      (`pollingIntervalSeconds / notifyPollingIntervalSeconds`)
12. Consumer → profile eşlemesini Section I / N ile aynı tut; mevcut ara değerleri canonical profile fallback değerlerine normalize et (`2s` / `3s` → `medium 15s`, ilgili `15s` queue'lar → `low 30s`).
13. `pollingIntervalSeconds` değerini listener-unavailable fallback, `notifyPollingIntervalSeconds` değerini healthy-listener retry / delayed / redrive backstop olarak kullan.
14. Generic batch `Promise.all()` parallelization ekleme.
15. Transactional consumer'larda `batchSize: 1` invariant'ını koru.

## Pending later audit

### WorkerOptions / batch

Adım 6–8 tamamlanana kadar aşağıdaki iki consumer'ın `batchSize: 10` final kararı bekletilmeli:

- `UserRefreshReuseNoticeConsumer`
- `AdminRefreshReuseNoticeConsumer`

Bu nedenle WorkerOptions assessment sonucu **18 appropriate / 2 review** olarak kalır.

### Email logical-delivery / provider idempotency

WorkerOptions assessment'tan ayrı olarak Adım 7–8'de şu dört email path'i payload stability açısından incelenmelidir:

- `UserEmailConfirmationConsumer` — current `user.name`;
- `AdminEmailConfirmationConsumer` — current `admin.name`;
- `UserRefreshReuseNoticeConsumer` — current email + name;
- `AdminRefreshReuseNoticeConsumer` — current email + name.

Current provider key `queueName/deliveryId/contentHash` olduğundan payload drift aynı logical delivery için yeni provider identity üretebilir.

Target karar:

```text
provider key = queueName/deliveryId
same logical delivery + changed payload = invariant violation
```

Resend `invalid_idempotent_request` terminal/non-retryable, `concurrent_idempotent_requests` retryable olarak Adım 8'de kesinleştirilmeli; source correction Adım 9'a bırakılmalıdır.

---

# P. Adım 10 regression / integration test gereksinimleri

LISTEN/NOTIFY implementation sonrası en az şu testler bulunmalıdır:

## Dispatch

- immediately-runnable job notify-enabled queue'ya insert edilir → worker normal polling interval'ını beklemeden wake-up alır;
- NOTIFY missed/unavailable → polling backstop job'ı bulur;
- listener reconnect → missed-notification recovery force-fetch çalışır;
- listener unavailable → worker `pollingIntervalSeconds` cadence'ine döner;
- future/deferred job vadesinde polling ile bulunur;
- retry `start_after` vadesinde notify beklemeden polling ile bulunur;
- redriven job polling backstop ile alınır.

## Multi-node

- iki veya daha fazla listening instance aynı NOTIFY'ı alabilir;
- aynı physical job yalnız bir worker tarafından claim edilir;
- başka node queue'daki başka ready job'ı claim edebilir;
- notification broadcast duplicate ownership üretmez.

## Settlement

- non-transactional batch'te bir job failure diğer job disposition'larını fail ettirmez;
- batch-level unexpected throw durumunda pg-boss whole-batch failure davranışı bilinçli olarak test edilir;
- transactional consumer `batchSize: 1` korunur;
- generic batch parallelism yoktur.

## Pool

- listener bir pinned connection kullanırken dört transactional worker aynı anda çalışabilir;
- fetch/failure/completion/maintenance için pool headroom korunur;
- listener reconnect connection leak üretmez.

---

# Q. Adım 2 acceptance review

## 1. Transactional justification

- [x] Each transactional consumer has a documented justification for requiring atomic consumer writes and job completion.

Dört transactional consumer'ın tamamı justification aldı; gereksiz transactional consumer bulunmadı.

## 2. WorkerOptions justification

- [ ] Every consumer's `workerOptions` are fully justified against latency, throughput, transaction mode, database / pool pressure, external dependency capacity, and horizontal scaling.

20 consumer'ın tamamı audit edildi.

Sonuç:

```text
18 appropriate
2 review
0 change recommended
```

İki refresh-reuse notice consumer'ın `batchSize: 10` değeri Adım 6–8 retry/email idempotency analizi tamamlanmadan final kabul edilmemelidir.

Email-confirmation path'lerinde bulunan mutable-name/provider-key riski workerOptions problemi değildir; ayrı Adım 7–8 retry/idempotency bulgusudur ve bu 18/2 assessment sayısını değiştirmez.

Bu nedenle criterion henüz final olarak kapatılmamıştır.

## 3. LISTEN/NOTIFY

- [x] `LISTEN/NOTIFY` is validated as the primary wake-up model for immediately available jobs, with bounded polling fallback, multi-node claim safety, and listener connection capacity accounted for.

Ancak Step 1'deki universal `30s` backstop varsayımı Adım 2'de refine edilmiştir.

Doğrulanan hedef:

```text
NOTIFY
→ immediate-job fast path

standard workload profile
→ critical / high / medium / low

notifyPollingIntervalSeconds
→ retry / deferred / redrive maturity backstop

pollingIntervalSeconds
→ listener-unavailable fallback
```

## 4. Batch boundedness

- [x] Batch processing remains bounded and explicit; generic batch parallelization does not bypass `localConcurrency` as the primary execution-concurrency control.

Current sequential per-job processing korunmalıdır.

---

# R. Adım 2 sonucu

Adım 2 audit tamamlanmıştır.

### Transaction mode

```text
20 / 20 current mode justified

transactional:      4 / 4 justified
non-transactional: 16 / 16 justified
mode changes:       0
```

### Current workerOptions

```text
appropriate:        18
review:               2
change recommended:   0
```

Polling cadence için ayrıca target policy standardizasyonu kesinleştirilmiştir:

```text
critical = 1s / 5s
high     = 5s / 10s
medium   = 15s / 30s
low      = 30s / 60s
```

Bu standardization mevcut workerOptions mismatch sayısından ayrıdır; implementation Adım 9'a aittir.

### Dispatch

Current source:

```text
polling-only
```

Target:

```text
LISTEN/NOTIFY + bounded polling
```

Required Step 9 implementation gap vardır.

### Adım 2'deki en önemli refinement

Şu model reddedilmiştir:

```text
all notify-enabled queues
→ notifyPollingIntervalSeconds = 30
```

Yerine dört canonical workload profile'ı kullanılacaktır:

```text
critical → poll 1s  / notify-poll 5s
high     → poll 5s  / notify-poll 10s
medium   → poll 15s / notify-poll 30s
low      → poll 30s / notify-poll 60s
```

`pollingIntervalSeconds` listener-unavailable fallback'tir; `notifyPollingIntervalSeconds` healthy-listener retry / delayed / redrive backstop'udur.

Bu ayrımın nedeni LISTEN/NOTIFY'ın retry/deferred/redrive maturity event'lerini tek başına wake-up garantisiyle kapsamamasıdır. Standardization source/config'e Adım 9'da uygulanacaktır.

### Adım 7–8'e taşınan email-idempotency bulgusu

Worker/dispatch audit sonucunu değiştirmeyen ayrı bir retry-safety bulgusu vardır:

```text
UserEmailConfirmationConsumer
AdminEmailConfirmationConsumer
UserRefreshReuseNoticeConsumer
AdminRefreshReuseNoticeConsumer
```

retry sırasında mutable account state'ten payload üretebilir. Current `queueName/deliveryId/contentHash` provider key modeli bu drift'i yeni provider identity'ye çevirebilir. Target identity `queueName/deliveryId` olarak belirlenmiştir; ayrıntılı payload-stability ve provider `409` davranışı Adım 7–8'de doğrulanacaktır.

### Source/config değişikliği

```text
none
```

Adım 9'a kadar source implementation yapılmamalıdır.

---

# S. İncelenen source'lar

## Repository

```text
docs/work/issue#28/issue#28-step-1-queue-consumer-inventory-final-tr.md

src/core/job-queue/job-consumer.interface.ts
src/core/job-queue/job-queue-feature.module.ts
src/core/job-queue/job-queue-core.module.ts
src/core/job-queue/job-queue-provisioner.ts
src/core/job-queue/job-queue-transaction.ts
src/core/job-queue/adapter/job-queue-database.adapter.ts
src/core/job-queue/adapter/job-queue-writer.adapter.ts
src/core/job-queue/adapter/job-queue-operations.adapter.ts
src/core/job-queue/dead-letter-queue.constant.ts

src/core/database/adapter/transaction.adapter.ts
src/core/database/database-transaction-context.ts

src/module/user/application/command/revoke-user-sessions/handler.ts
src/module/admin/application/command/revoke-admin-sessions/handler.ts
src/module/user/domain/aggregate/user.aggregate.ts
src/module/admin/domain/aggregate/admin.aggregate.ts

20 production consumer source file

.env.example
package-lock.json
```

## pg-boss 12.33.2 exact tag

```text
docs/api/workers.md
docs/api/constructor.md
docs/api/queues.md

src/types.ts
src/manager.ts
src/worker.ts
src/plans.ts
```

Doğrulanan library özellikleri:

- transactional worker atomic completion,
- transactional connection pinning,
- `perJobResults`,
- `localConcurrency`,
- `pollingIntervalSeconds`,
- `notifyPollingIntervalSeconds`,
- `useListenNotify`,
- queue `notify`,
- custom DB `listen()` capability,
- multi-worker notification wake-up,
- listener reconnect recovery,
- future-job polling,
- retry `start_after`,
- redrive SQL,
- `burstWhenBatchFull`.
