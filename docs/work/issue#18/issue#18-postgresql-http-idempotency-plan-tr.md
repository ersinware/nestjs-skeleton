# Issue #18 — PostgreSQL-backed HTTP Mutation Idempotency ve Retry Safety Planı

> Durum: Güncellenmiş tasarım önerisi. Repository'ye uygulanmadı.

## Amaç

PostgreSQL-backed mutating HTTP request'lerde timeout, connection loss veya response loss sonrası ambiguous outcome'u güvenli ele almak.

#18 için hedef artık iki parçadır:

1. aynı logical operation'ın business mutation'ı birden fazla kez uygulamasını önlemek;
2. seçilen PostgreSQL mutation'larında ilk request başarıyla commit olduysa, `same key + same fingerprint` retry'ında **original success response semantics**'ini geri vermek.

Full response snapshot tutulmaz. Yalnız response'u yeniden kurmak için gereken minimum stable metadata saklanır.

Bu issue yalnız HTTP → PostgreSQL boundary'sini final hale getirir. Redis/session (#29), Redis → PostgreSQL handoff (#16) ve avatar lifecycle (#30) bağımsız kalır.

---

# Audit / Design Aşaması

## Adım 1 — Shared inventory'yi doğrula

`docs/idempotency-retry-inventory.md` source of truth'tur.

Her mutating production endpoint için:

- PostgreSQL / Redis / external effect;
- natural idempotency;
- current mutation retry-safety;
- `Idempotency-Key` gereksinimi;
- success replay davranışı;
- owning issue

doğrulanır.

#18 yalnız `Tracked by` içinde `#18` bulunan HTTP → PostgreSQL concern'lerini kesinleştirir.

## Adım 2 — #18 endpoint kararlarını kesinleştir

Bir #18 endpoint'i için şu sorular sorulur:

1. Retry ikinci business mutation/audit/job oluşturabilir mi?
2. İlk PostgreSQL mutation commit olup response kaybolursa retry original success outcome'u kaybedebilir mi?
3. Original success semantics full response snapshot olmadan, no/minimum stable metadata ile replay edilebilir mi?

### Karar

`Idempotency-Key` gerekir, eğer:

- duplicate request-level mutation/delivery/operation riski varsa; veya
- mutation commit olduktan sonra retry `404`/`409` gibi farklı bir sonuç verebiliyor ve original success semantics düşük karmaşıklıkla replay edilebiliyorsa.

### Key gerekmeyen gruplar

- Retry zaten aynı success semantics'i doğal olarak veriyorsa: ban, unban, permission replacement.
- Avatar profile update boundary'si #30 tarafından açık tutuluyorsa: `PATCH /user/me`, `PATCH /admin/me`.

### #29 ile birlikte uygulanacak cross-boundary grup

`#18: Yes, #29: Pending` olan endpoint'lerde #18 key/fingerprint kararı şimdi kesinleşir; ancak implementation #29 çalışmasına kadar ertelenir. Sebep, PostgreSQL mutation/proof state'i ile post-commit Redis/session sonucu birlikte ele alınmadan partial replay uygulamamak.

Bu grupta:

- `DELETE /user/me`
- `POST /user/me/email/confirm`
- `PATCH /user/me/password`
- `POST /user/activation/complete`
- `DELETE /admin/:id`
- `POST /admin/me/email/confirm`
- `PATCH /admin/me/password`

bulunur.

### #30 ile ilişkili #18 endpoint'leri

`POST /user/registration/complete` ve `POST /admin/activation/complete` için request path'inde S3 mutation yoktur; yalnız `HEAD` read yapılır.

Bu nedenle `Required Idempotency-Key` kararı yalnız **`#18: Yes`** olarak kesinleşir. #30 bu endpoint'lerde key kararını bloke etmez; avatar proof / cleanup lifecycle riski nedeniyle yalnız `Tracked by` ve limitation tarafında kalır.

### Final #18 `Yes` listesi

**Auth**
- `POST /auth/logout-all`

**User**
- `DELETE /user/me`
- `POST /user/me/email/initiate`
- `POST /user/me/email/confirm`
- `PATCH /user/me/password`
- `POST /user/registration/complete`
- `POST /user/activation/complete`
- `POST /user/activation/resend`

