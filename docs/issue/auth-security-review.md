## Orta

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
