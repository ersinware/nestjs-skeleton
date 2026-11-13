# Issue #29 — Redis HTTP Mutation Idempotency Planı

## Hedef

`#29` kapsamında izlenen tüm production HTTP entry point'lerini gözden geçirmek, `docs/idempotency-retry-inventory.md` üzerinden retry-safety kararlarını netleştirmek ve yalnızca aynı logical request'in tekrarının istenmeyen Redis side-effect üretebildiği yerlerde explicit request-level protection eklemek.

Bu issue **HTTP request → Redis mutation** sınırını ve session üretimi kaldırılan beş PostgreSQL endpoint’inin request-idempotency koordinasyonunu kapsar. Redis → PostgreSQL / pg-boss follow-up tutarlılığı `#16` kapsamında kalır.

## Tasarım kuralları

- Same-key + same-fingerprint retry, daha önce başarıyla tamamlanmış logical operation'ın **success semantics**'ini korumalıdır. Güncel state yeniden değerlendirilerek request sonradan `404`, `409`, `401` veya başka bir failure sonucuna düşürülmemelidir.
- Response payload'ın byte-for-byte aynı olması zorunlu değildir. Ancak farklı/yeniden üretilmiş payload yalnızca bunun yeni bir protected Redis side-effect yaratmadığı durumlarda kabul edilir.
- Naturally idempotent veya mevcut domain/state semantics ile zaten retry-safe olan operation'lara gereksiz yere `Idempotency-Key` eklenmez.
- Explicit protection gereken Redis mutation method'larında `IdempotencyRequest` **ilk parametre** olur.
- Lua script içinde Redis idempotency key `KEYS[1]` olur ve protected mutation'dan önce ilk kontrol edilen state bu olur.
- Atomic deduplication gereken yerlerde idempotency kararı ile protected Redis mutation **aynı Lua execution** içinde yapılır.
- Mevcut domain semantics korunur; özellikle refresh-token replay/reuse davranışı generic HTTP idempotency modeliyle değiştirilmez.
- Generic bir `redisIdempotency.execute(callback)` abstraction eklenmez; ayrı çalışan callback mutation'ı atomik hale getiremez.
- Replay için full HTTP response, password, access token, refresh token veya başka credential saklanmaz.
- Aynı Lua script'in dokunduğu Redis key'leri mevcut `auth:{principalType:id}:...` yapısıyla hash-slot uyumlu kalır.
- Redis request-idempotency success kayıtları **2 dakika (120 saniye)** TTL ile tutulur; bu süre session/refresh-token ömründen bağımsız bounded retry penceresidir.
- Redis mutation attempt sonrasında timeout veya connection loss yaşanması **ambiguous outcome** olarak değerlendirilir; mutation'ın gerçekleşmediği varsayılmaz.

## Faz 1 — Envanter incelemesi ve kararlar

`docs/idempotency-retry-inventory.md` source of truth olarak kullanılacak.

`#29` ile takip edilen her entry için:

1. HTTP endpoint → command/handler → Redis port/adapter akışı izlenecek.
2. Redis etkisi şu kategorilerden biriyle sınıflandırılacak:
    - naturally idempotent;
    - domain/state semantics nedeniyle zaten retry-safe;
    - explicit request-level protection gerekli.
3. İlk başarılı request sonrasında same-key + same-fingerprint retry'ın güncel state nedeniyle farklı bir failure sonucuna düşüp düşmeyeceği değerlendirilecek. Böyle bir risk varsa retained success/replay davranışı tanımlanacak.
4. Response payload yeniden üretilebiliyorsa, bunun yeni bir protected Redis side-effect yaratmadan yapılıp yapılamadığı değerlendirilecek. Token gibi ephemeral sonuçlarda payload farklı olabilir; success semantics değişemez.
5. `Idempotency-Key` gerekip gerekmediğine karar verilecek.
6. Protection gereken operation'lar için şu noktalar netleştirilecek:
    - canonical request fingerprint alanları;
    - Redis idempotency key namespace ve TTL;
    - success / replay / conflict outcome'ları;
    - atomic kararı hangi mevcut Lua script'in yöneteceği.
7. Implementasyona geçmeden önce inventory güncellenecek ve `#29: Pending` kararları kaldırılacak.

### Karar verilecek entry'ler

#### Auth

- `POST /auth/user/login` — session open; aynı key ile retry ikinci session oluşturmamalı.
- `POST /auth/admin/login` — session open; aynı key ile retry ikinci session oluşturmamalı.
- `POST /auth/refresh` — token rotation; mevcut `ROTATED`, `CONCURRENT_REPLAY`, `REUSE_DETECTED` ve `SESSION_CLOSED` semantics korunmalı.
- `POST /auth/logout` — session delete; mevcut durumda naturally idempotent.

