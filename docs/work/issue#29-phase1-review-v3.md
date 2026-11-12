# Issue #29 — Faz 1 İncelemesi

> **Durum:** Yalnızca Faz 1 analizi tamamlandı. Repository içindeki `docs/idempotency-retry-inventory.md` **değiştirilmedi**.

## Faz 1 karar özeti

| Akış                         | `Idempotency-Key` | Redis request protection | Karar                                                                                                                      |
| ---------------------------- | ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| User/Admin login             | **Evet**          | `openSession()`          | Aynı logical retry ikinci live session oluşturmamalı. Same-key success retained session'a replay edilmeli.                 |
| Refresh                      | **Evet**          | `rotateSession()`        | Same-key retry ikinci rotation veya reuse remediation üretmemeli. Farklı/new key mevcut replay/reuse semantics'i korumalı. |
| Logout                       | **Hayır**         | Yok                      | `DEL` doğal olarak repeat-safe; tekrar `204` dönebilir.                                                                    |
| User/Admin email confirm     | **Evet**          | `openSession()`          | PostgreSQL success replay ile aynı key kullanılmalı; replacement session ikinci kez açılmamalı.                            |
| User/Admin password change   | **Evet**          | `openSession()`          | PostgreSQL success replay ile aynı key kullanılmalı; replacement session ikinci kez açılmamalı.                            |
| User activation complete     | **Evet**          | `openSession()`          | Committed activation replay edilmeli; replacement session ikinci kez açılmamalı.                                           |
| User/Admin delete            | Mevcut **Evet**   | Ek koruma yok            | PostgreSQL replay zaten `204` koruyor. Redis `setVersion()` monotonik ve durable reconciliation mevcut.                    |
| User/Admin ban / permissions | **Hayır**         | Ek koruma yok            | `setVersion()` mevcut Lua ile monotonik; tekrar aynı veya daha düşük version state'i geri alamaz.                          |

## Redis koordinasyon kararları

- Explicit protection gereken method'larda `IdempotencyRequest` **ilk parametre** olacak:
    - `openSession(idempotencyRequest, ...)`
    - `rotateSession(idempotencyRequest, ...)`
- `closeSession()` ve `setVersion()` imzaları değişmeyecek.
- Lua çağrısında `KEYS[1]` request-idempotency key olacak ve replay/conflict kontrolü protected mutation'dan önce yapılacak.
- Önerilen Redis key:
    - `auth:{<principalType>:<id>}:idempotency:<Idempotency-Key>`
    - Böylece session/version key'leriyle aynı Redis Cluster hash slot'unda kalır.
- Fingerprint mevcut PostgreSQL standardıyla aynı HMAC context'i kullanmalı: `idempotency-fingerprint`.
- Redis kaydı yalnızca minimum non-secret replay metadata tutmalı: **fingerprint + original session `sid` / success marker**. Token veya HTTP response saklanmamalı.
- Redis idempotency kaydı **5 dakika (300 saniye)** tutulmalı. Bu bounded süre yalnızca ambiguous outcome ve normal client retry penceresini kapsar; session veya refresh-token ömrüne bağlı değildir. Süre dolduğunda same-key replay garantisi sona erer ve request normal domain semantics ile değerlendirilir.
- Same-key + same-fingerprint retained success:
    - protected mutation tekrar çalışmaz;
    - current authentication / authorization / rate limit kontrolleri yine çalışır;
    - session gerçekten kapanmış veya supersede edilmişse replay session'ı yeniden yaratmaz.
- Token payload'ının birebir aynı olması zorunlu değil. Retained live session metadata üzerinden **yeni protected Redis mutation yapmadan** geçerli credential yeniden imzalanabilir.
- Token dönen same-key replay'lerde:
    - yeni `sid` üretilmez;
    - yeni refresh-token `jti` üretilmez;
    - `sessionExpiresAt` değiştirilmez;
    - `refreshExpiresAt` değiştirilmez;
    - `sessionVersion` değiştirilmez;
    - Redis session tekrar açılmaz;
    - refresh rotation tekrar çalıştırılmaz;
    - mevcut retained/live session metadata üzerinden token pair yeniden imzalanır.
- Bu replay path'inde `generateTokens()` kullanılmamalıdır; çünkü yeni `sid` ve yeni refresh `jti` üretir. Mevcut session registration üzerinden credential imzalayan ayrı bir token-port operation kullanılmalıdır.
- JWT string'inin birebir aynı olması invariant değildir; invariant aynı session identity, aynı refresh credential identity ve aynı expiry sınırlarının korunmasıdır.
- Retained session artık closed, revoked veya superseded ise replay session'ı yeniden yaratmaz.
- Same key + farklı fingerprint → `409`.
- Başarısız mutation attempt retained success olarak yazılmaz.
- Redis timeout / connection loss sonrası server mutation'ı otomatik retry etmez; client aynı key ile tekrar gelir.

## PostgreSQL + Redis replacement-session akışı

`email/confirm`, password change ve user activation gibi PostgreSQL mutation + replacement session akışlarında **aynı HTTP `Idempotency-Key`** iki sınırda da aynı logical request'i temsil eder.

- PostgreSQL tarafında retained success, proof/password/current state tekrar değerlendirilmeden önce kontrol edilir.
- Refusal/failure audit kayıtları mevcut davranıştaki gibi bağımsız PostgreSQL commit olarak kalır; başarısız attempt idempotency success oluşturmaz.
- Business mutation, success audit, durable jobs ve PostgreSQL idempotency success aynı transaction içinde commit edilir.
- Replay için minimum stable session identity (`sid`) PostgreSQL idempotency metadata'sında tutulabilir; token/credential tutulmaz.
- PostgreSQL commit sonrasında Redis `openSession(idempotencyRequest, ...)` aynı logical key ile çalışır.
- PostgreSQL başarılı, Redis başarısız/ambiguous ise retry PostgreSQL mutation'ı tekrarlamaz; eksik Redis session mutation'ını tamamlar.
- Redis de başarılıysa same-key retry yeni session açmaz; retained session metadata üzerinden credential yeniden imzalanır.

## Önerilen fingerprint'ler

| Endpoint                         | Canonical semantic vector                                                     |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `POST /auth/user/login`          | method, route template, normalized email, password                            |
| `POST /auth/admin/login`         | method, route template, normalized email, password                            |
| `POST /auth/refresh`             | method, route template, refresh token                                         |
| `POST /user/me/email/confirm`    | method, route template, verified principal ID, confirmation token             |
| `PATCH /user/me/password`        | method, route template, verified principal ID, current password, new password |
| `POST /user/activation/complete` | method, route template, activation token, password                            |
| `POST /admin/me/email/confirm`   | method, route template, verified principal ID, confirmation token             |
| `PATCH /admin/me/password`       | method, route template, verified principal ID, current password, new password |

Raw semantic values yalnızca request lifetime boyunca bellekte bulunur; persisted fingerprint HMAC'tir.

---
