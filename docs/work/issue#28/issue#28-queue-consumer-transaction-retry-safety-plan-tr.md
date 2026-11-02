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

Her consumer için yalnız normal retry'ı değil, şu zincirin tamamını incele:

```text
business work / external effect succeeds
        ↓
process crashes / job completion fails
        ↓
pg-boss delivery retries
        ↓
retry'lar tükenir
        ↓
shared DLQ
        ↓
daha sonra redrive
        ↓
aynı logical delivery tekrar çalışır
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

Ayrıca DLQ/redrive sırasında:

- physical pg-boss job ID değişebilir;
- payload içindeki `deliveryId` / logical identity'nin korunup korunmadığını doğrula;
- redrive gecikmesinin external idempotency/dedup retention süresini aşabileceğini hesaba kat;
- normal retry'da güvenli görünen bir effect'in geç redrive'da tekrar üretilebildiği durumları `unsafe` olarak işaretle.

Her consumer'ın normal retry ve DLQ/redrive sonrasında nasıl davrandığını belirle.

### Çıktı

Consumer bazında retry-safety classification:

```text
safe
idempotent
deduplicated
safe-to-repeat
unsafe
```

`deduplicated` classification yalnız bounded provider retention'a dayanıyorsa bunu kalıcı/unbounded guarantee gibi kullanma.

### İlgili acceptance criterion

- [ ] Every consumer is classified for normal retry and DLQ/redrive safety; defects owned by Issue #28 are corrected, and cross-cutting defects intentionally outside this issue are linked to dedicated follow-up issues.

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

DLQ/redrive sırasında physical job identity değişse bile logical delivery identity'nin korunması gereken path'lerde bunu ayrıca doğrula.

### Email logical-delivery invariant

Email delivery için hedef identity şu olmalıdır:

```text
deliveryId
→ logical email delivery identity

provider idempotency key
→ `${queueName}/${deliveryId}`
```

Kurallar:

- aynı logical email delivery retry/redrive edildiğinde aynı `deliveryId` kullanılmalı;
- provider idempotency key'e payload / body hash eklenmemeli;
- aynı `deliveryId` altında üretilen email payload'ı semantik olarak stabil olmalı;
- aynı `deliveryId` + farklı payload yeni bir logical delivery sayılmamalı; invariant violation olarak ele alınmalı;
- gerçekten farklı bir email gönderilecekse yeni `deliveryId` ve dolayısıyla yeni provider idempotency key üretilmeli;
- payload değişikliği provider identity'yi sessizce değiştirmemeli.

### Çıktı

Retry / dedup guarantee tablosu; email path'leri için logical delivery identity, DLQ/redrive identity ve payload-stability sonucu dahil.

### İlgili acceptance criterion

- [ ] Repeated external effects are idempotent, deduplicated where supported, or explicitly documented as safely repeatable across retry and DLQ/redrive.

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

Tüm email consumer'larda aynı `deliveryId` retry/redrive'ının aynı `from / to / subject / html` semantics'ini üretip üretmediğini doğrula.

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
→ retention süresi içinde duplicate physical send yok

same key + different payload
→ 409 invalid_idempotent_request
→ logical-delivery payload drift
→ non-retryable / terminal

409 concurrent_idempotent_requests
→ transient provider concurrency condition
→ retryable
```

`invalid_idempotent_request` normal retry döngüsüne bırakılmamalıdır. Bunun queue-layer exception'ını doğrudan email adapter'a sızdırmadan hangi application-level error classification ile terminal disposition'a çevrileceği bu adımda kesinleştirilmelidir.

Provider idempotency retention süresi sınırlıdır. Bu nedenle:

```text
same deliveryId
→ DLQ
→ retention süresinden daha geç redrive
→ aynı provider key
→ provider eski key'i artık hatırlamıyor olabilir
→ duplicate physical send mümkün
```

Bu risk tüm email consumer'ları için değerlendirilmelidir; stable payload tek başına unbounded dedup guarantee değildir.

Kod veya dokümantasyonda yanlış bir exactly-once varsayımı varsa işaretle.

### Çıktı

Email retry / delivery guarantee özeti:

- consumer bazında payload-stability classification,
- provider key invariant,
- retryable / terminal provider-error classification,
- provider retention etkisi,
- DLQ/redrive sonrası duplicate-send riski,
- Adım 9 correction listesi.

### İlgili acceptance criterion

