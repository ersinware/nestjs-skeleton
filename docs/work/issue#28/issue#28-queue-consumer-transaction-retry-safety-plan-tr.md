# Issue #28 — Queue Consumer Transaction ve Retry Safety Planı

## Amaç

Projede bulunan tüm durable queue consumer'ları inceleyerek transaction mode, worker execution ayarları, PostgreSQL boundary, external effect ordering ve retry davranışlarının doğru ve bilinçli olduğunu doğrulamak.

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

### Çıktı

Queue consumer inventory tablosu; tüm `workerOptions` değerlerini ve bunların workload / ölçekleme değerlendirmesini içerir.

### İlgili acceptance criterion

- [ ] Every durable queue consumer is inventoried and reviewed with the handlers and pipeline behavior it invokes.
- [ ] Every consumer's `workerOptions` are inventoried and reviewed against latency requirements, workload characteristics, transaction mode, database pressure, external dependency capacity, and horizontal scaling behavior.

---

## Adım 2 — Her consumer'ın transaction mode ve workerOptions ayarlarını doğrula

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

### Çıktı

Her consumer için:

```text
transaction mode
+
justification
+
workerOptions assessment
+
change recommendation (if needed)
```

### İlgili acceptance criterion

- [ ] Each transactional consumer has a documented justification for requiring atomic consumer writes and job completion.
- [ ] Every consumer's `workerOptions` are justified against latency, throughput, transaction mode, database / pool pressure, external dependency capacity, and horizontal scaling.

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

### Çıktı

Retry / dedup guarantee tablosu.

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

Kod veya dokümantasyonda yanlış bir exactly-once varsayımı varsa işaretle.

### Çıktı

Email retry / delivery guarantee özeti.

### İlgili acceptance criterion

- [ ] Email delivery does not claim exactly-once guarantees beyond the provider-supported idempotency behavior.

---

# Implementation Aşaması

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
incorrect authoritative-state handling
unjustified workerOptions
```

Yalnızca doğrulanmış problemlere implementation yap.

Gerekirse:

- consumer transaction mode değiştir
- `join()` / `start()` kullanımını düzelt
- follow-up job ekle
- external effect'i ayrı consumer'a taşı
- idempotency / dedup mekanizması ekle
- authoritative-state handling'i düzelt
- `workerOptions` değerlerini workload ve kapasite gerekçesine göre güncelle

### İlgili acceptance criterion

- [ ] Incorrect transaction modes, transaction-boundary usage, or retry behavior identified by the review are corrected.

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

### İlgili acceptance criterion

- [ ] Regression coverage verifies the relevant transaction and retry-safety guarantees for corrected or high-risk consumer paths.

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
- `workerOptions` nasıl workload, latency, replica sayısı ve dependency kapasitesine göre ayarlanır?
- exactly-once nerede garanti edilmez?

### Çıktı

Jobs & Messaging ve Data & State guidance, doğrulanmış implementation ile uyumlu hale gelir.

---

## Adım 12 — Final acceptance review

Issue kapatılmadan önce tüm acceptance criteria tek tek doğrulanır:

- [ ] Tüm durable queue consumer'lar inventory'de ve handler / pipeline davranışlarıyla birlikte incelendi.
- [ ] Her transactional consumer için atomic consumer write + job completion gereksiniminin justification'ı mevcut.
- [ ] Her consumer'ın `localConcurrency`, `pollingIntervalSeconds` ve `batchSize` değerleri workload, latency, transaction mode, database / pool baskısı, external dependency kapasitesi ve horizontal scaling açısından incelendi.
- [ ] Gereksiz agresif polling / concurrency / batch ayarları correction aşamasında güncellendi; deferred işler DB'yi gereksiz yere poll etmiyor ve latency-sensitive işler gerekli tepki süresini koruyor.
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
Adım 2  Transaction mode / workerOptions
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