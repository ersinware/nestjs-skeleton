# Issue #18 — Adım 3: Explicit Idempotency Contract

> Durum: Güncellenmiş tasarım çıktısı. Repository'ye uygulanmadı.

## Amaç

Seçilen PostgreSQL-backed mutation'larda:

- duplicate business mutation'ı önlemek;
- ilk request başarıyla commit olduysa `same key + same fingerprint` retry'ında original success response semantics'i döndürmek;
- full response snapshot kullanmamak;
- yalnız gerekli minimum replay metadata'yı saklamak.

## Client contract

```http
Idempotency-Key: <UUID v4>
```

Kurallar:

- aynı logical operation retry → aynı key;
- yeni logical operation → yeni random UUID v4;
- key global unique;
- `scope` yok;
- eksik/geçersiz key → `400`;
- same key + different fingerprint → `409`.

Replay current rate-limit, authentication ve authorization kurallarını bypass etmez.

---

## Fingerprint

Fingerprint doğrudan feature kodunda hash'lenmez. Mevcut core hashing concern reusable HMAC-SHA-256 capability ile genişletilir:

```text
fingerprint =
  hashingPort.hmacSha256(
    "idempotency-fingerprint",
    JSON.stringify(canonicalSemanticVector)
  )
```

`HashingAdapter` bunu şu şekilde üretir:

```text
HMAC-SHA-256(
  HASHING_KEY,
  JSON.stringify([
    "idempotency-fingerprint",
    JSON.stringify(canonicalSemanticVector)
  ])
)
```

### Reusable HMAC hashing

`IHashingPort` / `HashingAdapter` idempotency'ye özel olmamalıdır.

Planlanan reusable API:

```text
hmacSha256(context: string, value: string): string
```

Kurallar:

- tek proje-geneli server-held key kullanılır: `HASHING_KEY`;
- idempotency için ayrı `IDEMPOTENCY_*_SECRET` oluşturulmaz;
- farklı use-case'ler aynı key'i farklı `context` ile güvenli şekilde reuse eder;
- idempotency context'i `idempotency-fingerprint` olur;
- feature/domain kodu doğrudan `node:crypto.createHmac` kullanmaz;
- `HASHING_KEY` boot sırasında validate edilir; en az 32 byte yüksek entropili secret olmalıdır;
- key veya raw semantic input persist edilmez;
- key rotation retention içindeki persisted fingerprint'leri etkileyebileceği için rotation policy retention ile birlikte ele alınır.

Canonical vector:

```text
[
  "<METHOD>",
  "<versioned-route-template>",
  ...semantic fields
]
```

Örnek endpoint identity:

```text
[
  "DELETE",
  "/api/v1/user/me",
  ...
]
```

Kurallar:

- DTO validation/transform sonrası değerler kullanılır;
- fingerprint production yalnız core `IHashingPort` üzerinden yapılır; idempotency concern secret/crypto primitive sahiplenmez;
- HTTP method + versioned route template endpoint identity'yi belirler;
- route zaten version içerdiği için ayrıca `api-v1` gibi bir alan eklenmez;
- dedicated idempotency fingerprint sistemi olduğu için `http-idempotency` gibi sabit bir namespace alanı eklenmez;
- fixed field order kullanılır;
- `Idempotency-Key` fingerprint'e girmez;
- permission listesi, trace/rate-limit metadata ve server-generated IDs fingerprint'e girmez;
- password/token gibi secret değerler gerekirse HMAC input'una girer fakat plaintext/unkeyed hash olarak persist edilmez;
- email için mevcut trim davranışı korunur; ekstra lowercase uygulanmaz;
- UUID'ler canonical lowercase kullanılır;
- set semantics olan `jobIds` sort edilerek canonicalize edilir.

---

## Same-key davranışı

### Same key + same fingerprint

```text
→ replay
→ business mutation yok
→ duplicate audit/job yok
→ original success semantics
```

### Same key + different fingerprint

```text
→ 409 Conflict
```

Önerilen mesaj:

```text
The idempotency key is already associated with a different request.
```

İlk transaction commit olmadıysa successful idempotent operation oluşmuş sayılmaz; aynı key tekrar denenebilir.

---

# Modül bazında kararlar

Aşağıdaki `Fingerprint semantics` blokları yalnız endpoint-specific semantic alanları gösterir. Final canonical vector her zaman şu şekilde kurulur:

```text
[
  "<METHOD>",
  "<versioned-route-template>",
  ...fingerprint semantics
]
```


## Auth