**Admin**
- `DELETE /admin/:id`
- `POST /admin/me/email/initiate`
- `POST /admin/me/email/confirm`
- `PATCH /admin/me/password`
- `POST /admin/invite`
- `POST /admin/activation/complete`
- `POST /admin/:id/re-invite`

**Job Queue Operations**
- `POST /job-operations/dead-letter/redrive`
- `POST /job-operations/dead-letter/discard`

Toplam: **17 endpoint**.

---

## Adım 3 — Explicit idempotency kontratını kesinleştir

Client contract:

```http
Idempotency-Key: <random UUID v4>
```

Kurallar:

- aynı logical operation retry → aynı key;
- yeni logical operation → yeni key;
- key global unique;
- `scope` yok;
- server deterministic endpoint-specific fingerprint üretir;
- same key + same fingerprint → replay;
- same key + different fingerprint → `409 Conflict`;
- fingerprint HMAC-SHA-256 ile üretilir;
- HMAC doğrudan feature kodunda `createHmac` ile üretilmez; mevcut `IHashingPort` / `HashingAdapter` reusable HMAC-SHA-256 capability ile genişletilir;
- adapter proje-geneli tek bir server-held `HASHING_KEY` kullanır;
- reusable HMAC API bir `context` / `purpose` alır; aynı key başka concern'lerde kullanılsa bile hash domain'leri ayrılır;
- idempotency fingerprint için context örneği: `idempotency-fingerprint`;
- raw password/token/payload veya unkeyed secret digest persist edilmez.

Replay:

- business mutation tekrar çalışmaz;
- duplicate audit/job oluşmaz;
- endpoint'in original success semantics'i döner;
- full response snapshot kullanılmaz.

Current authentication/authorization/rate-limit replay'de bypass edilmez.

### Hashing abstraction kararı

Idempotency fingerprint üretimi core hashing concern üzerinden yapılmalıdır.

Planlanan reusable contract:

```text
IHashingPort.hmacSha256(context, value)
```

Adapter davranışı:

```text
HMAC-SHA-256(
  HASHING_KEY,
  JSON.stringify([context, value])
)
```

Kurallar:

- `HASHING_KEY` proje-geneli keyed hashing key'idir; idempotency'ye özel secret eklenmez;
- key runtime config üzerinden okunur ve boot sırasında güçlü bir secret olarak validate edilir;
- idempotency caller'ı `context = "idempotency-fingerprint"` kullanır;
- future HMAC use-case'leri aynı adapter/key'i farklı context ile reuse edebilir;
- idempotency feature kodu `node:crypto.createHmac` çağırmaz;
- persisted fingerprint yalnız HMAC sonucudur; key veya raw semantic input persist edilmez;
- `HASHING_KEY` rotation, retention içindeki persisted fingerprint'lerin doğrulanabilirliğini etkilediği için key rotation policy ayrıca dikkate alınmalıdır.

## Adım 4 — Minimum persistence modelini kesinleştir

Başlangıç modeli:

```text
idempotency.operation
├── key UUID PRIMARY KEY
├── fingerprint TEXT NOT NULL
├── created_at TIMESTAMPTZ NOT NULL
└── replay_operation_id UUID NULL
```

`replay_operation_id` yalnız redrive gibi stable response identity gereken endpoint için kullanılır.

Gereksiz alanlar:

- `scope`;
- generic `status`;
- generic response/result JSON/blob;
- raw payload;
- credentials/tokens;
- row başına gereksiz expiry alanı.

`204` replay endpoint'lerinde committed idempotency row yeterlidir; ayrı response metadata gerekmez.

---

# Implementation Aşaması

## Adım 5 — Idempotency abstraction

Application-level abstraction şu invariant'ları korur:

- fingerprint, injected `IHashingPort` üzerinden reusable `hmacSha256("idempotency-fingerprint", canonicalValue)` çağrısıyla üretilir;
- idempotency implementation doğrudan crypto primitive veya secret yönetmez;
- key + fingerprint operation claim;
- replay callback'i/business mutation'ı tekrar çalıştırmaz;
- idempotency state ile PostgreSQL business mutation aynı transaction'da commit/rollback olur;
- gerekli replay metadata aynı transaction'da persist edilir.

```text
BEGIN
idempotency operation
business mutation
audit
pg-boss jobs
optional replay metadata
COMMIT
```

## Adım 6 — Replay ve concurrency

### İlk request

```text
key=A, fingerprint=X
→ claim
→ business mutation
→ commit
```

