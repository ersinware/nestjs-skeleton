# Issue #28 — Adım 1: Queue Consumer Inventory

## Kapsam ve snapshot

Bu inventory, `issue#28-queue-consumer-transaction-retry-safety` branch'inin aşağıdaki snapshot'ı üzerinden çıkarıldı:

```text
54000b635991ee1ac04a25875c0b5c82cbb53667
```

Amaç, production'daki tüm durable `IJobConsumer` implementasyonlarını; worker ayarları, command / handler zinciri, transaction kullanımı, PostgreSQL / Redis / external effect'leri, follow-up job'ları, audit davranışı, retry / dedup mekanizması ve logical identity ile birlikte kaydetmektir.

### Kapsam doğrulaması

Production source altında **20 `IJobConsumer` implementasyonu** bulundu ve `JobQueueModule.forFeature(...)` registration'larıyla çapraz doğrulandı:

- User bounded context: **10**
- Admin bounded context: **9**
- Job Queue Operations: **1**
- Toplam: **20**
- Transactional: **4**
- Non-transactional: **16**

Test-only consumer'lar (`TransactionalProbeConsumer` vb.) production inventory'ye dahil edilmedi.

Production implementasyonları ile feature registration listeleri arasında eksik veya register edilmemiş consumer bulunmadı.

---

## Global worker / retry davranışı

### Worker settlement

`JobQueueFeatureModule` iki execution modeli kullanır:

- `transactional: true`
  - pg-boss transactional worker kullanılır.
  - Worker transaction'ı application database context'ine aktarılır.
  - Application-owned database işi `ITransactionPort.join()` ile aynı transaction'a katılır.
  - Consumer failure'ı transaction'ı ve job completion'ı birlikte rollback ettirir.
  - `batchSize` içindeki job'lar consumer loop'unda sequential işlenir.

- `transactional: false`
  - `perJobResults: true` kullanılır.
  - Her job ayrı `completed`, `failed` veya `deadletter` sonucu alır.
  - `TerminalJobException` doğrudan dead-letter disposition üretir.
  - Diğer failure'lar normal retry sürecine bırakılır.

### Queue retry defaults

Application-owned queue'larda startup sırasında şu mutable defaults reconcile edilir:

```text
retryLimit: 10
retryDelay: 15
retryBackoff: true
```

Standart queue'lar retry'lar tükendiğinde shared application dead-letter queue'ya gider.

`application-dead-letter-redrive` istisnadır:

```text
policy: exclusive
disableDeadLetter: true
```

### Command pipeline

Consumer'ların 19'u `CommandPipeline` kullanır. Pipeline şu behavior sırasını uygular:

```text
TracingBehavior
    ↓
CacheInvalidationBehavior
    ↓
Command handler
```

`CacheInvalidationBehavior` yalnız `ICacheInvalidatingCommand` implement eden command'larda devreye girer ve handler başarılı olduktan sonra Redis cache eviction yapar. Bu eviction best-effort'tür.

Production consumer'lar içinde bu behavior'ın doğrudan Redis effect ürettiği queue command'ları:

- `FinalizeUserAvatarCommand`
- `ReplaceUserAvatarCommand`

`UserCacheConsumer` command pipeline kullanmaz; doğrudan cache eviction port'una gider.

### Logical job identity

Normal aggregate jobs:

- `deliveryId`: retry'lar boyunca korunan logical delivery identity.
- `aggregateId`: authoritative aggregate'ı yeniden okumak için kullanılır.
- pg-boss physical job ID: producer tarafından ayrı UUIDv7 olarak oluşturulur.

Dead-letter redrive orchestration özel durumdur:

- logical operation identity = pg-boss job ID / `operationId`
- job payload'ında normal `deliveryId` / `aggregateId` bulunmaz.

---

# A. Consumer execution inventory