- [ ] Email delivery does not claim exactly-once guarantees beyond the provider-supported idempotency behavior, including delayed DLQ/redrive beyond provider retention.

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
provider-retention / delayed-redrive duplicate risk
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
- Adım 8 sonucuna göre provider retention süresini aşan delayed DLQ/redrive için gerekli duplicate-effect stratejisini uygula veya açıkça sınırlandır
- `UserAvatarReplaceConsumer` / `AdminAvatarReplaceConsumer` için bulunan `SUPERSEDED` cleanup + replayable upload-proof race'ini Issue #28 içinde düzeltme; remediation Issue #30 scope'undadır
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
retry exhaustion → shared DLQ
DLQ redrive → same logical deliveryId
physical pg-boss job ID may change across redrive
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
same email delivery + same payload → same provider key
same email delivery + different payload → 409 invalid_idempotent_request → terminal
409 concurrent_idempotent_requests → retryable
new logical email delivery → new deliveryId / new provider key
delayed email redrive beyond provider retention → selected application strategy is enforced
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

Email regression testlerinde provider key'in yalnız `queueName/deliveryId` ile üretildiğini; payload drift'in yeni key üretmek yerine terminal conflict'e dönüştüğünü; concurrent idempotency conflict'in retry edildiğini; DLQ/redrive'ın logical `deliveryId`'yi koruduğunu doğrula.

### İlgili acceptance criterion

- [ ] Regression coverage verifies the relevant transaction and retry-safety guarantees for corrected or high-risk consumer paths.
- [ ] Regression coverage verifies retry exhaustion, DLQ/redrive logical identity, and the selected delayed-redrive external-effect strategy.
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
- retry exhaustion, DLQ ve redrive nasıl çalışır?
- physical job identity ile logical `deliveryId` arasındaki fark nedir?
- logical delivery identity nasıl kullanılır?
- email provider idempotency key neden `queueName/deliveryId` olur ve payload drift nasıl invariant violation olarak ele alınır?
- Resend `invalid_idempotent_request` ile `concurrent_idempotent_requests` nasıl farklı sınıflandırılır?
- provider idempotency retention sınırı ve delayed redrive exactly-once guarantee'i nasıl etkiler?
- `workerOptions` nasıl workload, latency, replica sayısı ve dependency kapasitesine göre ayarlanır?
- `critical / high / medium / low` polling profilleri ve consumer-profile eşlemesi nasıl uygulanır?
- `LISTEN/NOTIFY`, safety-net polling ve listener-unavailable fallback nasıl çalışır?
- multi-node notification ile job claim / ownership arasındaki fark nedir?
- batch size ile execution concurrency neden ayrıdır ve parallelism neden `localConcurrency` ile bounded tutulur?
- exactly-once nerede garanti edilmez?

### Çıktı

Jobs & Messaging ve Data & State guidance, doğrulanmış implementation ile uyumlu hale gelir.

---

## Adım 12 — Acceptance review

Issue kapatılmadan önce acceptance criteria tek tek doğrulanır:

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
- [ ] Her consumer normal retry ve DLQ/redrive safety açısından sınıflandırıldı; Issue #28 scope'undaki defect'ler düzeltildi, cross-cutting defect'ler dedicated issue'lara bağlandı.
- [ ] DLQ/redrive sırasında logical delivery identity korunuyor; physical job identity ile karıştırılmıyor.
- [ ] Repeated external effect'ler idempotent, deduplicated veya açıkça safe-to-repeat; aksi durumda consumer açıkça `unsafe` sınıflandırılıp dedicated follow-up issue'ya bağlanıyor. Bounded provider retention unbounded guarantee olarak kabul edilmiyor.
- [ ] Email delivery provider idempotency'nin ötesinde exactly-once guarantee iddia etmiyor.
- [ ] Delayed email redrive'ın provider retention'ı aşma riski için belirlenen application davranışı uygulanmış ve test edilmiş.
- [ ] Bulunan incorrect transaction mode, transaction-boundary veya retry davranışları düzeltildi.
- [ ] Corrected veya high-risk consumer path'leri regression testlerle korunuyor.
- [ ] Jobs & Messaging ve Data & State dokümantasyonu doğrulanmış implementation ile uyumlu.

---

## Adım 13 — `docs/idempotency-retry-inventory.md` dosyasını final durumla güncelle

