# Issue #28 — Queue Consumer Transaction ve Retry Safety Planı

## Amaç

Projede bulunan tüm durable queue consumer'ları inceleyerek transaction mode, worker execution ve dispatch ayarları, PostgreSQL boundary, external effect ordering ve retry davranışlarının doğru ve bilinçli olduğunu doğrulamak.

Bu çalışma iki ana aşamadan oluşur:

1. **Audit / review:** mevcut consumer davranışlarını eksiksiz şekilde çıkarmak ve sınıflandırmak.
2. **Implementation / correction:** audit sonucunda doğrulanan sorunları düzeltmek ve regression testlerle korumak.

---

## Adım 1 — Tüm durable queue consumer inventory'sini çıkar

Tüm `IJobConsumer` implementasyonlarını bul ve inventory oluştur.

Her consumer için aşağıdakileri kaydet:

- consumer / job adı
- `transactional: true/false`
- tüm `workerOptions` değerleri (`localConcurrency`, `pollingIntervalSeconds`, `batchSize`)
- mevcut queue / dispatch ayarları (`policy`, `disableDeadLetter`, polling-only / notify-enabled durumu)
- çağırdığı command
- command handler
- kullandığı `ITransactionPort.start()` / `join()`
- PostgreSQL mutation'ları
- Redis effect'leri
- S3 / HTTP / email gibi external effect'ler
- ürettiği follow-up job'lar
- audit davranışı
- retry / dedup mekanizması
- kullandığı logical identity (`deliveryId`, job ID vb.)
- queue'nun latency / workload sınıfı (`critical`, `normal`, `deferred / maintenance` gibi)
- `workerOptions` gerekçesi ve ölçekleme etkisi:
    - beklenen queue sıklığı ve throughput
    - PostgreSQL / pg-boss ve connection-pool baskısı
    - external dependency kapasitesi / rate limit'i
    - replica sayısıyla oluşan toplam concurrency
- mevcut `workerOptions` ayarının değerlendirmesi (`appropriate`, `review`, `change recommended`)
- gerekiyorsa önerilen `workerOptions` değişikliği
- dispatch stratejisi değerlendirmesi ve `LISTEN/NOTIFY` hedef durumu

### Çıktı

Queue consumer inventory tablosu; tüm `workerOptions` değerlerini, mevcut dispatch modelini ve bunların workload / ölçekleme değerlendirmesini içerir.

### İlgili acceptance criterion

- [ ] Every durable queue consumer is inventoried and reviewed with the handlers and pipeline behavior it invokes.
- [ ] Every consumer's `workerOptions` are inventoried and reviewed against latency requirements, workload characteristics, transaction mode, database pressure, external dependency capacity, and horizontal scaling behavior.
- [ ] Current queue dispatch behavior is inventoried and the target `LISTEN/NOTIFY` model is documented without changing source code during Step 1.

---

## Adım 2 — Her consumer'ın transaction mode, workerOptions ve dispatch ayarlarını doğrula

Inventory'deki her consumer için:

```text
transactional = true
```

veya

```text
transactional = false
```

seçiminin nedenini incele.

Transactional consumer yalnızca gerçekten şu atomicity'ye ihtiyaç duyuyorsa transactional kalmalı:

```text
business PostgreSQL writes
+
job completion
=
same PostgreSQL transaction
```

Her transactional consumer için açık justification çıkar.

Gereksiz transactional consumer'ları non-transactional'a çevrilmek üzere işaretle.

### WorkerOptions audit

Her consumer için aşağıdaki değerleri birlikte değerlendir:

```ts
{
    localConcurrency,
    pollingIntervalSeconds,
    batchSize,
}
```