| # | Consumer / queue | Tx | Worker options `(LC / poll / batch)` | Command → Handler | `ITransactionPort` | PostgreSQL mutation | Redis effect | External effect | Follow-up jobs | Audit | Retry / dedup mechanism | Logical identity |
|---:|---|:---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `UserCacheConsumer` — `user.cache-invalidate.queue.v1` | No | `1 / 5s / 20` | Direct consumer; command yok | Yok | Yok | User projection cache key için Redis `DEL` | Yok | Yok | Yok | Redis `DEL` effect-idempotent; delete await edilir, failure job retry'a gider | Effect aggregate cache key / `aggregateId` ile belirlenir; `deliveryId` handler tarafından kullanılmaz |
| 2 | `UserSessionConsumer` — `user.session-reconcile.queue.v1` | No | `2 / 1s / 5` | `ReconcileUserSessionCommand` → `ReconcileUserSessionCommandHandler` | Yok | Yok; primary'den `sessionVersion` read | Session Redis'te version floor `setVersion`; Lua `max(stored, candidate)` semantics | Yok | Yok | Yok | Her retry authoritative DB version'ı yeniden okur; Redis update monotonic ve convergent / idempotent | `aggregateId` authoritative identity; `deliveryId` handler semantics'inde kullanılmaz |
| 3 | `AdminInviteConsumer` — `admin.invite.queue.v1` | No | `1 / 15s / 5` | `SendAdminInviteCommand` → `SendAdminInviteCommandHandler` | Yok | Yok; current eligible invitation metadata read | Yok | Resend email + deterministic invitation JWT generation | Yok | Yok | Exact `deliveryId` / invite ID ile current eligibility re-read; JWT `noTimestamp: true`; provider idempotency key = queue + delivery + content hash | `deliveryId == inviteId` |
| 4 | `AdminSessionConsumer` — `admin.session-reconcile.queue.v1` | No | `2 / 1s / 5` | `ReconcileAdminSessionCommand` → `ReconcileAdminSessionCommandHandler` | Yok | Yok; primary'den `sessionVersion` read | Session Redis'te monotonic version floor update | Yok | Yok | Yok | Her retry authoritative DB version'ı yeniden okur; Redis `max` semantics ile convergent | `aggregateId`; `deliveryId` handler semantics'inde kullanılmaz |
| 5 | `UserActivationConsumer` — `user.activation.queue.v1` | No | `2 / 2s / 5` | `SendUserActivationCommand` → `SendUserActivationCommandHandler` | Yok | Yok; exact activation request eligibility read | Yok | Resend email + deterministic activation JWT | Yok | Yok | Exact `deliveryId` / activation ID ile stale delivery skip edilir; deterministic token; provider idempotency key kullanılır | `deliveryId == activationId` |
| 6 | `UserAvatarReplaceConsumer` — `user.avatar-replace.queue.v1` | No | `1 / 5s / 1` | `ReplaceUserAvatarCommand` → `ReplaceUserAvatarCommandHandler` | `start()` yalnız committed state değişecekse | User aggregate avatar key/version/update + audit insert; `UserWriterAdapter.save()` aggregate jobs'ı aynı tx içinde enqueue eder | Command pipeline başarılı dönüşte user cache best-effort evict eder | S3 `HEAD`, conditional/reconciled copy, repeated-safe delete | State değiştiyse `user.cache-invalidate.queue.v1` | `USER_AVATAR_FINALIZED` success audit `start()` içinde; auditable refusal bağımsız transaction ile kalıcılaştırılır | Authoritative user state yeniden okunur; delivery-state machine; immutable destination; existing destination reuse; optimistic lock; repeated S3 delete safe; terminal invalid state dead-letter olabilir | `deliveryId` avatar version / permanent key identity; `previousAvatarId` job payload'ında korunur |
| 7 | `UserAvatarFinalizeConsumer` — `user.avatar-finalize.queue.v1` | No | `1 / 5s / 1` | `FinalizeUserAvatarCommand` → `FinalizeUserAvatarCommandHandler` | `start()` yalnız state değişecekse | User avatar key/version/update + audit insert; aggregate follow-up job aynı tx'de | Command pipeline user cache best-effort evict eder | S3 `HEAD`, copy, source delete | State değiştiyse `user.cache-invalidate.queue.v1` | `USER_AVATAR_FINALIZED` success audit tx içinde; auditable refusal bağımsız | Authoritative state + destination probe; finalized state no-op; immutable destination; repeated delete safe; optimistic lock | `deliveryId` avatar identity |
| 8 | `AdminAvatarReplaceConsumer` — `admin.avatar-replace.queue.v1` | No | `1 / 5s / 1` | `ReplaceAdminAvatarCommand` → `ReplaceAdminAvatarCommandHandler` | `start()` yalnız state değişecekse | Admin avatar key/version/update + audit insert | Yok | S3 `HEAD`, copy, obsolete/source delete | Yok | `ADMIN_AVATAR_FINALIZED` success audit tx içinde; auditable refusal bağımsız | User avatar path ile aynı reconciliation modeli: authoritative state, immutable destination, copy reuse, optimistic lock, repeated delete safe | `deliveryId` avatar identity; `previousAvatarId` payload |
| 9 | `AdminAvatarFinalizeConsumer` — `admin.avatar-finalize.queue.v1` | No | `1 / 5s / 1` | `FinalizeAdminAvatarCommand` → `FinalizeAdminAvatarCommandHandler` | `start()` yalnız state değişecekse | Admin avatar key/version/update + audit insert | Yok | S3 `HEAD`, copy, source delete | Yok | `ADMIN_AVATAR_FINALIZED` success audit tx içinde; auditable refusal bağımsız | Authoritative state + destination probe; finalized state no-op; immutable destination; repeated delete safe; optimistic lock | `deliveryId` avatar identity |
| 10 | `UserEmailConfirmationConsumer` — `user.email-confirmation.queue.v1` | No | `1 / 3s / 5` | `SendUserEmailConfirmationCommand` → `SendUserEmailConfirmationCommandHandler` | Yok | Yok; exact pending-email request eligibility read | Yok | Resend email + deterministic confirmation JWT | Yok | Yok | Current request ID / revocation / expiry re-read; stale job skip; deterministic token; provider idempotency key | `deliveryId == pendingEmailRequestId` |
| 11 | `UserRefreshReuseNoticeConsumer` — `user.refresh-reuse-notice.queue.v1` | No | `1 / 15s / 10` | `SendUserRefreshReuseNoticeCommand` → `SendUserRefreshReuseNoticeCommandHandler` | Yok | Yok; current non-deleted user contact read | Yok | Resend security email | Yok | Yok | Stable delivery ID provider key'e girer, fakat payload hash de key'e dahildir; current email/name değişirse retry farklı provider key üretebilir. Step 6/8'de ayrıca incelenmeli | `deliveryId`; recipient current account state'ten gelir |
| 12 | `AdminEmailConfirmationConsumer` — `admin.email-confirmation.queue.v1` | No | `1 / 3s / 5` | `SendAdminEmailConfirmationCommand` → `SendAdminEmailConfirmationCommandHandler` | Yok | Yok; exact pending-email request eligibility read | Yok | Resend email + deterministic confirmation JWT | Yok | Yok | User confirmation ile aynı: exact request re-read + deterministic token + provider idempotency | `deliveryId == pendingEmailRequestId` |
| 13 | `AdminRefreshReuseNoticeConsumer` — `admin.refresh-reuse-notice.queue.v1` | No | `1 / 15s / 10` | `SendAdminRefreshReuseNoticeCommand` → `SendAdminRefreshReuseNoticeCommandHandler` | Yok | Yok; current non-deleted admin contact read | Yok | Resend security email | Yok | Yok | Stable delivery ID var; current contact/content değişirse content hash nedeniyle provider idempotency key değişebilir. Step 6/8 review gerekli | `deliveryId`; recipient current account state'ten gelir |
| 14 | `UserEmailChangeNotificationConsumer` — `user.email-change-notification.queue.v1` | No | `1 / 30s / 10` | `SendUserEmailChangeNotificationCommand` → `SendUserEmailChangeNotificationCommandHandler` | Yok | Yok; immutable notification row read | Yok | Resend old-address security notification | Yok | Yok | Recipient/content committed immutable row'dan okunur; provider key stable queue + notification ID + stable content hash | `deliveryId == notification row ID` |
| 15 | `AdminEmailChangeNotificationConsumer` — `admin.email-change-notification.queue.v1` | No | `1 / 30s / 10` | `SendAdminEmailChangeNotificationCommand` → `SendAdminEmailChangeNotificationCommandHandler` | Yok | Yok; immutable notification row read | Yok | Resend old-address security notification | Yok | Yok | User notification ile aynı; immutable recipient evidence + stable provider key | `deliveryId == notification row ID` |
| 16 | `UserSessionRevocationLogoutAllConsumer` — `user.session-revocation.logout-all.queue.v1` | **Yes** | `1 / 1s / 1` | `RevokeUserSessionsCommand(LOGOUT_ALL)` → `RevokeUserSessionsCommandHandler` | **`join()`** | Ambient pg-boss tx içinde user read; `sessionVersion` + `revocationVersion` increment, `updatedAt`, optimistic-lock save, audit insert, follow-up pg-boss insert | Doğrudan yok | Yok | `user.session-reconcile.queue.v1` | `USER_SESSIONS_REVOKED` aynı tx'de; auditable aggregate refusal `markExceptionAsAudited` ile ambient tx dışında bağımsız commit edilir | Business writes + follow-up jobs + job completion tek pg-boss tx; ayrı inbox/dedup yok | `deliveryId` audit'e taşınır; aggregate identity `aggregateId` |
| 17 | `DeadLetterRedriveConsumer` — `application-dead-letter-redrive` | No | `1 / 30s / 1` | `RedriveDeadLetterJobsCommand` → `RedriveDeadLetterJobsCommandHandler` | Yok | pg-boss dead-letter rows source queue'lara redrive edilir; handler internal batch `100` ile drain eder | Yok | Yok | Yeni child job üretmek yerine DLQ jobs kaynak queue'larına geri taşınır | Consumer path'te audit yok; redrive request audit'i upstream `StartDeadLetterRedriveCommand` transaction'ında yazılır | `exclusive` queue; internal batch'ler bağımsız; retry mevcut DLQ'da kalan rows'dan devam eder; queue kendi DLQ'suna gitmez | `operationId == pg-boss orchestration job ID`; normal `deliveryId` yok |
| 18 | `AdminSessionRevocationLogoutAllConsumer` — `admin.session-revocation.logout-all.queue.v1` | **Yes** | `1 / 1s / 1` | `RevokeAdminSessionsCommand(LOGOUT_ALL)` → `RevokeAdminSessionsCommandHandler` | **`join()`** | Admin `sessionVersion` + `revocationVersion` increment, update/save, audit, follow-up pg-boss job aynı ambient tx'de | Doğrudan yok | Yok | `admin.session-reconcile.queue.v1` | `ADMIN_SESSIONS_REVOKED` aynı tx; auditable refusal bağımsız commit | Transactional atomicity; ayrı inbox/dedup yok | `deliveryId` audit'te; `aggregateId` owner |
| 19 | `UserSessionRevocationRefreshReuseConsumer` — `user.session-revocation.refresh-reuse.queue.v1` | **Yes** | `1 / 1s / 1` | `RevokeUserSessionsCommand(REFRESH_REUSE)` → `RevokeUserSessionsCommandHandler` | **`join()`** | User session/revocation version mutation + audit + follow-up job inserts aynı tx'de | Doğrudan yok | Yok | `user.session-reconcile.queue.v1` + `user.refresh-reuse-notice.queue.v1` | `USER_SESSIONS_REVOKED` aynı tx; refusal audit bağımsız | Transactional atomicity; follow-up jobs owner save ile aynı tx'de; ayrı inbox/dedup yok | Source `deliveryId`; notice için aggregate yeni random delivery ID üretir |
| 20 | `AdminSessionRevocationRefreshReuseConsumer` — `admin.session-revocation.refresh-reuse.queue.v1` | **Yes** | `1 / 1s / 1` | `RevokeAdminSessionsCommand(REFRESH_REUSE)` → `RevokeAdminSessionsCommandHandler` | **`join()`** | Admin session/revocation version mutation + audit + follow-up jobs aynı tx'de | Doğrudan yok | Yok | `admin.session-reconcile.queue.v1` + `admin.refresh-reuse-notice.queue.v1` | `ADMIN_SESSIONS_REVOKED` aynı tx; refusal audit bağımsız | Transactional atomicity; separate inbox/dedup yok | Source `deliveryId`; notice için yeni random delivery ID |

