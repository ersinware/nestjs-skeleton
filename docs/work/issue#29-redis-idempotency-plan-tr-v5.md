# Issue #29 — Redis HTTP Mutation Idempotency Planı

## Hedef

`#29` kapsamında izlenen tüm production HTTP entry point'lerini gözden geçirmek, `docs/idempotency-retry-inventory.md` üzerinden retry-safety kararlarını netleştirmek ve yalnızca aynı logical request'in tekrarının istenmeyen Redis side-effect üretebildiği yerlerde explicit request-level protection eklemek.

Bu issue yalnızca **HTTP request → Redis mutation** sınırını kapsar. Redis → PostgreSQL / pg-boss follow-up tutarlılığı `#16` kapsamında kalır.

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
- Redis request-idempotency success kayıtları **5 dakika (300 saniye)** TTL ile tutulur; bu süre session/refresh-token ömründen bağımsız bounded retry penceresidir.
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

- `POST /auth/user/login` — session open; retry şu anda yeni session oluşturabilir.
- `POST /auth/admin/login` — session open; retry şu anda yeni session oluşturabilir.
- `POST /auth/refresh` — token rotation; mevcut `ROTATED`, `CONCURRENT_REPLAY`, `REUSE_DETECTED` ve `SESSION_CLOSED` semantics korunmalı.
- `POST /auth/logout` — session delete; mevcut durumda naturally idempotent.

#### User

- `DELETE /user/me` — PostgreSQL operation zaten keyed; yalnızca `#29` kapsamındaki Redis version-update boundary incelenecek.
- `POST /user/me/email/confirm` — committed PostgreSQL work sonrasında replacement session.
- `PATCH /user/me/password` — committed PostgreSQL work sonrasında replacement session.
- `POST /user/activation/complete` — committed PostgreSQL work sonrasında replacement session.
- `POST /user/:id/ban` — best-effort monotonic version update.
- `PUT /user/:id/permissions` — best-effort monotonic version update.

#### Admin

- `DELETE /admin/:id` — PostgreSQL operation zaten keyed; yalnızca `#29` kapsamındaki Redis version-update boundary incelenecek.
- `POST /admin/me/email/confirm` — committed PostgreSQL work sonrasında replacement session.
- `PATCH /admin/me/password` — committed PostgreSQL work sonrasında replacement session.
- `POST /admin/:id/ban` — best-effort monotonic version update.
- `PUT /admin/:id/permissions` — best-effort monotonic version update.

### Beklenen karar yaklaşımı

Her entry explicit request idempotency'ye zorlanmayacak.

Phase 1 sırasında özellikle şu pattern'ler doğrulanacak:

- `closeSession()` / logout: repeated `DEL` güvenliyse explicit key gerekmez.
- `setVersion()`: mevcut monotonic Lua update yeterliyse explicit key gerekmez.
- login / session creation: aynı logical retry yeni live session oluşturabiliyorsa explicit protection gerekir.
- refresh: login'den ayrı değerlendirilir; gerekiyorsa protection mevcut rotation Lua semantics içine entegre edilir.
- replacement-session flow'ları: same-key retry önce başarılı logical operation olarak tanınmalı; current state nedeniyle sonradan failure'a düşmemelidir. Token payload'ı birebir replay edilmek zorunda değildir, ancak yeni token üretimi yeni session veya başka protected Redis mutation yaratıyorsa bu ayrıca protection gerektirir.

Phase 1, `#29` kapsamındaki tüm inventory satırlarında final karar ve kısa rationale bulunduğunda tamamlanmış sayılır.

## Faz 2 — Implementasyon

Yalnızca Phase 1'de gerekli olduğu belirlenen protection'lar implemente edilecek.

### HTTP / command boundary

Explicit protection gereken endpoint'lerde:

- `Idempotency-Key` zorunlu olacak ve API docs'ta gösterilecek;
- mevcut canonicalization/fingerprint kurallarına göre `IdempotencyRequest` oluşturulacak;
- command/handler üzerinden protected side-effect'i gerçekten yapan Redis mutation'a taşınacak.

