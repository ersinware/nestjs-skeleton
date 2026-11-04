# Issue #18 — Adım 4: Minimum Persistence Modeli

> Durum: Tasarım çıktısı. Repository'ye uygulanmadı.

## Karar

Idempotency state ayrı bir core-owned PostgreSQL schema/table'da tutulur:

```text
idempotency.operation
├── key UUID PRIMARY KEY
├── fingerprint TEXT NOT NULL
├── created_at TIMESTAMP NOT NULL DEFAULT now()
└── replay_result_id UUID NULL
```

Ek index:

```text
INDEX idempotency_operation_created_at_idx (created_at)
```

## Alanlar

### `key`

Client'ın gönderdiği `Idempotency-Key` UUID v4 değeridir.

- global operation identity'dir;
- `scope` olmadığı için doğrudan primary key'dir;
- ayrı surrogate `id` eklenmez;
- repo'daki application-generated UUID v7 row-id kuralına bilinçli istisnadır: bu değer application row ID değil, external request identity'dir.

### `fingerprint`

Step 3'te tanımlanan canonical request semantics'in HMAC-SHA-256 sonucudur.

- yalnız digest persist edilir;
- raw payload, password, token veya semantic input persist edilmez;
- same key + different fingerprint conflict tespiti için kullanılır.

### `created_at`

Operation'ın commit edilen idempotency kaydının oluşturulma zamanıdır.

Repo timestamp convention'ına uyumlu olarak `TIMESTAMP WITHOUT TIME ZONE` / Drizzle `timestamp(...).defaultNow()` kullanılır; PostgreSQL session'ları UTC'dir.

Retention cleanup `created_at` üzerinden yapılacağı için indexlenir.

### `replay_result_id`

Yalnız replay sırasında original success response'u yeniden kurmak için stable bir UUID result identity gereken endpoint'lerde kullanılır.

Şu an:

```text
POST /job-operations/dead-letter/redrive
→ original operationId
```

İleride mutation sonucu bir resource / operation / request ID döndüren başka endpoint'ler de aynı alanı kullanabilir.

Diğer mevcut #18 endpoint'lerinde `NULL` kalır.

Foreign key eklenmez; redrive operation pg-boss-owned state'e bağlıdır ve cross-schema FK kurulmaz.

## Row lifecycle

Row **insert-only / immutable** kabul edilir.

- `updated_at` yok;
- generic `status` yok;
- request başarılı transaction ile commit olursa row da commit olur;
- business mutation rollback olursa row da rollback olur;
- committed row same-key replay için source of truth olur.

Primary-key uniqueness concurrent same-key request'lerin tek logical operation'a çözülmesinin persistence temelidir.

## Bilerek eklenmeyen alanlar

```text
scope
endpoint / method / route
principal / target
status
updated_at
expires_at
response_status
response_body / result JSON
raw payload
credentials / tokens
```

Endpoint, principal, target ve payload semantics zaten `fingerprint` içindedir.

Row başına `expires_at` yerine merkezi retention policy `created_at` üzerinden çalışır.

## `204` replay

Fixed `204 No Content` endpoint'lerinde:

```text
key + fingerprint + created_at
```

yeterlidir. Ek replay metadata tutulmaz.

## #29 boundary

`#18: Yes, #29: Pending` endpoint'lerin session/token replay ihtiyacı bu tabloya generic JSON veya token alanları eklenerek çözülmez.

#29 çalışmasında gereken cross-boundary persistence ayrı olarak kesinleştirilir.

## Schema ownership

Bu concern cross-cutting olduğu için `idempotency` schema'sı core tarafından sahiplenilir.

Implementation aşamasında Drizzle discovery / `schemaFilter` içine `idempotency` schema'sı eklenmelidir. Migration schema definition'dan `npm run db:generate` ile üretilir; generated migration elle yazılmaz.

## Adım 4 sonucu

Minimum model kesinleşti:

```text
PRIMARY KEY: key
conflict evidence: fingerprint
retention clock: created_at
optional replay result identity: replay_result_id
```

Bunun dışında persistence alanı eklenmez; yeni bir replay ihtiyacı doğarsa önce somut endpoint gereksinimiyle gerekçelendirilir.