#### User

- `DELETE /user/me` — PostgreSQL operation zaten keyed; yalnızca `#29` kapsamındaki Redis version-update boundary incelenecek.
- `POST /user/me/email/confirm` — PostgreSQL mutation + retained success; ilk başarı ve replay `204 No Content`, session/token üretimi yok.
- `PATCH /user/me/password` — PostgreSQL mutation + retained success; ilk başarı ve replay `204 No Content`, session/token üretimi yok.
- `POST /user/activation/complete` — PostgreSQL mutation + retained success; ilk başarı ve replay `204 No Content`, session/token üretimi yok.
- `POST /user/:id/ban` — best-effort monotonic version update.
- `PUT /user/:id/permissions` — best-effort monotonic version update.

#### Admin

- `DELETE /admin/:id` — PostgreSQL operation zaten keyed; yalnızca `#29` kapsamındaki Redis version-update boundary incelenecek.
- `POST /admin/me/email/confirm` — PostgreSQL mutation + retained success; ilk başarı ve replay `204 No Content`, session/token üretimi yok.
- `PATCH /admin/me/password` — PostgreSQL mutation + retained success; ilk başarı ve replay `204 No Content`, session/token üretimi yok.
- `POST /admin/:id/ban` — best-effort monotonic version update.
- `PUT /admin/:id/permissions` — best-effort monotonic version update.

### Beklenen karar yaklaşımı

Her entry explicit request idempotency'ye zorlanmayacak.

Phase 1 sırasında özellikle şu pattern'ler doğrulanacak:

- `closeSession()` / logout: repeated `HDEL` güvenliyse explicit key gerekmez.
- `setVersion()`: mevcut monotonic Lua update yeterliyse explicit key gerekmez.
- login / session creation: aynı logical retry yeni live session oluşturabiliyorsa explicit protection gerekir.
- refresh: login'den ayrı değerlendirilir; gerekiyorsa protection mevcut rotation Lua semantics içine entegre edilir.
- PostgreSQL email-confirm/password-change/user-activation: same-key retry proof/password hazırlığından önce tanınır; mutation/audit/jobs tekrarlanmaz. İlk başarı ve replay login gerektirir, Redis session açmaz veya token üretmez.

Phase 1, `#29` kapsamındaki tüm inventory satırlarında final karar ve kısa rationale bulunduğunda tamamlanmış sayılır.

## Faz 2 — Implementasyon

Yalnızca Phase 1'de gerekli olduğu belirlenen protection'lar implemente edilecek.

### HTTP / command boundary

Explicit protection gereken endpoint'lerde:

- `Idempotency-Key` zorunlu olacak ve API docs'ta gösterilecek;
- mevcut canonicalization/fingerprint kurallarına göre `IdempotencyRequest` oluşturulacak;
- login/refresh command/handler üzerinden protected Redis mutation’a; beş PostgreSQL mutation’da `executePrepared()` sınırına taşınacak.

İlgisiz Redis method'larına bu parametre eklenmeyecek.

### PostgreSQL mutation sonrası yeniden giriş

Onaylı final karar: user/admin password change, user/admin email confirmation ve user activation completion, commit sonrasında Redis session açmaz veya access/refresh token üretmez. İlk başarı ve same-key replay yalnızca `204 No Content` döner.

- Beş endpoint’te `Idempotency-Key` ve canonical fingerprint korunur.
- `executePrepared()` retained PostgreSQL success’i proof/password hazırlığından önce kontrol eder; replay aggregate yüklemez veya mutation/audit/jobs tekrarlamaz.
- Business mutation, success audit, durable jobs ve idempotency success aynı transaction’da commit olur; refusal audit bağımsız durable kalır.
- Gövdesiz başarı için `replayResultId: null` yeterlidir; principal/session identity veya committed session version saklanmaz.
- Password/email confirmation mevcut revocation counter ve reconciliation job’larını korur. Activation counter artırmaz; yeni revocation eklenmez.
- Client eski credential’ları temizleyip yeni password/email ile, activation sonrasında mevcut password ile login olur. Mevcut guard’lar replay’de de geçerlidir; revocation sonrası eski token ile retry 401 alabilir. PostgreSQL retained success guard’ları aşmaz.
- Commit sonrası account reload ve Redis/JWT hata dalı kaldırılır. Bu beş akışın committed-version issuance riski artık uygulanabilir değildir; schema/migration gerekmez.
- Yeni session yalnız user/admin credential login’de açılır; refresh mevcut session’ı rotate eder.

