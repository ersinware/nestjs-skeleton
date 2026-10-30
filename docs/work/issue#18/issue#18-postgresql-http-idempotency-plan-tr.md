# Issue #18 — PostgreSQL-backed HTTP Mutation Idempotency ve Retry Safety Planı

## Amaç

PostgreSQL-backed mutating HTTP request'lerde retry, timeout ve connection loss sonrasında oluşabilecek ambiguous outcome durumlarını güvenli şekilde ele almak.

Bu issue yalnızca şu boundary'yi kapsar:

```text
HTTP request
    ↓
PostgreSQL-backed mutation
```

Ortak endpoint envanteri:

```text
docs/idempotency-retry-inventory.md
```

dosyasında tutulur. #18 bu envanterde `Tracked by` alanında `#18` ile işaretlenen PostgreSQL-backed HTTP concern'lerini ele alır.

## Issue sınırları

```text
#18
HTTP → PostgreSQL
idempotency
retry safety
ambiguous outcome

#29
HTTP → Redis
idempotency
retry safety
ambiguous outcome

#16
Redis mutation
    ↓
mandatory PostgreSQL / pg-boss follow-up
durable coordination

#28
queue consumer
transaction correctness
retry / dedup safety
```

Bu concern'ler aynı flow üzerinde birlikte bulunabilir ancak ayrı sorumluluklar olarak ele alınmalıdır.

---

# Audit / Design Aşaması

## Adım 1 — Ortak inventory'yi #18 açısından doğrula

`docs/idempotency-retry-inventory.md` dosyasını source of truth olarak kullan.

Production'daki tüm mutating HTTP endpoint'lerin inventory'de bulunduğunu doğrula.

Her PostgreSQL-backed endpoint için en az şu bilgilerin doğru olduğunu kontrol et:

- HTTP method / route
- command / handler
- PostgreSQL mutation
- Redis mutation / effect varsa bunun ayrı boundary olarak kaydı
- diğer external effect'ler
- natural idempotency
- retry safety
- explicit request-level idempotency gereksinimi
- replay / retry davranışı
- `Tracked by` ownership

#18 kapsamındaki kayıtların `Tracked by` alanında `#18` bulunduğunu doğrula.

### Çıktı

Doğrulanmış shared inventory.

### İlgili acceptance criterion

- [ ] All mutating HTTP endpoints are inventoried and classified by their retry and idempotency requirements.

---

## Adım 2 — PostgreSQL-backed endpoint classification'ını kesinleştir

#18 kapsamındaki her endpoint'i şu kategorilerden biriyle doğrula:

```text
naturally idempotent
retry-safe
explicit idempotency required
```

Classification yalnız HTTP method'a göre yapılmamalı.

Gerçek davranış üzerinden kontrol et:

- aynı logical request ikinci kez geldiğinde ikinci business mutation oluşuyor mu?
- uniqueness constraint ikinci mutation'ı engelliyor mu?
- domain state ikinci uygulamayı no-op veya invalid hale getiriyor mu?
- proof/token consumption ikinci mutation'ı engelliyor mu?
- duplicate audit veya durable job üretilebiliyor mu?
- response kaybolduğunda client'ın original logical sonucu yeniden elde etmesi gerekiyor mu?

Retry-safe olması, retry'ın aynı HTTP response'u döndürmesi gerektiği anlamına gelmez.

### Çıktı

Her #18 endpoint'i için kesin idempotency / retry-safety classification.

---

## Adım 3 — Explicit idempotency kontratını kesinleştir

Yalnızca `explicit idempotency required` olarak doğrulanan endpoint'lerde request-level idempotency uygula.

Client contract:

```http
Idempotency-Key: <random UUID>
```

Kurallar:

- Client aynı logical operation'ın retry'ında aynı key'i kullanır.
- Yeni logical operation yeni key kullanır.
- Key global unique olur.
- `scope` kullanılmaz.
- Server request semantics üzerinden deterministic fingerprint üretir.
- Operation / endpoint identity fingerprint'e dahil edilir.
- Same key + same fingerprint = replay.
- Same key + different fingerprint = conflict.