Ayarları tek tek değil, birlikte ve deployment ölçeğiyle değerlendir:

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
=
workerOptions
```

Kontrol et:

- `localConcurrency` process başına concurrency'dir; toplam olası concurrency replica sayısıyla birlikte değerlendirilmelidir.
- `pollingIntervalSeconds` queue'nun gerçek latency ihtiyacıyla orantılı olmalıdır. Acil olmayan işler gereksiz sıklıkta PostgreSQL / pg-boss polling yapmamalıdır.
- `batchSize` throughput'u artırırken bir worker'ın uzun süre iş tutmasına, retry/failure blast radius'ının büyümesine veya job expiry riskine yol açmamalıdır.
- Transactional consumer'larda varsayılan beklenti `batchSize: 1` olmalıdır; birden fazla logical job'ın aynı transaction'a bağlanması açıkça gerekçelendirilmedikçe kabul edilmemelidir.
- External dependency kullanan consumer'larda concurrency ve batch ayarları provider kapasitesi / rate limit'iyle uyumlu olmalıdır.
- Orta/büyük ölçekli çoklu-replica deployment'ta ayarlar DB connection pool'u, pg-boss polling/completion kapasitesi ve queue backlog throughput'u ile birlikte değerlendirilmelidir.
- Tek bir evrensel worker profili kullanılmamalıdır; security-critical / latency-sensitive işler ile deferred notification, cleanup veya maintenance işleri aynı polling sıklığına zorlanmamalıdır.
- Mevcut değerler yalnızca gerçek workload beklentisi ve sistem kapasitesiyle gerekçelendirilebiliyorsa korunmalıdır.

Adım 2 sırasında değerleri değiştirme; yanlış veya zayıf bulunan ayarları Adım 9'da correction için işaretle.

### LISTEN/NOTIFY dispatch audit

Step 1 sırasında alınan architecture direction'ı doğrula:

```text
immediately-available application job
    ↓
PostgreSQL NOTIFY
    ↓
listening pg-boss instance'lar wake-up
    ↓
normal pg-boss fetch / claim / locking
```

Hedef davranış:

- pg-boss instance `useListenNotify: true` ile çalışmalı.
- Worker'ı bulunan immediately-available application queue'ları notify-enabled olmalı.
- Polling cadence değerleri tek global sayı yerine standart workload profillerinden seçilmeli:
    - `critical`: `pollingIntervalSeconds: 1`, `notifyPollingIntervalSeconds: 5`
    - `high`: `pollingIntervalSeconds: 5`, `notifyPollingIntervalSeconds: 10`
    - `medium`: `pollingIntervalSeconds: 15`, `notifyPollingIntervalSeconds: 30`
    - `low`: `pollingIntervalSeconds: 30`, `notifyPollingIntervalSeconds: 60`
- `pollingIntervalSeconds` listener unavailable olduğunda fallback cadence; `notifyPollingIntervalSeconds` listener sağlıklıyken retry / delayed / redrive backstop cadence'i olmalı.
- Future / delayed job'lar runnable olduklarında polling correctness path'iyle bulunabilmeli.
- NOTIFY yalnız wake-up hint olmalı; job ownership normal PostgreSQL claim / locking semantics ile belirlenmeli.
- Multi-node deployment'ta tüm listening instance'lar wake-up alabilse de yalnız job'ı başarıyla claim eden worker execution attempt'i çalıştırmalı.
- Listener için process başına session-pinned PostgreSQL connection budget'ı hesaba katılmalı.
- Custom `JobQueueDatabaseAdapter` listener desteği açısından doğrulanmalı.
- Queue sayısı yalnız polling yükünü azaltmak amacıyla generic tek queue + type router altında birleştirilmemeli; mevcut execution-isolation boundary'leri korunmalı.

### Batch / parallelism kararı

Generic batch parallelization hedeflenmemeli.

Varsayılan model:

```text
LISTEN/NOTIFY
→ dispatch latency

localConcurrency
→ açık ve bounded execution parallelism