Bu dosyayı audit/implementation devam ederken parça parça değiştirme. Adım 1–12 sonuçları ve gerçek implementation kesinleştikten sonra tek seferde final davranışla hizala.

Güncellemede özellikle:

- HTTP request retry-safety ile downstream queue consumer retry-safety'yi birbirinden açıkça ayır;
- endpoint seviyesinde `Retry-safe: Yes` ifadesinin downstream external effect için exactly-once anlamına gelmediğini belirt;
- Issue Ownership altında `#28` kapsamını queue retry, DLQ/redrive ve external-effect deduplication safety'yi içerecek şekilde güncelle;
- durable email work üreten ilgili HTTP endpoint'lerin `Tracked by` alanına, final implementation'a göre `#28` ownership'i ekle;
- physical pg-boss job ID ile logical `deliveryId` farkını ve DLQ/redrive sırasında `deliveryId`'nin korunması gerektiğini belirt;
- provider idempotency retention'ın sınırlı olduğunu ve delayed redrive'ın duplicate external effect üretebileceğini final davranışa göre dokümante et;
- Maintenance Rules'a, durable job oluşturan endpoint'lerde HTTP idempotency ile consumer delivery safety'nin ayrı sınıflandırılması gerektiğini ekle;
- dosyadaki tüm satırları final source ve Adım 1–12 kararlarıyla yeniden doğrula; yalnız yeni email bulgularını patch edip diğer stale satırları bırakma.
- Issue #30 çözülmemişse avatar upload / downstream consumer safety sınırını final inventory'de yanlışlıkla `retry-safe` / exactly-once gibi göstermeme; gerekli cross-reference'i koru.

### İlgili acceptance criterion

- [ ] `docs/idempotency-retry-inventory.md` final implementation ile uyumludur ve HTTP retry-safety ile downstream queue/DLQ-redrive safety'yi birbirine karıştırmaz.

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
Adım 6  Retry / DLQ / redrive failure windows
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
Adım 12 Acceptance review
   ↓
Adım 13 Final idempotency/retry inventory update
```

Implementation'a **Adım 1–8 tamamlanmadan başlanmamalıdır**.

---

## Takip issue'su — #30 Avatar upload proof lifecycle ve stale cleanup race

Issue #28 audit'i sırasında `UserAvatarReplaceConsumer` ve `AdminAvatarReplaceConsumer` için cross-cutting bir race doğrulandı.

```text
consumer delivery'yi SUPERSEDED okur
→ eski upload proof hâlâ geçerlidir
→ aynı avatar tekrar selected/pending olabilir
→ stale consumer destructive S3 cleanup yapabilir
```

Bu nedenle iki consumer Issue #28 içinde koşulsuz `safe-to-repeat` sayılmamalı; classification:

```text
UserAvatarReplaceConsumer  → unsafe — tracked by #30
AdminAvatarReplaceConsumer → unsafe — tracked by #30
```

Normal same-delivery copy/commit/cleanup reconciliation davranışı korunmalıdır; ancak remediation Issue #28 scope'una alınmamalıdır.

`UserAvatarFinalizeConsumer` ve `AdminAvatarFinalizeConsumer` #28'de doğrulanan retry/crash/DLQ-redrive window'larında `safe-to-repeat` kalır. Bu sonuç global avatar-lifecycle safety garantisi değildir; **Issue #30 finalize path'leri de yeniden incelemeli ve gerekirse bu classification'ı supersede etmelidir.**

**Issue #30 kapsamında:**

- user ve admin avatar upload lifecycle gerektiği kadar uçtan uca yeniden incelenmeli;
- upload initiation, proof validation, profile update, replacement/finalization ve destructive cleanup birlikte değerlendirilmelidir;
- `UserAvatarFinalizeConsumer` / `AdminAvatarFinalizeConsumer` için #28'de verilen scoped `safe-to-repeat` sonucu broader lifecycle ve concurrency senaryolarına karşı yeniden doğrulanmalıdır;
- upload proof'ların replayable kalması ile single-use / consumed proof modeline geçilmesi karşılaştırılmalıdır;
- başka bir authoritative coordination modeli daha uygunsa değerlendirilmelidir;
- stale cleanup'ın delete anında selected olan pending/permanent avatarı silememesi garanti edilmelidir;
- user/admin flow'ları için concurrency regression testleri eklenmelidir.

Issue #28 yalnız bulguyu doğru sınıflandırır ve #30'a bağlar; implementation #30'a aittir.
