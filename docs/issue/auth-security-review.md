# Authentication & Authorization — Güvenlik İncelemesi Bulguları

**Durum:** Açık — bulgular not alındı, henüz hiçbiri düzeltilmedi; adım adım ilerlenecek.
**Tarih:** 2026-09-08. JWT, session, izin modeli ve rank invariant'larının tam incelemesi.
**Not:** Transactional outbox varmış gibi değerlendirildi. Event teslimatının güvenilmezliğinden
kaynaklanan hiçbir madde burada yok; o boşluk `CLAUDE.md` § Reliable messaging'de.
**Kapatılan:** Aggregate writer'lardaki lost update yarışı (upsert tüm satırı ezerdi, optimistic lock
yoktu). İncelemenin en yüksek öncelikli bulgusuydu; `AggregateRoot.version` + koşullu upsert
(`WHERE version = loaded`, 0 satır → `ResourceConflictException(CONCURRENT_MODIFICATION)`) ile
2026-09-08'de kapatıldı. Kural `CLAUDE.md` § Adapters'ta.

---

## Genel değerlendirme

Mimari sağlam kurulmuş: ayrı secret'lı üç token tipi, `type` discriminator, atomik Lua ile refresh
rotasyonu ve RFC 9700 reuse tespiti, fail-closed session version, iki sayaçlı (sessionVersion /
revocationVersion) revocation modeli, aggregate içinde rank invariant'ları, root için partial unique
index. Yetkilendirme kurallarında (root / manager / ordinary, self, cross-kind) kapatılmamış bir
yükselme zinciri bulunamadı. Aşağıdakiler bu tabanın üstündeki gerçek boşluklar.

---

## Orta

### 1. `logout-all` access token'ları öldürmüyor

`logout-all/handler.ts` yalnızca `closeAllSessions` çağırıyor; sessionVersion bump yok. "Cihazım
çalındı" senaryosunda çalınan access token 15 dakika daha çalışır. Ban, şifre değişikliği ve reuse
tespiti sayaçları bumplarken kullanıcının kendi tetiklediği en kritik revocation bunu yapmıyor.
Auth'un aggregate'i olmadığından çözüm: bir integration event ile sahibi modülün `RevokeXSessions`
komutunu tetiklemek (mevcut reuse akışıyla aynı yol), session sweep'i handler'da kalır.

### 2. Login zamanlama oracle'ı

`login.util.ts` hesap yoksa, pending'se veya banlıysa argon2 `verify` çalıştırmadan reddediyor.
Argon2 (19 MiB, t=2) onlarca ms sürer, yanıt süresinden e-posta varlığı okunur. Mesaj tekilleştirilmiş
ama süre değil. Her red yolunda sabit bir dummy hash'e karşı `verify` çalıştırılmalı. Rate limiting
gelene kadar bu tek savunma.

### 3. E-posta değişikliği yalnızca access token ile

`PATCH /me` ve `PATCH /admin/me` e-postayı doğrulama veya mevcut şifre olmadan değiştiriyor. E-posta
login kimliği; XSS ile çalınan 15 dakikalık bir access token hesabı kalıcı olarak ele geçirir (şifre
değişikliği `currentPassword` istiyor, e-posta istemiyor, tutarsız). Öneri: e-posta değişimi için
mevcut şifre şartı veya yeni adrese doğrulama.

### 4. Re-invite eski invite token'ı geçersiz kılmıyor

`send-admin-invite/handler.ts` her seferinde yeni bir JWT basıyor; token'da jti veya state bağı yok.
Re-invite çoğunlukla ilk e-posta yanlış yere gittiği için yapılır, ama eski token 3 gün boyunca
hesabı aktive edebilir. Öneri: admin satırında bir `inviteNonce` tutup token'a gömmek, activate'te
karşılaştırmak. Mevcut sayaç deseniyle aynı fikir.

### 5. E-posta gövdesinde HTML injection