batchSize
→ fetch / settlement granularity
```

Kontrol et:

- non-transactional consumer'larda `perJobResults: true` ile job disposition'ları ayrı kalmalı;
- batch içindeki job'lar varsayılan olarak sequential işlenmeli;
- generic `Promise.all()` / unbounded batch parallelism eklenmemeli;
- transactional consumer'larda `batchSize: 1` varsayımı korunmalı;
- yalnız ucuz, effect-idempotent workload'larda bounded batch parallelism için özel gerekçe varsa ayrıca değerlendirilmelidir;
- LISTEN/NOTIFY sonrası büyük `batchSize` değerlerinin polling amortization gerekçesi yeniden sorgulanmalıdır.

### Çıktı

Her consumer için:

```text
transaction mode
+
justification
+
workerOptions assessment
+
dispatch / LISTEN-NOTIFY assessment
+
change recommendation (if needed)
```

### İlgili acceptance criterion

- [ ] Each transactional consumer has a documented justification for requiring atomic consumer writes and job completion.
- [ ] Every consumer's `workerOptions` are justified against latency, throughput, transaction mode, database / pool pressure, external dependency capacity, and horizontal scaling.
- [ ] `LISTEN/NOTIFY` is validated as the primary wake-up model for immediately available jobs, with bounded polling fallback, multi-node claim safety, and listener connection capacity accounted for.
- [ ] Batch processing remains bounded and explicit; generic batch parallelization does not bypass `localConcurrency` as the primary execution-concurrency control.

---

## Adım 3 — PostgreSQL transaction boundary'lerini incele

### Transactional consumer'lar

Aşağıdaki modelin doğru kullanıldığını doğrula:

```text
pg-boss transaction
    ↓
application command
    ↓
ITransactionPort.join()
```

Kontrol et:

- `join()` gerçekten active pg-boss transaction'a mı katılıyor?
- nested `start()` var mı?
- transaction gereksiz yere uzun mu?
- transaction içinde yalnızca kısa PostgreSQL işi mi yapılıyor?
- command pipeline transaction ownership ile uyumlu mu?

### Non-transactional consumer'lar

DB transaction gereken yerlerde:

```text
ITransactionPort.start()
```

kullanımının doğru olduğunu doğrula.

### Çıktı

Transaction-boundary audit sonucu.

### İlgili acceptance criteria

- [ ] Transactional consumer paths perform only short PostgreSQL work and use `ITransactionPort.join()` for application-owned database transactions.
- [ ] Non-transactional consumer paths use `ITransactionPort.start()` for related database writes where a transaction is required.

---

## Adım 4 — Transaction içindeki external effect'leri audit et

Transactional consumer path'lerinde aşağıdaki external effect'leri ara:

- email
- Redis
- S3
- HTTP
- başka external service çağrıları

Yanlış model:

```text
BEGIN
DB mutation
send email
COMMIT
```

Doğru model:

```text
BEGIN
DB mutation
create durable follow-up job
COMMIT

        ↓

non-transactional consumer
        ↓
external effect
```

Established exceptions:

- logging
- tracing
- metrics
- transaction'dan bağımsız kalması gereken refusal audit

### Çıktı

Unsafe external-effect listesi ve gerekiyorsa follow-up-job dönüşüm planı.

### İlgili acceptance criterion

- [ ] Transactional consumer paths do not perform external business effects inside the shared transaction or after `join()` under an uncommitted assumption.

---

## Adım 5 — Non-transactional consumer effect ordering'i incele

Non-transactional consumer'larda commit'e bağlı effect'lerin sırasını doğrula.

Doğru model:

```text
BEGIN
related PostgreSQL writes
COMMIT

external effect
```

Kaçınılması gereken model:

```text
BEGIN
DB mutation
external effect
COMMIT
```

Özellikle email, Redis, S3 ve benzeri consumer'ları kontrol et.

### Çıktı

Non-transactional transaction/effect ordering audit sonucu.

### İlgili acceptance criterion

- [ ] Non-transactional consumer paths use `ITransactionPort.start()` for related database writes where a transaction is required, and commit-dependent external effects run only after commit.

---

## Adım 6 — Her consumer için retry failure-window analizi yap

Her consumer için özellikle şu senaryoyu incele:

```text
business work succeeds
        ↓
process crashes / job completion fails
        ↓