Endpoint bazında fingerprint semantics'i inventory veya kalıcı teknik dokümantasyonda açıkça tanımla.

Secret değerler plaintext veya unkeyed hash olarak persist edilmemelidir.

### İlgili acceptance criterion

- [ ] Reusing an idempotency identity with different request semantics or payload is rejected.

---

## Adım 4 — Persisted idempotency modelini kesinleştir

Persisted model yalnız mevcut endpoint gereksinimleri kadar geniş olmalı.

Başlangıç modeli:

```text
idempotency.operation
├── key UUID PRIMARY KEY
├── fingerprint TEXT NOT NULL
├── created_at TIMESTAMPTZ NOT NULL
└── optional replay metadata
```

Inventory'deki gerçek replay ihtiyacına göre gerekirse:

```text
resource_id UUID NULL
```

gibi sınırlı metadata ekle.

Gereksiz alan ekleme:

- `scope`
- işlem state'i için gereksiz `status`
- row başına gereksiz `expires_at`
- generic response/result blob

Retention merkezi olarak `created_at` üzerinden yönetilebilir.

### Çıktı

Migration'a hazır final idempotency persistence modeli.

---

# Implementation Aşaması

## Adım 5 — HTTP idempotency application abstraction'ını ekle

PostgreSQL-backed HTTP idempotency için application-level bir abstraction oluştur.

Exact interface mevcut architecture/style ile uyumlu olmalı; ancak şu invariant'ları korumalı:

- key ve fingerprint ile operation claim edilir
- replay business callback'i tekrar çalıştırmaz
- persisted idempotency state ile business mutation aynı PostgreSQL transaction'ını paylaşır
- replay metadata gerekiyorsa aynı transaction içinde persist edilir

Tüm `CommandPipeline` idempotency transaction'ı içine alınmamalıdır.

Transaction yalnız PostgreSQL commit boundary'sini kapsamalıdır.

Transaction dışında kalması gereken işler olabilir:

- authentication / authorization hazırlığı
- token verification
- hashing
- S3 read
- Redis operation
- diğer external I/O

### Transaction invariant

```text
BEGIN

idempotency operation
business mutation
audit
pg-boss jobs
optional replay metadata

COMMIT
```

Bunlardan biri rollback olursa idempotency operation da rollback olmalıdır.

### İlgili acceptance criterion

- [ ] For PostgreSQL-backed operations, persisted idempotency state and the corresponding business mutation commit or roll back together.

---

## Adım 6 — Replay ve same-key concurrency davranışını uygula

### İlk request

```text
key = A
fingerprint = X
```

Operation claim edilir ve business mutation aynı transaction içinde uygulanır.

### Lost response sonrası retry

Transaction commit olur ancak HTTP response client'a ulaşmaz:

```text
key = A
fingerprint = X
```

Retry durumunda:

- business mutation tekrar çalıştırılmaz
- duplicate audit oluşturulmaz
- duplicate pg-boss job oluşturulmaz
- endpoint'in tanımlı success semantics'i replay edilir
- gerekiyorsa persisted replay metadata döndürülür

### Aynı key farklı logical request

```text
key = A
fingerprint = Y
```

Stored fingerprint farklıysa request conflict olarak reddedilir.

### Concurrent same-key request'ler

İki request aynı key ile eşzamanlı gelebilir.

Concurrency control PostgreSQL operation key uniqueness üzerinden yapılmalı.

Beklenen invariant:

```text
same key
    ↓
tek logical operation
    ↓
tek business mutation
```

Unique violation sonrasında aborted transaction içinde query yapmaya dayalı tasarım kullanılmamalıdır.

Winner rollback olursa contender normal şekilde operation'ı claim edebilmelidir.

Distributed lock eklenmemelidir; PostgreSQL coordination yeterli olmalıdır.

### İlgili acceptance criteria