---

# B. WorkerOptions inventory ve statik ölçek değerlendirmesi

## Değerlendirme yöntemi

Bu bölüm **production load test sonucu değildir**. Repo içindeki workload semantiği, queue aciliyeti, handler'ın yaptığı DB / Redis / S3 / email işi ve mevcut pool topology'si üzerinden statik değerlendirmedir.

Assessment değerleri:

- **appropriate** — mevcut değerler workload semantiğiyle tutarlı; sayısal capacity yine production/load test ile doğrulanmalı.
- **review** — mevcut değer savunulabilir, fakat açık SLO / provider capacity / replica topology kararı olmadan final kabul edilmemeli.
- **change recommended** — static review'de belirgin mismatch var.

### Deployment-level scale notu

> **Snapshot notu:** Bu inventory'nin incelendiği commit'te pg-boss `LISTEN/NOTIFY` henüz etkin değildir. Aşağıdaki mevcut `pollingIntervalSeconds` değerleri runtime'da aktif polling cadence'idir. Bu Step 1 review sırasında `LISTEN/NOTIFY`'a geçme kararı alınmıştır; karar ve hedef davranış aşağıda ayrıca kaydedilmiştir.

`localConcurrency` process başınadır.

Mevcut 20 consumer'ın toplam configured `localConcurrency` değeri:

```text
23 worker slots / process
```

Dolayısıyla `R` adet aynı worker topology'sini çalıştıran replica için nominal worker slot sayısı:

```text
23 × R
```

Repo'nun `.env.example` değerleri ayrıca process başına:

```text
JOB_QUEUE_POOL_SIZE = 20
DATABASE_POOL_SIZE = 15
DATABASE_REPLICA_POOL_SIZE = 10   # replica configured ise
```

şeklindedir.

Bu doğrudan hata anlamına gelmez; worker'lar connection'ı sürekli dedicated olarak tutmak zorunda değildir ve pool doğal backpressure sağlar. Ancak orta/büyük ölçekli deployment'ta worker concurrency, poll cadence ve pool limitleri **birlikte** capacity-test edilmelidir. Aynı application process topology'sini yatay büyütmek queue polling ve connection budget'ını lineer büyütür.

Queue worker'ları process içinde aynı pg-boss instance'ını ve `JOB_QUEUE_POOL_SIZE` ile sınırlandırılmış dedicated queue pool'unu paylaşır. `23 worker slots / process`, 23 sürekli PostgreSQL connection anlamına gelmez; worker slot'ları gerektiğinde connection kullanır. Transactional worker'lar ise transaction boyunca queue-pool connection'ını daha uzun süre tutabilir.

## Kararlaştırılan dispatch yönü — PostgreSQL LISTEN/NOTIFY

Step 1 workerOptions review sonucunda **pg-boss `LISTEN/NOTIFY` kullanılmasına karar verilmiştir**. Bu karar henüz snapshot'taki source code'a uygulanmış değildir; implementation / correction aşamasında yapılacaktır.

Hedef model:

```text
immediately-available job INSERT
        ↓
transaction COMMIT
        ↓
PostgreSQL NOTIFY
        ↓
listening pg-boss instances wake up
        ↓
normal pg-boss fetch / claim / locking
        ↓
only successfully claimed jobs are processed
```

`NOTIFY` job delivery veya ownership mekanizması değildir. Yalnızca "queue'da runnable iş olabilir, şimdi fetch et" sinyalidir. Job'ın durable kaydı PostgreSQL'de kalır ve ownership normal pg-boss claim / locking semantics ile belirlenir.

### Polling davranışı

Step 1 sırasında kararlaştırılan başlangıç davranışı (Adım 2 tarafından supersede edilmiştir):

```text
LISTEN/NOTIFY healthy + queue notify-enabled
    → NOTIFY immediate wake-up
    → notifyPollingIntervalSeconds = 30s safety-net polling

LISTEN/NOTIFY unavailable
    → worker mevcut pollingIntervalSeconds değerine fallback eder

future / delayed / henüz runnable olmayan job
    → runnable olduğunda polling correctness path'i olmaya devam eder
```

Buna göre mevcut consumer `pollingIntervalSeconds` değerleri kaldırılmayacaktır. Bunlar **listener unavailable olduğunda fallback cadence** olarak korunacaktır.

İlk Step 1 baseline'ı:

```text
useListenNotify: true
notifyPollingIntervalSeconds: 30
```

> **Adım 2 refinement:** Bu universal `30s` varsayımı sonradan revize edilmiştir. Retry / delayed / redrive maturity her zaman NOTIFY üretmediği için hedef model artık standart workload profilleridir: `critical 1s/5s`, `high 5s/10s`, `medium 15s/30s`, `low 30s/60s` (`pollingIntervalSeconds / notifyPollingIntervalSeconds`). Step 1'deki `30s` yalnız tarihsel başlangıç varsayımıdır.

Worker'ı bulunan immediately-available application queue'ları `notify: true` olacaktır. Worker'ı olmayan shared application dead-letter storage queue'su notification üretmek zorunda değildir. `application-dead-letter-redrive` worker'ı bulunduğu için notify-enabled olmalıdır.

### Multi-node / horizontal scaling davranışı