### Redis port contract

Kullanıcının implementasyon incelemesinde onayladığı revizyon: `IdempotencyRequest` ilk parametre kalır; hazır registration alma zorunluluğu kaldırılır. Session authority kimlik ve süreleri ilk mutation dalında oluşturur. Handler `findSessionRequestReplay()` ile credential hazırlığından önce retained success’i okur; mutation Lua’sı replay kontrolünü atomik olarak tekrarlar. Handler dönen registration’ı access/refresh claim’lerine map eder, token portu bu claim’leri imzalar.

```ts
findSessionRequestReplay(
    idempotencyRequest: IdempotencyRequest,
    principalId: string,
    principalType: PrincipalType,
): Promise<ReplaySessionResult>;

openSession(
    idempotencyRequest: IdempotencyRequest,
    id: string,
    principalType: PrincipalType,
    sessionVersion: number,
): Promise<OpenSessionResult>;

rotateSession(
    idempotencyRequest: IdempotencyRequest,
    id: string,
    oldJti: string,
    session: Omit<SessionRegistration, 'refreshTokenJti' | 'refreshExpiresAt'>,
): Promise<RotateSessionResult>;
```

`RotateSessionResult`, `ROTATED` (ilk mutation) ve `REPLAYED` (retained success) için registration; diğer mevcut `RotateSessionOutcome` değerleri için credential içermeyen sonuç taşır. Ek bir `OpenSessionRequest` veya `SessionReplay` wrapper tipi oluşturulmaz.

`ReplaySessionResult` outcome’ları `NOT_FOUND | REPLAYED | CONFLICT | REPLAY_UNAVAILABLE | SESSION_UNAVAILABLE | VERSION_SUPERSEDED` olur. Bu salt-okunur Lua kararı request/session/version TTL’lerini yenilemez. Login email lookup, ban ve password-varlığı kontrollerinden sonra, parola doğrulamasından önce yalnız bir kez sorgular; lookup için principal ID gereklidir. Refresh imza/type/claim doğrulamasından sonra yalnız bir kez sorgular; güncel account/revocation kontrolü token üretiminden önce korunur. Hazırlık hatası, expiry veya activation-required/refusal dallarında sorgu tekrarlanmaz; mevcut audit ve exception davranışı uygulanır. Mutation Lua’sı replay’i atomik olarak tekrar kontrol eder. Ön sorgu concurrent in-flight isteğin tamamlanmasını beklemez; sorgu anında başarı yoksa hazırlık sırasında başarısız olan isteğe sonradan commit eden başarı replay edilmez.

Refresh imza/type/claim ve mutlak session ömrünü doğrular; eski credential expiry’sini retained-success kontrolünden sonraya erteler. `NOT_FOUND` durumunda expired credential rotation yapamaz. Replay’de primary account uygunluğu/revocation kontrolü eski input token yerine winning session version’ını kullanır; permissions güncel okunur. Login replay ek `getRefreshState()` sorgusu yapmaz; ilk email lookup’taki uygunluk/permissions verileri ve Redis session/version kontrolü kullanılır, mevcut PostgreSQL→Redis revocation propagation penceresi korunur. Ban/delete/revocation, logout, expiry veya sonraki rotation nedeniyle geçersiz session yeniden açılmaz. Redis→PostgreSQL audit/jobs koordinasyonu `#16` kapsamındadır.

### Redis adapter / Lua

Kullanıcının onayladığı depolama revizyonu: session'lar `auth:{<principalType>:<id>}:sessions` hash'inde SID alanlarıdır. Redis 8 `HSETEX ... EXAT refreshExpiresAt` her alanın bağımsız expiry'sini korur. Replay kaydındaki SID aynı hash'ten okunur; Lua dinamik Redis key üretmez, eriştiği tüm key'ler `KEYS` içinde açıkça verilir. Logout `HDEL`, access admission `HGET` kullanır; bu akışlara yeni request-idempotency eklenmez.

Protected mutation'larda key sırası:

```text
KEYS[1] = idempotency key
KEYS[2...] = domain key'leri
ARGV[...] = fingerprint, mutation data, TTL'ler
```

Lua script mantığı:

```text
1. Request-idempotency state okunur.
2. Daha önce başarıyla tamamlanmış key mevcutsa:
   - aynı fingerprint → current domain state tekrar değerlendirilmeden retained success / replay outcome döner;
   - farklı fingerprint → conflict döner.
3. Daha önce tamamlanmış success yoksa current domain state doğrulanır.
4. Redis mutation uygulanır.
5. Minimum success/replay metadata atomik olarak yazılır.
6. Kullanılacak registration veya mevcut domain refusal outcome döner.
```