- [ ] Repeating the same idempotent HTTP operation does not apply the underlying business mutation more than once.
- [ ] Concurrent requests for the same idempotent HTTP operation resolve to one consistent logical outcome.

---

## Adım 7 — Yalnız inventory'nin seçtiği endpoint'lere entegre et

Global olarak tüm command veya mutating endpoint'lere `Idempotency-Key` zorunluluğu getirme.

Yalnız inventory'de `explicit idempotency required` olarak doğrulanmış #18 endpoint'lerine uygula.

Her endpoint için:

1. `Idempotency-Key` header validation ekle.
2. Endpoint-specific fingerprint üret.
3. PostgreSQL mutation boundary'sini idempotency abstraction üzerinden çalıştır.
4. Replay sırasında business mutation / audit / durable job üretme.
5. Same-key different-fingerprint conflict davranışını uygula.
6. Gerekli replay metadata'yı persist et ve geri döndür.
7. OpenAPI contract'ını güncelle.
8. Mevcut authorization, audit ve transaction invariant'larını koru.

### İlgili acceptance criteria

- [ ] Unsafe ambiguous HTTP mutations are not automatically retried without idempotency protection.
- [ ] Preserve existing application guarantees when idempotency and retry handling are introduced.

---

## Adım 8 — Ambiguous outcome ve retry politikasını uygula

PostgreSQL write attempt sonrasında:

- timeout
- connection loss
- response loss

durumları mutation'ın gerçekleşmediğinin kanıtı olarak değerlendirilmemelidir.

```text
write attempt
    ↓
outcome unknown
    ↓
ambiguous outcome
```

Unsafe mutation otomatik olarak yeni operation gibi retry edilmemelidir.

Explicit idempotency kullanılan endpoint'te aynı logical operation aynı key ile retry edilmelidir.

Naturally idempotent veya retry-safe endpoint'lerde mevcut verified semantics korunmalıdır.

HTTP retry davranışı observability tarafından görünür olmalı; repeated veya ambiguous PostgreSQL failure'lar gizlenmemelidir.

### İlgili acceptance criteria

- [ ] A timeout or connection loss after a PostgreSQL mutation is treated as an ambiguous outcome, not as evidence that the mutation failed.
- [ ] Unsafe ambiguous HTTP mutations are not automatically retried without idempotency protection.
- [ ] HTTP retry behavior is observable and does not hide repeated or ambiguous PostgreSQL failures.

---

## Adım 9 — Retention ve cleanup politikasını uygula

Persisted idempotency operation kayıtları için retention window belirle ve dokümante et.

Retention kaynağı:

```text
created_at
```

Cleanup merkezi bir policy ile yapılmalı.

Örnek:

```sql
DELETE FROM idempotency.operation
WHERE created_at < now() - interval '<retention>';
```

Retention süresi belirlenirken:

- gerçekçi maksimum client retry penceresi
- operasyonel recovery ihtiyaçları
- table growth
- replay guarantee süresi

dikkate alınmalıdır.

Cleanup sonrası aynı key'in artık protected replay window dışında olduğu açıkça dokümante edilmelidir.

### İlgili acceptance criterion

- [ ] Idempotency records and operation identifiers have a documented retention and cleanup policy.

---

## Adım 10 — Regression, concurrency ve failure-path testlerini ekle

En az şu senaryolar doğrulanmalı:

### Core idempotency

- ilk request başarılı olur
- same key + same fingerprint replay olur
- same key + different fingerprint conflict olur
- concurrent same-key request'ler logical mutation'ı yalnız bir kez uygular
- winner rollback olursa contender ilerleyebilir

### Atomicity

- business mutation rollback olduğunda idempotency operation da rollback olur
- idempotency operation business mutation'dan bağımsız commit olmaz
- audit replay sırasında duplicate olmaz
- pg-boss job replay sırasında duplicate olmaz

### Ambiguous outcome