### `POST /auth/logout-all` — YES

Fingerprint semantics:

```text
principal.type
principal.id
```

Replay:

```text
204 No Content
```

Metadata: yok.

---

## User

### `DELETE /user/me` — YES

Neden: İlk delete `204` commit etmiş olabilir; response kaybolursa normal retry `404` verebilir.

Fingerprint semantics:

```text
principal.id
```

Replay:

```text
204 No Content
```

Metadata: yok.

### `PATCH /user/me` — NO (#30 Pending)

Name-only retry zaten `200` success semantics'i koruyor. Avatar lifecycle #30 altında açık. #18 yalnız response replay için bu endpoint'e key eklemiyor.

### `POST /user/me/email/initiate` — YES

Fingerprint semantics:

```text
principal.id
dto.newEmail
dto.currentPassword
```

Replay:

```text
204 No Content
```

Metadata: yok.

### `POST /user/me/email/confirm` — YES (#29 Pending)

#18 same-key operation'ı committed PostgreSQL email-change/proof consumption'dan önce tanır; proof/business mutation tekrar çalışmaz. Original `200` session/token sonucu #29'a bağlıdır.

Fingerprint semantics:

```text
principal.id
dto.token
```

Implementation: **#29 çalışmasına ertelenir.**

### `PATCH /user/me/password` — YES (#29 Pending)

İlk password mutation commit olduktan sonra current password/session state değiştiği için normal retry original `200` sonucunu kaybedebilir. #18 committed PostgreSQL operation'ı tanır; session/token replay #29'a aittir.

Fingerprint semantics:

```text
principal.id
dto.currentPassword
dto.newPassword
```

Implementation: **#29 çalışmasına ertelenir.**

### `POST /user/registration/complete` — YES

Neden: İlk account creation `204` commit etmiş olabilir; retry uniqueness nedeniyle `409` verebilir.

Fingerprint semantics:

```text
dto.email
dto.name
dto.password
dto.avatar.sizeBytes
dto.avatar.contentType
dto.uploadToken
```

Replay:

```text
204 No Content
```

Metadata: yok.

Request path'inde S3 mutation yoktur; yalnız `HEAD` read vardır. #30 avatar lifecycle ayrı takip edilir ve `Idempotency-Key` kararını bloke etmez.

### `POST /user/activation/complete` — YES (#29 Pending)

İlk activation commit olduktan sonra proof/account state değişir; normal retry `409` verebilir. #18 activation/proof consumption identity'sini korur; original `200` session/token veya `login_required` sonucu #29'a aittir.

Fingerprint semantics:

```text
dto.token
dto.password
```

Implementation: **#29 çalışmasına ertelenir.**

### `POST /user/activation/resend` — YES

Fingerprint semantics:

```text
dto.email
```

Replay:

```text
204 No Content
```

Metadata: yok.

Anti-enumeration davranışı korunur.

### `POST /user/:id/ban` — NO

Retry zaten no-op + `204`.

### `POST /user/:id/unban` — NO

Retry zaten no-op + `204`.

### `PUT /user/:id/permissions` — NO

Aynı permission set yeniden uygulanınca no-op + `204`.

---

## Admin

### `DELETE /admin/:id` — YES

Neden: İlk delete `204` commit etmiş olabilir; normal retry `404` verebilir.

Fingerprint semantics:

```text
principal.id
params.id
```

Replay:

```text
204 No Content
```

Metadata: yok.

### `PATCH /admin/me` — NO (#30 Pending)

Name-only retry zaten `200` verir; avatar lifecycle #30 altında açık.

### `POST /admin/me/email/initiate` — YES

Fingerprint semantics:

```text
principal.id
dto.newEmail
dto.currentPassword
```

Replay:

```text
204 No Content
```

Metadata: yok.

### `POST /admin/me/email/confirm` — YES (#29 Pending)

#18 same-key operation'ı committed PostgreSQL email-change/proof consumption'dan önce tanır; proof/business mutation tekrar çalışmaz. Original `200` session/token sonucu #29'a bağlıdır.

Fingerprint semantics:

```text
principal.id
dto.token
```

Implementation: **#29 çalışmasına ertelenir.**

### `PATCH /admin/me/password` — YES (#29 Pending)

İlk password mutation commit olduktan sonra current password/session state değişir. #18 committed PostgreSQL operation'ı tanır; original `200` session/token replay #29'a aittir.

Fingerprint semantics:

```text
principal.id
dto.currentPassword
dto.newPassword
```