Bu sıra `DeleteAdminCommandHandler` davranışıyla aynı prensibi izler: ilk request başarıyla tamamlandıktan sonra same-key retry, artık değişmiş olan state nedeniyle `404`/`409` gibi farklı bir sonuca düşmez.

Replay sonucu endpoint'e göre iki biçimde ele alınabilir:

- **State-changing resource operation:** İlk success semantics korunur. Örneğin ilk çağrı `204` ise same-key retry da `204` olur.
- **Ephemeral/yeniden üretilebilir response:** İlk operation'ın success semantics korunur; yeni payload yalnızca bunu üretmek yeni bir protected Redis side-effect yaratmıyorsa oluşturulabilir. Örneğin yeni token üretimi aynı mevcut session üzerinden side-effect'siz yapılabiliyorsa farklı token dönebilir; yeni session açıyorsa bu replay değil yeni mutation'dır.

`openSession()` sonucu `OpenSessionResult` ile döner: `OPENED` (ilk mutation) ve `REPLAYED` (retained success) dallarında registration, `CONFLICT`, `REPLAY_UNAVAILABLE`, `SESSION_UNAVAILABLE` ve `VERSION_SUPERSEDED` dallarında `session: null` bulunur. `VERSION_SUPERSEDED`, yeni session isteğinin veya retained registration’ın version’ı Redis floor’unun altında kaldığında döner. Replay sırasında floor eksikse `SESSION_UNAVAILABLE` döner; yeni session açılışı eksik floor’u başlatabilir. `REPLAY_UNAVAILABLE` retained replay session’ının artık kullanılamadığını belirtir. Login eski version reddinde audit yazmadan genel credentials hatası döndürür. HTTP conflict exception dönüşümünü çağıran handler yapar.

Replay kararı, retained session liveness/identity kontrolü, mutation ve idempotency kaydı aynı Lua invocation içindedir. SID/JTI yalnız yeni mutation dalında, server'ın sağladığı kriptografik entropy'den UUID v4 olarak oluşturulur; Lua PRNG kullanılmaz. Ön okumada replay bulunan istek entropy üretmez; ön okuma sonrasında yarışan istekler mutation çağrısında entropy üretebilir, fakat Lua retained success bulursa kullanmaz. Replay TTL veya version TTL yenilemez.

Mevcut session-domain davranışları korunur. Refresh için ayrı generic bir idempotency script'i eklemek yerine mevcut rotation script genişletilir.

### Replay sırasında token yeniden üretimi

Token dönen protected flow'larda same-key retry başarılı kabul ediliyorsa token pair yeniden döndürülebilmelidir; ancak bu işlem yeni bir protected Redis mutation oluşturmamalıdır.

Same-key retained success için şu invariantlar korunur:

- yeni `sid` üretilmez;
- yeni refresh-token `jti` üretilmez;
- `sessionExpiresAt` değiştirilmez;
- `refreshExpiresAt` değiştirilmez;
- `sessionVersion` değiştirilmez;
- Redis session tekrar açılmaz;
- refresh rotation tekrar çalıştırılmaz;
- mevcut retained/live session metadata okunur;
- token pair bu mevcut metadata üzerinden yeniden imzalanır.

Örnek hedef akış:

```text
same-key retry
→ retained request success
→ existing Redis session registration
→ generateTokens(access claims, refresh claims)
→ 200 + token pair
```

Kullanıcının onayladığı token API revizyonu: `generateTokens(accessClaims, refreshClaims)` yalnızca verilen claim'leri imzalar ve token pair döner. Token adapter SID/JTI veya session sürelerini oluşturmaz; `SessionRegistration` almaz veya döndürmez. İlk issuance, rotation ve replay aynı operation'ı kullanır.

Örnek:

```ts
generateTokens(
    accessClaims: Omit<AccessTokenPayload, 'type'>,
    refreshClaims: Omit<RefreshTokenPayload, 'type'>,
): Promise<TokenPair>;
```

Bu operation Redis'e yazmaz ve session state'i değiştirmez. Expiry hesabı veya issuance refusal yapmaz; verilen `exp` değerlerini değiştirmeden imzalar. Session authority, başarılı `openSession()` / `rotateSession()` sonucuna registration'dan ayrı `accessExpiresAt` ekler; bu değer her issuance için access TTL, refresh expiry ve absolute expiry ile sınırlanır, Redis'e saklanmaz. Session liveness ve expiry kararları Lua içinde verilir; Node.js tarafında tekrar değerlendirilmez.