- DB commit başarılı ancak HTTP response kayıp
- client aynı key ile retry eder
- ikinci business mutation oluşmaz
- endpoint'in tanımlı success semantics'i geri döner

### Replay metadata

- gerekiyorsa original resource / operation identity replay edilir
- replay yeni resource / operation üretmez

### Retention

- retention dışındaki kayıtlar cleanup edilir
- retention içindeki kayıtlar korunur

### İlgili acceptance criteria

- [ ] Repeating the same idempotent HTTP operation does not apply the underlying business mutation more than once.
- [ ] Concurrent requests for the same idempotent HTTP operation resolve to one consistent logical outcome.
- [ ] For PostgreSQL-backed operations, persisted idempotency state and the corresponding business mutation commit or roll back together.

---

## Adım 11 — Inventory ve kalıcı dokümantasyonu güncelle

Implementation doğrulandıktan sonra:

```text
docs/idempotency-retry-inventory.md
```

dosyasını gerçek final behavior ile uyumlu hale getir.

Her endpoint için:

- classification
- explicit idempotency requirement
- replay / retry behavior
- issue ownership

güncel olmalı.

Kalıcı architecture / HTTP / data-state dokümantasyonunda şu garantileri açıkla:

- ambiguous PostgreSQL outcome
- request-level idempotency contract
- replay semantics
- same-key conflict behavior
- concurrency guarantee
- retention window
- exactly-once sınırları

#18'e özel geçici `docs/work/issue-18/` dosyaları merge öncesinde gözden geçirilmeli; kalıcı değeri olmayan çalışma dokümanları main'e taşınmamalıdır.

### İlgili acceptance criterion

- [ ] Cases where request idempotency cannot provide exactly-once effects are documented.

---

## Adım 12 — Final acceptance review

Issue kapatılmadan önce tüm acceptance criteria tek tek doğrulanmalı:

- [ ] Tüm mutating production HTTP endpoint'ler ortak inventory'de ve retry/idempotency açısından sınıflandırılmış.
- [ ] #18 kapsamındaki PostgreSQL-backed concern'ler doğru şekilde işaretlenmiş.
- [ ] PostgreSQL mutation sonrası timeout / connection loss ambiguous outcome olarak ele alınıyor.
- [ ] Unsafe ambiguous HTTP mutation'lar idempotency protection olmadan otomatik retry edilmiyor.
- [ ] Aynı idempotent logical operation business mutation'ı birden fazla kez uygulamıyor.
- [ ] Same key + different request semantics / payload conflict olarak reddediliyor.
- [ ] Concurrent same-key request'ler tek consistent logical outcome'a ulaşıyor.
- [ ] Persisted idempotency state ile business mutation atomik commit / rollback oluyor.
- [ ] Audit ve pg-boss jobs replay sırasında duplicate üretilmiyor.
- [ ] Retention ve cleanup policy dokümante edilmiş ve uygulanmış.
- [ ] Retry / ambiguous failure davranışı observable.
- [ ] Request idempotency'nin exactly-once effect garanti edemediği sınırlar dokümante edilmiş.
- [ ] `docs/idempotency-retry-inventory.md` final implementation ile uyumlu.
- [ ] Regression, concurrency, rollback ve lost-response testleri geçiyor.

---

## Çalışma Sırası

```text
Adım 1   Shared inventory doğrulama
   ↓
Adım 2   Endpoint classification
   ↓
Adım 3   Explicit idempotency contract
   ↓
Adım 4   Persistence modeli
   ↓
──────────── Design tamamlandı ────────────
   ↓
Adım 5   Application abstraction
   ↓
Adım 6   Replay / concurrency
   ↓
Adım 7   Endpoint integration
   ↓
Adım 8   Ambiguous outcome / retry policy
   ↓
Adım 9   Retention / cleanup
   ↓
Adım 10  Tests
   ↓
Adım 11  Inventory / documentation
   ↓
Adım 12  Final acceptance review
```

Implementation'a **Adım 1–4 tamamlanmadan başlanmamalıdır**.