İnvite ve security e-postaları `name`'i ham interpolate ediyor; `IsPersonName` regex'i `<` `>` kabul
ediyor. `ADMIN_ACCOUNT_INVITE` sahibi düşük kademeli bir admin, davet ettiği kişiye gövdesi kendi
HTML'i olan (örneğin sahte aktivasyon linki) bir e-posta gönderebilir ve ilk şifreyi phishing'le
alabilir. Escape'i emailer adapter'ında veya bir template katmanında merkezileştirmek gerekir.

---

## Düşük / sertleştirme

### 6. Grace penceresi kör nokta

Saldırgan çalınan refresh token'ı meşru istemciden önce kullanırsa ve meşru istemci 30 s içinde
refresh ederse sonuç `CONCURRENT_REPLAY`: 409, audit yok, revocation yok, saldırganın oturumu yaşar.
Tasarımın kabul ettiği bir takas ama sinyalsiz kalmamalı. `CONCURRENT_REPLAY` düşük öncelikli bir
audit kaydına bağlanmalı; grace'i daha da kısaltmak değerlendirilmeli.

### 7. JWT sertleştirme

`token.adapter.ts` `verifyAsync`'te `algorithms` pinlemiyor (jsonwebtoken 9 string secret için HS
ailesine kısıtlıyor, yine de `['HS256']` yazılmalı); `iss`/`aud` yok; secret rotasyonu yok.
`env.validation.ts` üç secret için yalnızca `@IsString()` istiyor, `.env.example` değerleri zayıf.
En az 32 byte şartı eklenmeli.

### 8. `@Permissions()` boş çağrı her kimliği kabul ediyor

`authorization.guard.ts` `length === 0` durumunu "gereksinim yok" sayıyor. Kısıtlama gibi okunan ama
kısıtlamayan bir dekoratör. Dekoratör içinde boş liste reddedilmeli.

### 9. `logout` gövdedeki refresh token'ın `sub`'ını çağıranla karşılaştırmıyor

Pratikte zararsız (o token'ı elinde tutan zaten oturumun sahibi), ama audit'te "başkasının oturumunu
kapatan principal" olarak yorumlanan bir durum yaratıyor. Eşleşmezse reddetmek daha temiz.

### 10. Refresh handler'da sıra

`setVersion` (TTL yenilemesi dahil) ve token üretimi tek-kullanım kapısından önce çalışıyor;
çalınmış bir token reddedilirken bile version key'in TTL'ini uzatıyor. Etkisi ihmal edilebilir,
ancak rotasyonu öne almak niyeti daha iyi anlatır.

### 11. `helmet` ve CORS yapılandırması yok

Bearer token kullanıldığından CSRF yok, ama `/docs` altında Scalar UI servis ediliyor; temel güvenlik
başlıkları eklenmeli.

---

## Doğru olduğu teyit edilenler

Bir sonraki inceleme yeniden türetmesin diye kaydedildi.

- Root: verilemez, alınamaz, banlanamaz, silinemez; kendini de yönetemez. Partial unique index elle
  ikinci root'u da engeller.
- Manager: `MANAGE`'i yalnızca root verir/alır; manager başka manager'ı yönetemez, kendine dokunamaz.
  Ordinary + `ADMIN_ACCOUNT_BAN` yalnızca ordinary'yi banlar. Yükselme zinciri kapalı.
- Cross-kind: user için holdable izin yok; `assertAdministrableBy` non-admin aktörü
  `SystemException` ile yakalıyor.
- Guard sırası doğru (auth önce authz), `@Public` yalnızca beklenen rotalarda, `/health` detayı
  izinli, audit-trail sınıf düzeyinde izinli.
- Invite token pending, banlı ve silinmiş hesapları reddediyor; tek mesajla.
- Soft-deleted aggregate immutable; writer `load` deleted'ı süzüyor.
- Refresh rotasyonu atomik (Lua), reuse tespiti aileyi revoke ediyor, tombstone'lar session'larla
  birlikte süpürülüyor, version key monotonic-max ve fail-closed.

---

## Çalışma sırası

1. ~~Lost update yarışı~~ — kapatıldı.
2. Bulgu 1–5: her biri küçük ve rate limiting'den bağımsız.
3. Bulgu 6–11 sertleştirme turu olarak.