pg-boss delivery retries
        ↓
consumer runs again
```

İki ana vaka:

```text
DB commit başarılı
job completion başarısız
```

ve

```text
external effect başarılı
job completion başarısız
```

Her consumer'ın tekrar delivery geldiğinde nasıl davrandığını belirle.

### Çıktı

Consumer bazında retry-safety classification:

```text
safe
idempotent
deduplicated
safe-to-repeat
unsafe
```

### İlgili acceptance criterion

- [ ] Every consumer is safe when committed work or an external effect succeeds but job completion fails and the delivery is retried.

---

## Adım 7 — Authoritative-state ve duplicate-effect davranışını doğrula

Consumer retry edildiğinde gereken yerlerde current authoritative state'in yeniden okunup okunmadığını kontrol et.

Repeated effect'ler için aşağıdaki garantilerden en az biri bulunmalı:

```text
idempotent
veya
deduplicated
veya
explicitly safe to repeat
```

Stable `deliveryId` veya başka logical operation identity kullanılıyorsa bunun doğru semantiğe sahip olduğunu doğrula.

### Email logical-delivery invariant

Email delivery için hedef identity şu olmalıdır:

```text
deliveryId
→ logical email delivery identity

provider idempotency key
→ `${queueName}/${deliveryId}`
```

Kurallar:

- aynı logical email delivery retry edildiğinde aynı `deliveryId` kullanılmalı;
- provider idempotency key'e payload / body hash eklenmemeli;
- aynı `deliveryId` altında üretilen email payload'ı semantik olarak stabil olmalı;
- aynı `deliveryId` + farklı payload yeni bir logical delivery sayılmamalı; invariant violation olarak ele alınmalı;
- gerçekten farklı bir email gönderilecekse yeni `deliveryId` ve dolayısıyla yeni provider idempotency key üretilmeli;
- payload değişikliği provider identity'yi sessizce değiştirmemeli.

### Çıktı

Retry / dedup guarantee tablosu; email path'leri için logical delivery identity ve payload-stability sonucu dahil.

### İlgili acceptance criterion

- [ ] Repeated external effects are idempotent, deduplicated where supported, or explicitly documented as safely repeatable.

---

## Adım 8 — Email delivery modelini özel olarak doğrula

Email consumer'larını ayrıca incele.

Garanti şu seviyede kalmalı:

```text
provider idempotency
→ duplicate risk azaltılabilir

ama

exactly-once email delivery
→ garanti edilmez
```

Tüm email consumer'larda aynı `deliveryId` retry'ının aynı `from / to / subject / html` semantics'ini üretip üretmediğini doğrula.

Özellikle mevcut audit bulgusunu tek tek doğrula:

- `UserEmailConfirmationConsumer`: token / pending request identity stabil olsa da body current `user.name` içerdiği için retry payload'ı değişebilir;
- `AdminEmailConfirmationConsumer`: aynı nedenle current `admin.name` payload drift üretebilir;
- `UserRefreshReuseNoticeConsumer`: current email + current name yeniden okunduğu için recipient ve body değişebilir;
- `AdminRefreshReuseNoticeConsumer`: user refresh-reuse path'iyle aynı risk;
- `UserEmailChangeNotificationConsumer` / `AdminEmailChangeNotificationConsumer`: immutable notification row üzerinden payload stability'yi doğrula;
- `UserActivationConsumer` / `AdminInviteConsumer`: normal domain flow'da current contact/profile alanlarının aynı delivery boyunca değişemediği varsayımını doğrula.

### Provider idempotency key kararı

Hedef provider key:

```text
${queueName}/${deliveryId}
```

Mevcut `contentHash` provider idempotency key'den kaldırılmalıdır.

Resend davranışı application semantics'ine açıkça çevrilmelidir:

```text
same key + same payload
→ previous/cached provider result
→ duplicate physical send yok

same key + different payload
→ 409 invalid_idempotent_request
→ logical-delivery payload drift
→ non-retryable / terminal