Birden fazla application / worker instance aynı PostgreSQL notification channel'ını dinlediğinde tüm listening instance'lar wake-up sinyalini alabilir:

```text
                 PostgreSQL NOTIFY
                 /       |       \
              Node A   Node B   Node C
                 \       |       /
                  pg-boss fetch
                       ↓
               PostgreSQL claim/lock
```

Bu broadcast duplicate job ownership oluşturmaz. Birden fazla node aynı anda fetch etmeye çalışabilir; ancak yalnız pg-boss'un PostgreSQL claim/locking mekanizmasıyla job'ı başarıyla alan worker o execution attempt'i işler. Diğer node başka ready job alabilir veya boş fetch ile dönebilir.

Bu nedenle `LISTEN/NOTIFY`:

- queue isolation veya retry semantics'i değiştirmez;
- `localConcurrency`, `batchSize`, queue policy ve transactional mode'u bypass etmez;
- yalnız idle polling latency/maliyet dengesini değiştirir.

### Queue topology kararı

Polling maliyetini azaltmak amacıyla mevcut queue'lar **tek bir generic queue + type router** altında birleştirilmeyecektir.

Mevcut ayrı queue topology'si korunacaktır çünkü queue'lar farklı:

- transaction mode,
- workload / latency sınıfı,
- external dependency,
- retry / dead-letter davranışı,
- worker concurrency / batch ihtiyacı,
- queue policy

taşır.

`LISTEN/NOTIFY`, "çok queue → çok agresif idle polling" baskısını azaltarak bu isolation boundary'lerini korumayı mümkün kılar. İleride yalnız aynı execution profile'a gerçekten sahip queue'lar için consolidation ayrıca değerlendirilebilir.

### Batch processing / parallelism kararı

Mevcut `JobQueueFeatureModule` non-transactional batch'leri sequential işler ve `perJobResults: true` ile her job için ayrı disposition döndürür:

```text
job A → completed
job B → failed
job C → completed
```

Dolayısıyla bir non-transactional job'ın normal failure'ı diğer batch üyelerini topluca fail ettirmez.

Ancak result array pg-boss'a dönmeden process crash ederse, external effect'i tamamlanmış bazı job'lar tekrar delivery alabilir. Bu nedenle batch içini generic olarak paralelleştirmek retry-safety problemini çözmez; aynı anda daha fazla external effect başlatarak failure blast radius'ını büyütebilir.

Step 1 architecture kararı:

```text
LISTEN/NOTIFY
→ dispatch latency

localConcurrency
→ primary bounded execution concurrency

batchSize
→ fetch / settlement granularity
```

Buna göre:

- generic `Promise.all()` / unbounded batch parallelization **uygulanmayacak**;
- non-transactional batch processing varsayılan olarak sequential kalacak;
- gerçek parallelism gerektiğinde öncelikli kontrol `localConcurrency` olacak;
- transactional consumer'larda `batchSize: 1` korunacak;
- LISTEN/NOTIFY sonrası büyük batch değerlerinin "polling maliyetini amortize etme" gerekçesi zayıfladığı için Adım 6–8 sonuçlarıyla birlikte yeniden değerlendirilecek;
- yalnız ucuz ve effect-idempotent workload'larda (ör. cache eviction) bounded consumer-specific batch parallelism için açık gerekçe varsa daha sonra ayrıca değerlendirilebilir.

### Connection budget ve proxy notu

`LISTEN/NOTIFY` listener'ı session-pinned dedicated PostgreSQL connection gerektirir.

Bu repo custom `JobQueueDatabaseAdapter` kullandığı için implementation sırasında adapter'ın listener desteği eklenmelidir. Listener aynı `JOB_QUEUE_POOL_SIZE` pool'undan connection alacaksa process başına bir connection uzun süre pinned kalır.

Mevcut baseline:

```text
JOB_QUEUE_POOL_SIZE = 20
LISTEN/NOTIFY listener = 1 pinned connection / pg-boss instance

practical queue-pool headroom
≈ 19 connections + listener
```

Bu bir kapasite garantisi değildir; load test ile doğrulanmalıdır. İleride database proxy kullanılırsa listener path'i session-pinned `LISTEN/NOTIFY` semantics'i korumalıdır. Transaction / statement pooling gibi session affinity sağlamayan proxy modları listener connection'ı için uygun kabul edilmemelidir.

### Implementation / correction aşamasına taşınacak işler

Step 1 kararı olarak aşağıdakiler implementation backlog'una kaydedilir:

- pg-boss instance'ını `useListenNotify: true` ile başlat;
- custom `JobQueueDatabaseAdapter` için gerekli `listen` desteğini ekle;
- worker'ı bulunan application queue'larını `notify: true` olarak provision / reconcile et;
- Adım 2'de kesinleştirilen `critical / high / medium / low` polling profillerini kullan;
- `pollingIntervalSeconds` değerini listener-unavailable fallback, `notifyPollingIntervalSeconds` değerini healthy-listener retry / delayed / redrive backstop olarak uygula;
- `listen_notify_unavailable` durumunu observable hale getir;
- multi-node claim davranışı, missed notification recovery ve listener fallback için regression / integration test ekle;
- queue pool capacity testinde pinned listener connection'ını hesaba kat;
- generic batch parallelization ekleme; `localConcurrency`'yi primary execution-concurrency control olarak koru;
- LISTEN/NOTIFY implementation'ından sonra `batchSize` değerlerini retry failure-window ve provider capacity sonuçlarıyla yeniden doğrula.