İlgisiz Redis method'larına bu parametre eklenmeyecek.

### Redis port contract

Protected method'larda mevcut signature yapısı korunacak ve `IdempotencyRequest` ilk parametre olacak.

Örnek:

```ts
openSession(
    idempotencyRequest: IdempotencyRequest,
    id: string,
    session: SessionRegistration,
): Promise<OpenSessionOutcome>;
```

Eğer `rotateSession()` explicit request protection gerektirirse:

```ts
rotateSession(
    idempotencyRequest: IdempotencyRequest,
    id: string,
    oldJti: string,
    session: SessionRegistration,
): Promise<RotateOutcome>;
```

Ek bir `OpenSessionRequest` wrapper tipi oluşturulmayacak.

### Redis adapter / Lua

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
6. Domain outcome döner.
```

Bu sıra `DeleteAdminCommandHandler` davranışıyla aynı prensibi izler: ilk request başarıyla tamamlandıktan sonra same-key retry, artık değişmiş olan state nedeniyle `404`/`409` gibi farklı bir sonuca düşmez.

Replay sonucu endpoint'e göre iki biçimde ele alınabilir:

- **State-changing resource operation:** İlk success semantics korunur. Örneğin ilk çağrı `204` ise same-key retry da `204` olur.
- **Ephemeral/yeniden üretilebilir response:** İlk operation'ın success semantics korunur; yeni payload yalnızca bunu üretmek yeni bir protected Redis side-effect yaratmıyorsa oluşturulabilir. Örneğin yeni token üretimi aynı mevcut session üzerinden side-effect'siz yapılabiliyorsa farklı token dönebilir; yeni session açıyorsa bu replay değil yeni mutation'dır.

Idempotency kaydı ile mutation aynı Lua invocation içinde yazılır.

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
→ reissueTokens(existing session metadata)
→ 200 + token pair
```

Bu amaçla `generateTokens()` kullanılmamalıdır; çünkü yeni `sid` ve yeni refresh `jti` üretir. Token port'ta mevcut session registration üzerinden credential imzalayan ayrı bir operation kullanılmalıdır.

Örnek:

```ts
reissueTokens(
    principal: Principal,
    session: SessionRegistration,
): Promise<TokenPair>;
```

Bu operation Redis'e yazmaz ve session state'i değiştirmez.

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
- ambiguous Redis outcome sonrasında same-key retry;
- protected login'de istemeden birden fazla session oluşmaması ve successful retry'ın current session state nedeniyle farklı bir failure'a düşmemesi;
- email confirm, password change ve activation retry'larında retained session üzerinden token pair döndürüldüğü ve replay'in yeni session açmadığı;
- refresh retry'ın yanlışlıkla refresh-token reuse remediation tetiklememesi;
- logout'un ek request-level protection olmadan repeat-safe kalması;
- monotonic version update'ların tekrar altında güvenli kalması

doğrulanacak.

### Final doğrulama

- lint, typecheck, unit testler, integration/E2E testler ve project test suite çalıştırılacak.
- `#29` kapsamındaki tüm inventory satırları final implementasyonla tekrar karşılaştırılacak.
- `#29: Pending` olarak kalan karar olmayacak.
- `#16` kapsamındaki Redis → PostgreSQL / pg-boss tutarlılık konusu bu implementasyona taşınmamış olacak.

## Faz 4 — Envanter güncellemesi

Implementasyon ve testler tamamlandıktan sonra `docs/idempotency-retry-inventory.md` güncellenir.

- `Planned` olarak işaretlenen #29 satırları gerçek final davranışla değiştirilir.
- Login, refresh ve replacement-session akışlarının `Idempotency-Key`, retry ve replay davranışı implementasyona göre netleştirilir.
- Issue tamamlandığında envanterden **tüm `#29` referansları kaldırılır**; `Tracked by #29`, `#29-owned`, `#29` notları veya benzeri geçici ownership ifadeleri bırakılmaz.
- Envanter yalnız doğrulanmış final davranışı tarif eder; tasarım notu veya geçici plan bırakılmaz.
- #16, #30 ve #3 gibi ayrı issue ownership'leri korunur.
