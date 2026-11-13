# Issue #29 — Faz 1 İncelemesi

> **Durum:** Faz 1 kararları onaylı Faz 2 tasarımına uyarlanmıştır. Beş PostgreSQL mutation sonrasında session/token üretimi kaldırılmış, envanter güncellenmiştir. Faz 3 testleri henüz yapılmadı.

> **Sonraki karar:** Login replay parola doğrulamasını ve başarı audit’ini atlar; `LOGIN_SUCCESS` yalnız `OPENED` için yazılır. Güncel davranış: [envanter](../idempotency-retry-inventory.md#implemented-request-coordination).

## Faz 1 karar özeti

| Akış                         | `Idempotency-Key` | Redis request protection | Karar                                                                                                                      |
| ---------------------------- | ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| User/Admin login             | **Evet**          | `openSession()`          | Aynı logical retry ikinci live session oluşturmamalı. Same-key success retained session'a replay edilmeli.                 |
| Refresh                      | **Evet**          | `rotateSession()`        | Same-key retry ikinci rotation veya reuse remediation üretmemeli. Farklı/new key mevcut replay/reuse semantics'i korumalı. |
| Logout                       | **Hayır**         | Yok                      | `HDEL` doğal olarak repeat-safe; tekrar `204` dönebilir.                                                                   |
| User/Admin email confirm     | **Evet**          | Yok                      | PostgreSQL success replay; ilk başarı ve replay yalnız `204 No Content`, session/token üretimi yok.                        |
| User/Admin password change   | **Evet**          | Yok                      | PostgreSQL success replay; ilk başarı ve replay yalnız `204 No Content`, session/token üretimi yok.                        |
| User activation complete     | **Evet**          | Yok                      | PostgreSQL success replay; ilk başarı ve replay yalnız `204 No Content`, session/token üretimi yok.                        |
| User/Admin delete            | Mevcut **Evet**   | Ek koruma yok            | PostgreSQL replay zaten `204` koruyor. Redis `setVersion()` monotonik ve durable reconciliation mevcut.                    |
| User/Admin ban / permissions | **Hayır**         | Ek koruma yok            | `setVersion()` mevcut Lua ile monotonik; tekrar aynı veya daha düşük version state'i geri alamaz.                          |

## Redis koordinasyon kararları

> **Onaylı Faz 2 revizyonu:** Hazır registration alan port imzaları yerine session authority kimlik/süreleri oluşturur; replay, liveness ve mutation tek Lua çağrısında çözülür. Session'lar principal başına `auth:{<principalType>:<id>}:sessions` hash'inde, SID alanı ve bağımsız refresh-expiry TTL'iyle tutulur. Bu iki değişiklik kullanıcı tarafından implementasyon incelemesinde onaylandı; ayrıntılar [Faz 2 sözleşmesinde](issue%2329-redis-idempotency-plan-tr-v5.md#redis-port-contract).

- Explicit protection gereken method'larda `IdempotencyRequest` **ilk parametre** olacak:
    - `openSession(idempotencyRequest, ...)`
    - `rotateSession(idempotencyRequest, ...)`
- `closeSession()` ve `setVersion()` imzaları değişmeyecek.
- Lua çağrısında `KEYS[1]` request-idempotency key olacak ve replay/conflict kontrolü protected mutation'dan önce yapılacak.
- Önerilen Redis key:
    - `auth:{<principalType>:<id>}:idempotency:<Idempotency-Key>`
    - Böylece session/version key'leriyle aynı Redis Cluster hash slot'unda kalır.
- HMAC context’leri storage sınırına göre ayrıdır: PostgreSQL `postgres:idempotency-fingerprint`, Redis `redis:idempotency-fingerprint`; ikisi de mevcut hashing portunu kullanır.
- Redis kaydı yalnızca minimum non-secret replay metadata tutmalı: **fingerprint + original session `sid` + refresh `jti`**. Token veya HTTP response saklanmamalı.
- Redis idempotency kaydı **2 dakika (120 saniye)** tutulmalı. Bu bounded süre yalnızca ambiguous outcome ve normal client retry penceresini kapsar; session veya refresh-token ömrüne bağlı değildir. Süre dolduğunda same-key replay garantisi sona erer ve request normal domain semantics ile değerlendirilir.
- Lua ilk mutation’da `OPENED` / `ROTATED`, retained canlı başarıda `REPLAYED` + aynı registration döndürür. Bu ayrım callback hazırlığı veya audit koordinasyonunu değiştirmez.
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
- `findSessionRequestReplay()` login/refresh essential kontrollerinden sonra, credential hazırlığından önce yalnız bir kez salt-okunur Lua ile `NOT_FOUND | REPLAYED | CONFLICT | REPLAY_UNAVAILABLE | SESSION_UNAVAILABLE | VERSION_SUPERSEDED` döndürür. Hazırlık hatası/refusal dallarında tekrar sorgulanmaz. Mutation çağrısı atomik replay kontrolünü korur; ön okuma henüz commit etmemiş isteği beklemez ve tüm eşzamanlı isteklere aynı response garantisi vermez.
- Login retained success’te parola doğrulamasını tekrar etmez. Refresh eski token’ın credential expiry’sini yalnız retained live success için aşabilir; imza/type/claim ve mutlak session ömrü doğrulanır, kayıt yoksa expired token rotation yapamaz. Refresh replay’de primary account/revocation kontrolü winning session version’ıyla uygulanır. Login replay ilk account lookup’taki permissions’ı kullanır; ek primary revocation sorgusu yapmaz, Redis version kontrolü ve mevcut propagation modeli korunur.
- `generateTokens(accessClaims, refreshClaims)` yalnızca verilen claim'leri imzalar ve token pair döner. SID/JTI, issuance expiry ve liveness kararlarını session authority belirler; ilk issuance ve replay aynı token operation'ını kullanır.
- JWT string'inin birebir aynı olması invariant değildir; invariant aynı session identity, aynı refresh credential identity ve aynı expiry sınırlarının korunmasıdır.
- Retained session artık closed, revoked veya superseded ise replay session'ı yeniden yaratmaz.
- Yeni `openSession()` isteğinde version Redis floor’unun altındaysa `VERSION_SUPERSEDED` döner; session oluşturulmaz; login audit yazmadan genel credentials hatası döndürür. `REPLAY_UNAVAILABLE` retained replay session’ı artık kullanılamadığında döner. Replay/rotation eksik version floor için `SESSION_UNAVAILABLE`, floor altında kalan version için `VERSION_SUPERSEDED` döndürür.
- Same key + farklı fingerprint → `409`.
- Başarısız mutation attempt retained success olarak yazılmaz.
- Redis timeout / connection loss sonrası server mutation'ı otomatik retry etmez; client aynı key ile tekrar gelir.

## PostgreSQL mutation ve yeniden giriş

User/admin email confirmation, user/admin password change ve user activation completion session açmaz veya token pair döndürmez. İlk başarı ve same-key replay `204 No Content` döner.

- `executePrepared()` proof/password/current-state hazırlığından önce retained success’i okur; replay account reload, mutation, audit veya jobs yapmaz.
- Refusal/failure audit bağımsız durable kalır; başarısız attempt success kaydı oluşturmaz.
- Business mutation, success audit, jobs ve idempotency success aynı PostgreSQL transaction’ında commit edilir.
- Gövdesiz başarı için `replayResultId: null` yeterlidir. PostgreSQL→Redis session issuance koordinasyonu veya committed-version metadata/migration gerekmez.
- Password/email revocation counter ve reconciliation job’ları korunur; activation session counter artırmaz.
- Client credential’ları temizleyip login olur. Guard’lar replay’de de uygulanır; eski credential revocation sonrası reddedilebilir.

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