Implementation: **#29 çalışmasına ertelenir.**

### `POST /admin/invite` — YES

Neden: İlk invite `204` commit etmiş olabilir; normal retry email uniqueness nedeniyle `409` verebilir.

Fingerprint semantics:

```text
principal.id
dto.email
dto.name
```

Replay:

```text
204 No Content
```

Metadata: yok.

Actor business command'a taşınmasa bile idempotency boundary verified principal'ı request context'ten kullanır.

### `POST /admin/activation/complete` — YES

Neden: İlk activation `204` commit etmiş olabilir; retry already-active nedeniyle `409` verebilir.

Fingerprint semantics:

```text
dto.token
dto.password
dto.avatar.sizeBytes
dto.avatar.contentType
dto.uploadToken
```

Replay:

```text
204 No Content
```

Metadata: yok.

Request path'inde S3 mutation yoktur; yalnız `HEAD` read vardır. #30 avatar lifecycle ayrı takip edilir ve `Idempotency-Key` kararını bloke etmez.

### `POST /admin/:id/re-invite` — YES

Fingerprint semantics:

```text
principal.id
params.id
```

Replay:

```text
204 No Content
```

Metadata: yok.

### `POST /admin/:id/ban` — NO

Retry zaten no-op + `204`.

### `POST /admin/:id/unban` — NO

Retry zaten no-op + `204`.

### `PUT /admin/:id/permissions` — NO

Aynı permission set retry'ı zaten no-op + `204`.

---

## Job Queue Operations

### `POST /job-operations/dead-letter/redrive` — YES

Fingerprint semantics:

```text
principal.type
principal.id
```

İlk success:

```text
202 Accepted
{
  "operationId": "<id>"
}
```

Replay aynı `operationId` değerini döndürür.

Minimum replay metadata:

```text
operationId
```

Full response snapshot yok.

### `POST /job-operations/dead-letter/discard` — YES

Neden: İlk discard `204` commit etmiş olabilir; retry job'lar artık olmadığı için `404` verebilir.

Fingerprint semantics:

```text
principal.type
principal.id
sort(lowercase(dto.jobIds))
```

`jobIds` business semantics açısından set olduğu için sıra fingerprint'i değiştirmez.

Replay:

```text
204 No Content
```

Metadata: yok.

---

# Final `#18: Yes` listesi

Toplam **17 endpoint**:

1. `POST /auth/logout-all`
2. `DELETE /user/me`
3. `POST /user/me/email/initiate`
4. `POST /user/me/email/confirm`
5. `PATCH /user/me/password`
6. `POST /user/registration/complete`
7. `POST /user/activation/complete`
8. `POST /user/activation/resend`
9. `DELETE /admin/:id`
10. `POST /admin/me/email/initiate`
11. `POST /admin/me/email/confirm`
12. `PATCH /admin/me/password`
13. `POST /admin/invite`
14. `POST /admin/activation/complete`
15. `POST /admin/:id/re-invite`
16. `POST /job-operations/dead-letter/redrive`
17. `POST /job-operations/dead-letter/discard`

## Replay storage

### `204` endpoints

Ek response metadata gerekmez:

```text
key
fingerprint
created_at
```

Committed operation row + endpoint contract replay için yeterlidir.

### Redrive

Ek olarak:

```text
operationId
```

saklanır.

Generic response JSON/blob tutulmaz.

### `#18: Yes, #29: Pending` endpoint'ler

Bu endpoint'ler için #18 fingerprint/operation identity tasarımı kesinleşmiştir; ancak replay metadata/session-token stratejisi burada ayrıca eklenmez. Implementation #29 çalışmasına ertelenir ve iki boundary birlikte çözülür.

---

## Acceptance criterion

```text
[ ] Reusing an idempotency identity with different request semantics or payload is rejected.
```

Adım 3 tasarım olarak tamamlanır; criterion implementation ve tests geçmeden `[x]` yapılmaz.

Minimum tests:

- same key + same semantics → replay;
- same key + farklı endpoint/principal/target/payload → `409`;
- lost response sonrası selected endpoint original success semantics'i döndürür;
- duplicate mutation/audit/job yok;
- redrive original `operationId` döndürür;
- raw password/token/payload persist edilmez;
- fingerprint `IHashingPort` / `HashingAdapter` üzerinden HMAC-SHA-256 ile üretilir;
- aynı input farklı HMAC context'lerinde aynı digest'i üretmez;
- idempotency için ayrı secret veya doğrudan `createHmac` kullanımı yoktur.