> **Assessment notu:** Aşağıdaki `appropriate / review` değerleri mevcut polling-only snapshot'ın audit sonucudur. LISTEN/NOTIFY kararı bu review bulgularının bir kısmını çözmeyi hedefler; source change ve regression doğrulaması yapılmadan status'lar otomatik olarak `appropriate`'a çevrilmemiştir.

| Consumer | Workload / latency class | `localConcurrency` | Poll | Batch | DB / dependency pressure | Horizontal-scale etkisi | Assessment | Step 1 recommendation |
|---|---|---:|---:|---:|---|---|---|---|
| `UserCacheConsumer` | Normal / eventual consistency | 1 | 5s | 20 | Queue DB poll/completion + Redis `DEL`; app DB read yok | Her replica 1 worker; batch 20 Redis için verimli | **appropriate** | Değişiklik yok. Cache staleness SLO gevşekse 5s ileride 10s'e çıkarılabilir, ancak mevcut değer dengeli |
| `UserSessionConsumer` | **Critical / latency-sensitive** | 2 | 1s | 5 | Her job primary DB read + Redis Lua; queue pool da kullanılır | `2 × R` concurrent handlers; current snapshot'ta idle polling agresif | **review** | LISTEN/NOTIFY sonrası 1s değer fallback cadence olacaktır. `localConcurrency: 2` ve DB/Redis throughput yine production load testiyle doğrulanmalı |
| `AdminInviteConsumer` | Normal / user-facing, non-critical | 1 | 15s | 5 | DB read + email provider | `1 × R`; provider rate limit ile ölçeklenir | **appropriate** | Değişiklik yok; 15s admin invitation için DB polling maliyetini azaltan makul cadence |
| `AdminSessionConsumer` | **Critical / latency-sensitive** | 2 | 1s | 5 | DB read + Redis | `2 × R`; user session ile birlikte primary read pressure yaratır | **review** | LISTEN/NOTIFY sonrası 1s değer fallback cadence olacaktır. `localConcurrency: 2` ve aggregate DB/Redis capacity yine doğrulanmalı |
| `UserActivationConsumer` | Interactive / latency-sensitive | 2 | 2s | 5 | DB read + token signing + email provider | `2 × R`; batch ile birlikte bir worker invocation'ında 5 sequential delivery | **review** | LISTEN/NOTIFY immediate dispatch sağlayacaktır; 2s fallback olarak kalabilir. Review nedeni `localConcurrency: 2`, provider rate limit'i ve batch settlement window'dur |
| `UserAvatarReplaceConsumer` | Interactive / normal | 1 | 5s | 1 | DB read/write + audit + pg-boss enqueue + S3 operations + Redis best-effort eviction | S3 latency worker'ı meşgul eder; batch 1 head-of-line riskini sınırlar | **appropriate** | Değişiklik yok |
| `UserAvatarFinalizeConsumer` | Interactive / normal | 1 | 5s | 1 | DB + S3 + audit + durable cache job + Redis best-effort eviction | Aynı | **appropriate** | Değişiklik yok |
| `AdminAvatarReplaceConsumer` | Interactive / normal | 1 | 5s | 1 | DB + S3 + audit | Aynı | **appropriate** | Değişiklik yok |
| `AdminAvatarFinalizeConsumer` | Interactive / normal | 1 | 5s | 1 | DB + S3 + audit | Aynı | **appropriate** | Değişiklik yok |
| `UserEmailConfirmationConsumer` | Interactive / latency-sensitive | 1 | 3s | 5 | DB read + provider call | `1 × R`; provider capacity etkilenir | **appropriate** | Değişiklik yok; 3s user-facing confirmation için makul |
| `UserRefreshReuseNoticeConsumer` | Security notification / prompt but non-blocking | 1 | 15s | 10 | DB read + provider call | `1 × R`; batch 10 sequential ve settlement batch sonunda | **review** | Cadence savunulabilir; fakat `batchSize: 10` external-effect duplicate window'ını büyütür ve retry payload'ı current account state nedeniyle değişebilir. Adım 6–8 ile birlikte kesinleştirilmeli |
| `AdminEmailConfirmationConsumer` | Interactive / latency-sensitive | 1 | 3s | 5 | DB read + provider call | `1 × R` | **appropriate** | Değişiklik yok |
| `AdminRefreshReuseNoticeConsumer` | Security notification / prompt but non-blocking | 1 | 15s | 10 | DB read + provider call | `1 × R`; batch 10 sequential ve settlement batch sonunda | **review** | User refresh-reuse notice ile aynı; batch settlement window ve değişebilen payload Adım 6–8'de doğrulanmalı |
| `UserEmailChangeNotificationConsumer` | Security notification / non-blocking | 1 | 30s | 10 | DB read + provider call | Düşük DB poll pressure; `1 × R` | **review** | LISTEN/NOTIFY sonrası immediate job normalde anında wake-up alır; 30s fallback / safety davranışı olarak savunulabilir. Review esas olarak batch 10 ve notification SLO'sunun açıklaştırılması için kalır |
| `AdminEmailChangeNotificationConsumer` | Security notification / non-blocking | 1 | 30s | 10 | DB read + provider call | Düşük poll pressure | **review** | User ile aynı; LISTEN/NOTIFY sonrası 30s normal dispatch latency değil fallback cadence olacaktır. Batch/SLO review devam eder |
| `UserSessionRevocationLogoutAllConsumer` | **Critical / security** | 1 | 1s | 1 | Shared pg-boss transaction içinde business DB + audit + child jobs | `1 × R`; 1s idle polling per replica | **appropriate** | `batchSize: 1` doğru. Security latency nedeniyle 1s savunulabilir; yüksek replica sayısında queue-pool load test et |
| `DeadLetterRedriveConsumer` | Maintenance / operator-driven | 1 | 30s | 1 | Queue DB; consume başladıktan sonra internal redrive batch `100` ile drain | Queue `exclusive`; execution global serialize olur; notify ile replicas yalnız wake-up alır | **review** | Queue notify-enabled olduğunda operator request normalde hemen dispatch edilir; 30s listener-unavailable fallback için makul. Review internal drain / operator SLO için kalır |
| `AdminSessionRevocationLogoutAllConsumer` | **Critical / security** | 1 | 1s | 1 | Shared pg-boss transaction | `1 × R` | **appropriate** | `batchSize: 1` korunmalı; pool/load validation gerekli |
| `UserSessionRevocationRefreshReuseConsumer` | **Critical / security** | 1 | 1s | 1 | Shared pg-boss transaction + iki child job | `1 × R` | **appropriate** | `batchSize: 1` korunmalı; detection remediation latency için 1s gerekçeli |
| `AdminSessionRevocationRefreshReuseConsumer` | **Critical / security** | 1 | 1s | 1 | Shared pg-boss transaction + iki child job | `1 × R` | **appropriate** | User refresh-reuse ile aynı |