JWT string'inin birebir aynı olması invariant değildir. Invariant; aynı session identity, aynı refresh credential identity ve aynı expiry sınırları üzerinden geçerli credential üretilmesidir.

Retained session artık kapanmış, revoked veya superseded ise replay session'ı yeniden yaratmaz.

### Error semantics

- Redis availability failure'ları mevcut adapter davranışıyla uyumlu şekilde translate edilir.
- Timeout / connection loss sonrasında ambiguous mutation otomatik olarak tekrar çalıştırılmaz.
- Client retry aynı `Idempotency-Key` ile yapılır.
- Aynı key farklı fingerprint ile gelirse mevcut conflict taxonomy kullanılır.
- Lost response rollback olarak değerlendirilmez.

### Dokümantasyon

Implementasyon sonrasında şu dosyalar güncellenecek:

- `docs/idempotency-retry-inventory.md`;
- Redis request-idempotency davranışı reusable project invariant haline geldiyse ilgili `agent/*` architecture dokümanı;
- yeni `Idempotency-Key` gerektiren endpoint'lerin API documentation'ı.

## Faz 3 — Test

### Unit testler

Protected her Lua-backed mutation için:

- ilk request'in protected mutation'ı yalnızca bir kez yaptığı;
- aynı key + aynı fingerprint retry'ında protected side-effect'in tekrar uygulanmadığı;
- aynı key + farklı fingerprint durumunda conflict döndüğü;
- domain rejection sonrasında yanlışlıkla successful idempotency kaydı tutulmadığı;
- mevcut domain outcome'larının değişmediği;
- idempotency key'in `KEYS[1]` olarak gönderildiği;
- multi-key operation'ların Redis hash slot uyumluluğunu koruduğu

test edilecek.

Naturally retry-safe operation'larda explicit key gerekmemesinin sebebini doğrulayan mevcut veya yeni testler korunacak.

### Integration / E2E testler

Inventory kararlarına göre:

- required / malformed `Idempotency-Key`;
- aynı logical request'in aynı key ile retry edilmesi ve original success semantics'in korunması;
- concurrent same-key request'ler;
- Redis üzerinde SID alanlarının bağımsız expiry’si, 120 saniyelik request retention ve replay’in session/request/version TTL’lerini yenilememesi;
- ambiguous Redis outcome sonrasında same-key retry;
- protected login'de istemeden birden fazla session oluşmaması ve successful retry'ın current session state nedeniyle farklı bir failure'a düşmemesi;
- beş PostgreSQL endpoint’inde ilk başarı ve replay’in yalnız `204 No Content` döndürdüğü; session açma/token signing/account reload yapılmadığı ve mutation/audit/jobs tekrarlanmadığı;
- refresh retry'ın yanlışlıkla refresh-token reuse remediation tetiklememesi;
- logout'un ek request-level protection olmadan repeat-safe kalması;
- monotonic version update'ların tekrar altında güvenli kalması

doğrulanacak.

### Final doğrulama

- lint, typecheck, unit testler, integration/E2E testler ve project test suite çalıştırılacak.
- `#29` kapsamındaki tüm inventory satırları final implementasyonla tekrar karşılaştırılacak.
- `#29: Pending` olarak kalan karar olmayacak.
- `#16` kapsamındaki Redis → PostgreSQL / pg-boss tutarlılık konusu bu implementasyona taşınmamış olacak.

## Faz 4 — Final envanter doğrulaması

Kullanıcı talebiyle envanter Faz 2’de mevcut implementasyona göre güncellenir; bu, Faz 3 doğrulamalarının tamamlandığı anlamına gelmez. Testler tamamlandıktan sonra final karşılaştırma yapılır.

- Faz 2’de güncellenen #29 satırları test sonuçlarıyla doğrulanır; kalan planned davranış varsa final implementasyonla değiştirilir.
- Login/refresh Redis replay’i ile beş PostgreSQL mutation’ın gövdesiz `204 No Content` replay’i ayrı belgelenir.
- Issue tamamlandığında envanterden **tüm `#29` referansları kaldırılır**; `Tracked by #29`, `#29-owned`, `#29` notları veya benzeri geçici ownership ifadeleri bırakılmaz.
- Envanter yalnız doğrulanmış final davranışı tarif eder; tasarım notu veya geçici plan bırakılmaz.
- #16, #30 ve #3 gibi ayrı issue ownership'leri korunur.