409 concurrent_idempotent_requests
→ transient provider concurrency condition
→ retryable
```

`invalid_idempotent_request` normal retry döngüsüne bırakılmamalıdır. Bunun queue-layer exception'ını doğrudan email adapter'a sızdırmadan hangi application-level error classification ile terminal disposition'a çevrileceği bu adımda kesinleştirilmelidir.

Provider idempotency retention süresinin sınırlı olduğu dikkate alınmalı; provider key tek başına sınırsız exactly-once guarantee olarak kabul edilmemelidir.

Kod veya dokümantasyonda yanlış bir exactly-once varsayımı varsa işaretle.

### Çıktı

Email retry / delivery guarantee özeti:

- consumer bazında payload-stability classification,
- provider key invariant,
- retryable / terminal provider-error classification,
- 24 saatlik provider retention etkisi,
- Adım 9 correction listesi.

### İlgili acceptance criterion

- [ ] Email delivery does not claim exactly-once guarantees beyond the provider-supported idempotency behavior.

---

# Implementation Aşaması

## Implementation ön koşulu — Adım dokümanlarını yeniden incele

Source/config implementation'a başlamadan önce Adım 1–8 için üretilen tüm çalışma dokümanları **tek tek ve dikkatle yeniden okunmalıdır**.

Bu dokümanlar yalnız audit çıktısı değildir; implementation sırasında uygulanması gereken:

- doğrulanmış architecture kararlarını,
- consumer bazındaki transaction / retry değerlendirmelerini,
- worker profile ve dispatch kararlarını,
- açık riskleri ve sonraki adıma bırakılmış review noktalarını,
- correction ve regression-test gereksinimlerini

taşır.

Implementation yalnız ana plandaki özet maddelere dayanarak yapılmamalıdır. Adım dosyalarındaki daha ayrıntılı veya daha sonra refine edilmiş kararlar implementation için authoritative çalışma girdisi olarak ele alınmalı; birbirleriyle ve mevcut source ile birlikte yeniden doğrulanmalıdır.

Her implementation değişikliği için ilgili kararın hangi adım dokümanından geldiği anlaşılır olmalı ve önceki audit kararları sessizce değiştirilmemelidir. Yeni bir bulgu mevcut kararı geçersiz kılıyorsa önce ilgili audit sonucu / çalışma dokümanı güncellenmeli, ardından implementation yapılmalıdır.

## Adım 9 — Audit sonucundaki hataları sınıflandır ve düzelt

İlk sekiz adımdan çıkan problemleri şu kategorilerde sınıflandır:

```text
wrong transactional mode
wrong join()/start()
long transaction
external effect inside transaction
wrong post-commit ordering
unsafe retry
missing idempotency
missing deduplication
email logical-delivery payload drift
incorrect provider idempotency identity
incorrect provider retry classification
incorrect authoritative-state handling
unjustified workerOptions
missing / incorrect LISTEN-NOTIFY dispatch
unsafe or unbounded batch parallelism
```

Yalnızca doğrulanmış problemlere implementation yap.

Gerekirse:

- consumer transaction mode değiştir
- `join()` / `start()` kullanımını düzelt
- follow-up job ekle
- external effect'i ayrı consumer'a taşı
- idempotency / dedup mekanizması ekle
- authoritative-state handling'i düzelt
- email provider idempotency key'i `${queueName}/${deliveryId}` olarak uygula; `contentHash`'i provider key'den kaldır
- Adım 8 sonucuna göre mutable-payload email path'lerini aynı logical delivery için stabil payload üretecek şekilde düzelt
- `invalid_idempotent_request` sonucunu non-retryable / terminal olarak sınıflandır; normal retry döngüsüne bırakma
- `concurrent_idempotent_requests` sonucunu retryable transient provider failure olarak koru
- yeni logical email için yeni `deliveryId` üretildiğini ve aynı `deliveryId` altında payload drift'in yeni provider identity üretmediğini garanti et
- `workerOptions` değerlerini workload ve kapasite gerekçesine göre güncelle
- pg-boss `LISTEN/NOTIFY` wake-up path'ini implemente et
- custom job-queue database adapter'a gerekli listener desteğini ekle
- worker'ı bulunan immediately-available queue'ları notify-enabled hale getir
- Adım 2'de kararlaştırılan standart polling profillerini uygula:
    - `critical`: `1s / 5s`
    - `high`: `5s / 10s`
    - `medium`: `15s / 30s`
    - `low`: `30s / 60s`
      (`pollingIntervalSeconds / notifyPollingIntervalSeconds`)
- her consumer'ı Adım 2'deki workload profiline bağla; mevcut `2s` / `3s` gibi ara fallback değerlerini profil standardına normalize et
- `pollingIntervalSeconds` değerini listener-unavailable fallback, `notifyPollingIntervalSeconds` değerini healthy-listener retry / delayed / redrive backstop olarak kullan
- generic batch parallelization ekleme; yalnız audit ile doğrulanan consumer-specific bounded parallelism gerekiyorsa uygula

### İlgili acceptance criterion

- [ ] Incorrect transaction modes, transaction-boundary usage, retry behavior, worker settings, or dispatch configuration identified by the review are corrected.
- [ ] Immediately available application jobs use the verified `LISTEN/NOTIFY` wake-up path with bounded polling fallback.

---

## Adım 10 — Regression ve failure-path testlerini ekle

Corrected veya high-risk consumer path'leri için testler ekle.

Temel senaryolar:

```text
DB work succeeds → completion fails → retry
external effect succeeds → completion fails → retry
transaction rolls back
duplicate delivery
worker restart
consumer retry
follow-up job creation + rollback
follow-up job creation + commit
LISTEN/NOTIFY immediate wake-up
missed notification → safety-net polling recovery
listener unavailable → pollingIntervalSeconds fallback
multi-node notification → single successful job claim
same email delivery + same payload → same provider key / duplicate send yok
same email delivery + different payload → 409 invalid_idempotent_request → terminal
409 concurrent_idempotent_requests → retryable
new logical email delivery → new deliveryId / new provider key
```

Transactional consumer için ayrıca:

```text
business mutation
+
follow-up job
+
job completion
```

atomicity'sini doğrula.

Non-transactional consumer için commit-dependent external effect'in commit öncesinde gerçekleşmediğini test et.

Worker settlement için ayrıca non-transactional batch'te bir job failure'ının diğer job disposition'larını topluca fail ettirmediğini doğrula. Generic batch parallelization eklenmediğini ve transactional consumer'ların `batchSize: 1` invariant'ını koruduğunu test et.

Email regression testlerinde provider key'in yalnız `queueName/deliveryId` ile üretildiğini; payload drift'in yeni key üretmek yerine terminal conflict'e dönüştüğünü; concurrent idempotency conflict'in ise retry edildiğini doğrula.

### İlgili acceptance criterion

- [ ] Regression coverage verifies the relevant transaction and retry-safety guarantees for corrected or high-risk consumer paths.
- [ ] Regression coverage verifies notification wake-up, missed-notification recovery, listener fallback, and safe multi-node claiming.

---

## Adım 11 — Jobs & Messaging / Data & State dokümantasyonunu güncelle

Gerçek implementation ile dokümanların aynı davranışı tanımladığını doğrula.

Dokümante edilmesi gereken temel kurallar:

- transactional consumer ne zaman kullanılır?
- `join()` ne zaman kullanılır?
- `start()` ne zaman kullanılır?
- external effect nasıl ve ne zaman yapılır?
- retry guarantee nedir?
- logical delivery identity nasıl kullanılır?
- email provider idempotency key neden `queueName/deliveryId` olur ve payload drift nasıl invariant violation olarak ele alınır?
- Resend `invalid_idempotent_request` ile `concurrent_idempotent_requests` nasıl farklı sınıflandırılır?
- provider idempotency retention sınırı exactly-once guarantee'i nasıl etkiler?
- `workerOptions` nasıl workload, latency, replica sayısı ve dependency kapasitesine göre ayarlanır?
- `critical / high / medium / low` polling profilleri ve consumer-profile eşlemesi nasıl uygulanır?
- `LISTEN/NOTIFY`, safety-net polling ve listener-unavailable fallback nasıl çalışır?
- multi-node notification ile job claim / ownership arasındaki fark nedir?
- batch size ile execution concurrency neden ayrıdır ve parallelism neden `localConcurrency` ile bounded tutulur?
- exactly-once nerede garanti edilmez?

### Çıktı

Jobs & Messaging ve Data & State guidance, doğrulanmış implementation ile uyumlu hale gelir.

---

## Adım 12 — Final acceptance review

Issue kapatılmadan önce tüm acceptance criteria tek tek doğrulanır:

- [ ] Tüm durable queue consumer'lar inventory'de ve handler / pipeline davranışlarıyla birlikte incelendi.
- [ ] Her transactional consumer için atomic consumer write + job completion gereksiniminin justification'ı mevcut.
- [ ] Her consumer'ın `localConcurrency`, `pollingIntervalSeconds` ve `batchSize` değerleri workload, latency, transaction mode, database / pool baskısı, external dependency kapasitesi ve horizontal scaling açısından incelendi.
- [ ] Gereksiz agresif polling / concurrency / batch ayarları correction aşamasında güncellendi; `critical / high / medium / low` polling profilleri uygulanmış, deferred işler DB'yi gereksiz yere poll etmiyor ve latency-sensitive işler gerekli tepki süresini koruyor.
- [ ] Immediately-available application jobs `LISTEN/NOTIFY` ile prompt wake-up alıyor; safety-net polling, listener-unavailable fallback ve missed-notification recovery test edildi.
- [ ] Multi-node deployment'ta notification broadcast duplicate ownership yaratmıyor; actual execution pg-boss claim / locking ile belirleniyor.
- [ ] Generic batch parallelization eklenmedi; execution parallelism `localConcurrency` ile bounded ve transactional consumer'larda `batchSize: 1` korunuyor.
- [ ] Transactional consumer path'leri yalnızca kısa PostgreSQL işi yapıyor ve application-owned transaction'larda `ITransactionPort.join()` kullanıyor.
- [ ] Transactional consumer path'lerinde shared transaction içinde external business effect yok.
- [ ] Non-transactional consumer path'lerinde gerekli DB transaction'ları `ITransactionPort.start()` kullanıyor.
- [ ] Commit-dependent external effect'ler commit sonrasında çalışıyor.
- [ ] Her consumer, committed work veya external effect başarılı olup job completion başarısız olduğunda retry-safe.
- [ ] Repeated external effect'ler idempotent, deduplicated veya açıkça safe-to-repeat.
- [ ] Email delivery provider idempotency'nin ötesinde exactly-once guarantee iddia etmiyor.
- [ ] Bulunan incorrect transaction mode, transaction-boundary veya retry davranışları düzeltildi.
- [ ] Corrected veya high-risk consumer path'leri regression testlerle korunuyor.
- [ ] Jobs & Messaging ve Data & State dokümantasyonu doğrulanmış implementation ile uyumlu.

---

## Çalışma Sırası

```text
Adım 1  Inventory
   ↓
Adım 2  Transaction mode / workerOptions / dispatch
   ↓
Adım 3  Transaction boundaries
   ↓
Adım 4  Transactional external effects
   ↓
Adım 5  Non-transactional effect ordering
   ↓
Adım 6  Retry failure windows
   ↓
Adım 7  Authoritative state / dedup
   ↓
Adım 8  Email delivery guarantees
   ↓
──────────── Audit tamamlandı ────────────
   ↓
Adım 9  Corrections
   ↓
Adım 10 Regression tests
   ↓
Adım 11 Documentation
   ↓
Adım 12 Final acceptance review
```

Implementation'a **Adım 1–8 tamamlanmadan başlanmamalıdır**.
