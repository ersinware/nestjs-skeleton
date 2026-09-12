## Genel değerlendirme

Mimari sağlam kurulmuş: ayrı secret'lı üç token tipi, `type` discriminator, atomik Lua ile refresh
rotasyonu ve RFC 9700 reuse tespiti, fail-closed session version, iki sayaçlı (sessionVersion /
revocationVersion) revocation modeli, aggregate içinde rank invariant'ları, root için partial unique
index. Yetkilendirme kurallarında (root / manager / ordinary, self, cross-kind) kapatılmamış bir
yükselme zinciri bulunamadı. Aşağıdakiler bu tabanın üstündeki gerçek boşluklar.

---

## Orta

### 1. ~~`logout-all` access token'ları öldürmüyor~~ — kapatıldı

`logout-all/handler.ts` yalnızca `closeAllSessions` çağırıyor; sessionVersion bump yok. "Cihazım
çalındı" senaryosunda çalınan access token 15 dakika daha çalışır. Ban, şifre değişikliği ve reuse
tespiti sayaçları bumplarken kullanıcının kendi tetiklediği en kritik revocation bunu yapmıyor.
Auth'un aggregate'i olmadığından çözüm: bir integration event ile sahibi modülün `RevokeXSessions`
komutunu tetiklemek (mevcut reuse akışıyla aynı yol), session sweep'i handler'da kalır.

### 2. ~~Login zamanlama oracle'ı~~ — kapatıldı

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

### 7. JWT sertleştirme

`token.adapter.ts` `verifyAsync`'te `algorithms` pinlemiyor (jsonwebtoken 9 string secret için HS
ailesine kısıtlıyor, yine de `['HS256']` yazılmalı); `iss`/`aud` yok; secret rotasyonu yok.
`env.validation.ts` üç secret için yalnızca `@IsString()` istiyor, `.env.example` değerleri zayıf.
En az 32 byte şartı eklenmeli.

### 8. ~~`@Permissions()` boş çağrı her kimliği kabul ediyor~~ — kapatıldı

`authorization.guard.ts` `length === 0` durumunu "gereksinim yok" sayıyor. Kısıtlama gibi okunan ama
kısıtlamayan bir dekoratör. Dekoratör içinde boş liste reddedilmeli.

### 9. ~~`logout` gövdedeki refresh token'ın `sub`'ını çağıranla karşılaştırmıyor~~ — kapatıldı

Pratikte zararsız (o token'ı elinde tutan zaten oturumun sahibi), ama audit'te "başkasının oturumunu
kapatan principal" olarak yorumlanan bir durum yaratıyor. Eşleşmezse reddetmek daha temiz.

### 10. Refresh handler'da sıra

`setVersion` (TTL yenilemesi dahil) ve token üretimi tek-kullanım kapısından önce çalışıyor;
çalınmış bir token reddedilirken bile version key'in TTL'ini uzatıyor. Etkisi ihmal edilebilir,
ancak rotasyonu öne almak niyeti daha iyi anlatır.