### WorkerOptions sonucu

Static review sonucunda:

```text
change recommended: 0
review: 8
appropriate: 12
```

`review` olarak bırakılanlar:

1. `UserSessionConsumer`
2. `AdminSessionConsumer`
3. `UserActivationConsumer`
4. `UserRefreshReuseNoticeConsumer`
5. `AdminRefreshReuseNoticeConsumer`
6. `UserEmailChangeNotificationConsumer`
7. `AdminEmailChangeNotificationConsumer`
8. `DeadLetterRedriveConsumer`

Bu sekiz consumer için mevcut değerlerin yanlış olduğu sonucuna varılmadı. `review`, static olarak savunulabilir görünen fakat production latency SLO'su, replica topology'si, DB/pool kapasitesi, provider rate limit'i veya batch settlement window'u doğrulanmadan `appropriate` sayılmaması gereken ayarları ifade eder.

---

# C. Retry / dedup açısından Adım 1'de görülen follow-up noktalar

Bunlar Adım 1'de bulunan observation'lardır; correction kararı değildir. Ayrıntılı karar ilgili sonraki audit adımlarında verilmelidir.

## 1. Refresh-reuse notice payload'ı retry arasında değişebilir

Şu consumer'lar recipient bilgisini current account state'ten yeniden okur:

- `UserRefreshReuseNoticeConsumer`
- `AdminRefreshReuseNoticeConsumer`

Email provider idempotency key şu öğelerden oluşur:

```text
queueName
+
deliveryId
+
contentHash(from, to, subject, html)
```

Bu nedenle ilk provider request başarılı olup job completion başarısız olduktan sonra account email/name değişirse retry farklı payload ve dolayısıyla farklı provider idempotency key üretebilir.

Bu durum:

- Adım 6 retry failure-window analizinde,
- Adım 7 authoritative-state / duplicate-effect analizinde,
- Adım 8 email delivery guarantee analizinde

özellikle ele alınmalıdır.

## 2. Transactional session-revocation consumer'larında ayrı inbox/dedup yok

Dört transactional revocation consumer'ı şu garantiye dayanır:

```text
business mutation
+
audit
+
follow-up jobs
+
pg-boss job completion
=
same PostgreSQL transaction
```

`deliveryId` audit / trace identity olarak taşınır; ayrı persisted inbox/dedup kaydı bulunmaz.

Bu tasarımın yeterliliği Adım 6/7'de failure-window üzerinden tekrar doğrulanmalıdır.

## 3. User avatar consumer'larında iki cache-repair yolu var

User avatar finalize / replace command'ları:

1. başarılı command sonrası `CacheInvalidationBehavior` ile best-effort Redis eviction yapar;
2. gerçek avatar state transition olduğunda aggregate ayrıca durable `user.cache-invalidate.queue.v1` job üretir.

Dolayısıyla immediate best-effort eviction ve durable repair birlikte bulunur.

## 4. Avatar paths explicit reconciliation state machine kullanıyor

Dört avatar consumer path'i retry sırasında:

- current aggregate state'i yeniden okur,
- destination object'ın daha önce yaratılıp yaratılmadığını kontrol eder,
- immutable `deliveryId`-derived destination kullanır,
- completed copy'yi reuse eder,
- final aggregate state'i no-op olarak tanıyabilir,
- S3 delete'i repeated-safe cleanup olarak kullanır.

Bu mevcut retry-safety mekanizmasının önemli bir parçasıdır; Adım 6'da crash windows tek tek test edilmelidir.

## 5. LISTEN/NOTIFY dispatch kararı correctness semantics'i değiştirmiyor

Step 1 sırasında alınan `LISTEN/NOTIFY` kararı latency / polling optimizasyonudur; retry correctness mekanizması değildir.

Özellikle:

- NOTIFY kaybolursa job PostgreSQL'de durable kalır;
- polling fallback / safety-net job'ı daha sonra bulur;
- notification alan tüm node'lar ownership kazanmaz;
- actual ownership pg-boss fetch / claim / locking ile belirlenir;
- transactional worker atomicity'si değişmez;
- non-transactional `perJobResults` davranışı değişmez;
- retry / dedup gereksinimleri aynen Adım 6–8'de incelenmeye devam eder.