### Lost response retry

```text
key=A, fingerprint=X
→ replay
→ business mutation/audit/job tekrar yok
→ original success semantics
```

### Conflict

```text
key=A, fingerprint=Y
→ 409
```

### Concurrency

Same-key concurrent requests tek logical operation'a çözülmelidir. PostgreSQL uniqueness/transaction coordination yeterlidir; distributed lock eklenmez.

## Adım 7 — Seçilen endpoint'lere dependency-aware entegre et

Implementation iki gruptur:

- **#18-only / #30-independent seçili endpoint'ler:** #18 kapsamında uygulanır.
- **`#18: Yes, #29: Pending` endpoint'ler:** tasarım/fingerprint şimdi kesinleşir, implementation #29 çalışmasına ertelenir ve Redis/session result replay ile birlikte tamamlanır.

Uygulanacak her endpoint için:

1. `Idempotency-Key` validation;
2. endpoint-specific fingerprint;
3. atomic idempotency + business transaction;
4. same-key replay;
5. different-fingerprint `409`;
6. minimum replay metadata;
7. OpenAPI update;
8. mevcut auth/audit guarantees korunur.

## Adım 8 — Ambiguous outcome policy

PostgreSQL write attempt sonrası timeout/connection loss/response loss:

```text
outcome unknown → ambiguous outcome
```

Unsafe operation yeni logical operation olarak otomatik retry edilmez.

Explicit idempotency endpoint'inde client aynı key ile retry eder.

## Adım 9 — Retention / cleanup

Idempotency rows `created_at` üzerinden merkezi retention policy ile temizlenir.

Retention window:

- gerçek client retry window;
- recovery ihtiyacı;
- table growth;
- replay guarantee süresi

ile belirlenir.

Retention sonrası same-key replay garantisinin sona erdiği dokümante edilir.

## Adım 10 — Tests

En az:

- same key + same fingerprint → replay;
- same key + different fingerprint → `409`;
- concurrent same-key → tek mutation;
- rollback → idempotency row da rollback;
- lost response → second mutation yok;
- selected `204` endpoints → retry yine `204`;
- redrive → retry aynı `operationId`;
- duplicate audit/job yok;
- raw credential/token/payload persist edilmiyor;
- HMAC fingerprint `IHashingPort` üzerinden üretiliyor;
- aynı value + aynı context aynı HMAC'ı, farklı context farklı HMAC'ı üretiyor;
- idempotency kodu ayrı bir idempotency secret veya doğrudan `createHmac` kullanmıyor.

## Adım 11 — Kalıcı dokümantasyon

Implementation sonrası inventory ve architecture/HTTP/data-state dokümantasyonu şu konularla hizalanır:

- ambiguous outcome;
- request-level idempotency;
- same-key success replay;
- fingerprint/conflict;
- concurrency;
- retention;
- minimum replay metadata;
- core hashing adapter üzerinden reusable HMAC-SHA-256 kullanımı;
- proje-geneli `HASHING_KEY` config/validation contract'ı;
- exactly-once sınırları.

## Adım 12 — Final acceptance review

Issue kapanmadan önce:

- inventory implementation ile uyumlu;
- 17 seçili endpoint'in key contract kararı dokümante edilmiş;
- #18-only seçili endpoint'lerde implementation tamamlanmış;
- `#18: Yes, #29: Pending` endpoint'ler #29 ile birlikte tamamlanmış;
- same-key retry original success semantics'i veriyor;
- full response snapshot yok;
- yalnız gerekli minimum metadata persist ediliyor;
- mutation/audit/job replay'de tekrarlanmıyor;
- `#18: Yes, #29: Pending` endpoint'ler #29 final contract'ı olmadan partial olarak uygulanmıyor;
- #29/#30 boundary'leri korunuyor ve cross-boundary implementation dependency açık;
- regression/concurrency/rollback/lost-response testleri geçiyor.

---

## Çalışma Sırası

```text
Adım 1   Inventory
Adım 2   Endpoint decisions
Adım 3   Explicit contract
Adım 4   Persistence model
         ── design complete ──
Adım 5   Abstraction
Adım 6   Replay/concurrency
Adım 7   Endpoint integration
Adım 8   Ambiguous outcome
Adım 9   Retention
Adım 10  Tests
Adım 11  Documentation
Adım 12  Final review
```