Bu nedenle queue sayısı yalnız polling maliyetini azaltmak için düşürülmemelidir.

## 6. Generic batch parallelization kararı alınmadı

Step 1 review sonucu batch içindeki job'ların generic olarak paralel başlatılması uygun görülmedi.

Gerekçe:

- `perJobResults: true` mevcut sequential modelde zaten job disposition'larını birbirinden ayırır;
- process crash, result array dönmeden önce tamamlanmış external effect'lerin tekrar delivery almasına yol açabilir;
- batch'i paralel çalıştırmak bu failure window'u ortadan kaldırmaz;
- `localConcurrency × batchSize × replicaCount` şeklinde gizli bir concurrency multiplier oluşturabilir;
- email, S3, Redis ve PostgreSQL dependency capacity'sini tek bir `batchSize` değişikliğiyle aşmak mümkün hale gelir.

Bu nedenle generic parallelism yerine `localConcurrency` açık bounded concurrency kontrolü olarak kalacaktır. Consumer-specific bounded parallelism yalnız ilgili workload için idempotency ve capacity gerekçesi doğrulanırsa ayrıca değerlendirilecektir.

---

# D. Source files reviewed

## Queue infrastructure

```text
src/core/job-queue/job-consumer.interface.ts
src/core/job-queue/job-queue-feature.module.ts
src/core/job-queue/module.ts
src/core/job-queue/job-queue-core.module.ts
src/core/job-queue/job-queue-provisioner.ts
src/core/job-queue/adapter/job-queue-database.adapter.ts
src/core/job-queue/adapter/job-queue-writer.adapter.ts
src/core/job-queue/adapter/job-queue-operations.adapter.ts
src/core/job-queue/dead-letter-queue.constant.ts
src/core/job-queue/job.type.ts
src/shared/domain/job/job-definition.type.ts
package.json
package-lock.json
```

Repo snapshot'ında `pg-boss` resolved version'ı `12.33.2` olarak doğrulandı. LISTEN/NOTIFY hedef davranışı bu sürümün `useListenNotify`, queue-level `notify` ve worker-level `notifyPollingIntervalSeconds` semantics'i dikkate alınarak kaydedildi.

## Pipeline / transaction / effects

```text
src/core/cqrs/command.pipeline.ts
src/core/cqrs/module.ts
src/core/cqrs/tracing.behavior.ts
src/core/cqrs/cache-invalidation.behavior.ts
src/core/database/adapter/transaction.adapter.ts
src/core/observability/audit/adapter/audit.adapter.ts
src/core/cache/adapter/cache-eviction.adapter.ts
src/core/security/session/adapter/session.adapter.ts
src/core/email/adapter/emailer.adapter.ts
src/core/email/email-idempotency-key.util.ts
src/core/security/token/adapter/token.adapter.ts
src/core/storage/adapter/s3-storage.adapter.ts
```

## Feature registration

```text
src/module/user/user.module.ts
src/module/admin/admin.module.ts
src/module/job-queue-operations/job-queue-operations.module.ts
```

## Consumer / handler / aggregate paths

Production'daki 20 consumer dosyası, bağlı command handler'ları, `User` / `Admin` aggregate job emission davranışı ve writer / reader adapter'ları incelendi.

---

# Adım 1 acceptance review

- [x] Every durable queue consumer is inventoried and reviewed with the handlers and pipeline behavior it invokes.
- [x] Every consumer's `workerOptions` are inventoried and reviewed against latency requirements, workload characteristics, transaction mode, database pressure, external dependency capacity, and horizontal scaling behavior.
- [x] Current polling-only dispatch behavior is documented and the target `LISTEN/NOTIFY` architecture direction is recorded for implementation after the audit phase.
- [x] Batch settlement semantics are reviewed; generic batch parallelization is rejected as a default and `localConcurrency` remains the primary bounded concurrency control.

## Adım 1 sonucu

Adım 1 tamamlanmıştır.

Bu aşamada source code veya worker configuration değiştirilmemiştir. Mevcut polling-only snapshot için static review **8 consumer'ı `review`**, **12 consumer'ı `appropriate`** olarak sınıflandırmıştır.

Step 1 sırasında ayrıca şu architecture direction kararlaştırılmıştır:

- immediately-available application jobs için pg-boss `LISTEN/NOTIFY` primary wake-up mechanism olacaktır;
- mevcut `pollingIntervalSeconds` değerleri listener-unavailable fallback cadence olarak kalacaktır;
- Step 1'de başlangıçta düşünülen universal `notifyPollingIntervalSeconds: 30` varsayımı Adım 2'de workload-profili yaklaşımıyla supersede edilmiştir;
- ayrı queue topology'si korunacaktır;
- generic batch parallelization uygulanmayacak; parallelism `localConcurrency` ile bounded tutulacaktır;
- transactional consumer'larda `batchSize: 1` korunacaktır;
- LISTEN/NOTIFY source değişiklikleri, batch-size retuning ve regression testleri implementation / correction aşamasında yapılacaktır.

WorkerOptions için final tuning, LISTEN/NOTIFY implementation'ı sonrasında production SLO, load/capacity, replica topology'si, provider rate limit'leri ve batch failure-window sonuçlarıyla yeniden doğrulanmalıdır.