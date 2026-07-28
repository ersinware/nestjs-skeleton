# Bilinen Açık: Session Version Fail-Open

**Durum:** Bilinçli olarak ertelendi — çözülmedi.
**Tespit:** 2026-07-19, exception & observability denetimi sırasında.
**Etki:** Ban/şifre değişikliği sonrası anlık oturum sonlandırma, dar bir pencerede sessizce uygulanmayabilir.
**Aciliyet:** Düşük — maruziyet ≤ `JWT_ACCESS_TTL` (varsayılan 15dk) ve refresh yolu etkilenmiyor.

---

## 1. Sorun

`getVersion` cache'te key bulamadığında `0` döner:

```ts
// src/core/security/session/adapter.ts
async getVersion(id: string): Promise<number> {
    const value = await this.redis.get(`version:${id}`);
    return value ? Number(value) : 0;
}
```

`AuthGuard` bu değeri şöyle kullanır:

```ts
// src/core/security/auth/guard/auth.guard.ts
if (payload.version < currentVersion) {
    throw new UnauthenticatedException();
}
```

`currentVersion === 0` olduğunda bu koşul **hiçbir zaman** sağlanmaz — her token kabul edilir.

### Kök neden: yokluk belirsiz

Key'in olmaması iki tamamen farklı durumu ifade eder ve ikisi ayırt edilemez:

| Durum             | Anlamı                                        | Doğru davranış |
| ----------------- | --------------------------------------------- | -------------- |
| Hiç yazılmadı     | Kullanıcının version'ı hiç artmadı (çoğunluk) | Kabul et       |
| Yazıldı, kayboldu | Ban uygulandı ama Redis'te iz yok             | **Reddet**     |

Cache'in kendi içinde bu ayrımı yapmanın yolu yoktur. Çözüm mutlaka cache'in dışından gelmek zorundadır.

### Senaryo

1. `redis-state` erişilemez durumda
2. Bir admin banlanır → DB'de `version` artar, `save()` başarılı
3. `sessionPort.setVersion(...)` başarısız olur → handler'daki `catch` yalnızca loglar
4. Aynı anda `AdminSessionListener` de aynı Redis'e yazmaya çalışır → o da başarısız
5. Redis geri gelir — **`version:` key'i yoktur, kimse tekrar denemez**
6. Banlanan kullanıcının elindeki access token, süresi dolana kadar geçerli kalır

Etkilenen `catch` blokları (hepsi `setVersion` çevresinde, aynı desen):

- `module/admin/application/command/ban-admin/handler.ts`
- `module/admin/application/command/delete-admin/handler.ts`
- `module/admin/application/command/revoke-admin-sessions/handler.ts`
- `module/user/application/command/ban-user/handler.ts`
- `module/user/application/command/delete-user/handler.ts`
- `module/user/application/command/change-user-password/handler.ts`
- `module/user/application/command/revoke-user-sessions/handler.ts`

---

## 2. Riski sınırlayan faktörler

Sorunun ciddiyetini düşüren, tasarımda **zaten var olan** korumalar:

**Refresh yolu etkilenmiyor.** `refresh-tokens/handler.ts` hem `isBanned`'i hem `version`'ı **veritabanından** okur. Banlanan kullanıcı refresh yapamaz; access token'ı dolduğunda oturum kesin biter.

**Maruziyet access token ömrüyle sınırlı.** `JWT_ACCESS_TTL=15m`. Başarısızlık modu "güvenlik yok" değil, **"standart JWT semantiği"** — anlık eviction bir optimizasyondur; kaybolduğunda sistem JWT'nin doğal davranışına (süre dolana kadar bekle) düşer.

**Eviction ile kaybolamaz.** `version:*` key'leri `redis-state`'te tutulur; bu instance'ta `maxmemory` tanımlı değildir, dolayısıyla policy `noeviction`'dır. Bellek baskısı altında atılmaları mümkün değildir.

```yaml
# docker-compose.yml
redis-cache: --maxmemory 100mb --maxmemory-policy allkeys-lru # volume yok
redis-state: --save 60 1 # redis_state_data volume
```

**Restart'ta kaybolmaz.** RDB persistence + named volume mevcut.

### Geriye kalan gerçek vektörler

1. **Ban tam olarak Redis erişilemezken uygulanırsa** — hem handler hem listener başarısız olur, tekrar deneyen yoktur
2. **`--save 60 1`** — sert çökmede son 60 saniyenin yazımı kaybolur

---

## 3. Çözüm seçenekleri

### A) Cache-miss'te DB'den okuma — uygulanamaz

`AuthGuard` `core` katmanındadır; `core` bir `module`'e import edemez ve schema-per-module gereği `user`/`admin` tablolarını okuyamaz. Port açıp adapter'ı module'e koymak bu yasağı dolanmak olur.

Mimari izin verse bile yanlış olurdu: her cache-miss'te DB okuması, hiç banlanmamış kullanıcılar (yani neredeyse herkes) için auth hot path'ine DB round-trip ekler ve Redis'i araya koymanın amacını ortadan kaldırır.

**Sonuç: DB okuması gerekmiyor ve bu tasarımda yapılamaz.**

### B) Yokluğu anlamlı hale getir → fail-closed — gerçek çözüm

Cache dışından gelecek bilgi DB olmak zorunda değil; **login'in kendisi** o bilgiyi zaten elinde tutuyor. Bugün login `openSession` çağırıyor ama `setVersion` çağırmıyor — oysa `user.version` elinde.

Üç değişiklik:

1. Login **her zaman** `setVersion(id, user.version)` yazsın
2. `ROTATE_SESSION_LUA` aynı round-trip'te version key'inin TTL'ini tazelesin
3. `getVersion` yokluğu `0` yerine "bilinmiyor" dönsün, `AuthGuard` fail-closed davransın

Bundan sonra "version key yok" = "canlı oturum yok" anlamına gelir ve bu güvenlidir: access token 15dk, version key 7 gün yaşar. Key yoksa o token zaten ölmüştür.

**Bedeli:** state Redis veri kaybederse herkes çıkış yapmış olur. Sessiz bir güvenlik boşluğu, gürültülü bir availability olayına dönüşür. Bir güvenlik kontrolü için doğru duruştur — `AuthGuard` zaten Redis _erişilemezken_ fail-closed davranıp 503 döner; bu yalnızca aynı duruşu veri kaybına genişletir. Ancak `--save 60 1` ile sert çökmede o 60 saniyede login olan herkes tekrar giriş yapar.

### C) Transactional outbox — kısmi

Yol haritasındaki outbox, **vektör 1**'i kapatır: `setVersion` relay tarafından başarana kadar tekrar denenir. **Vektör 2**'yi (sonradan veri kaybı) kapatmaz. Bu bulgu, outbox için ek bir gerekçedir.

### D) Kabul et + tespit et + belgele — mevcut tercih

Maruziyet ≤15dk ve refresh yolu güvenli olduğu için savunulabilir. Şartı: **bilinçli olması ve görünür olması.**

---

## 4. Karar ve yapılacaklar

**Seçilen: D.** B gerçek bir çözüm, ancak bedeli (veri kaybında toplu logout) şu anki maruziyetten (15dk, refresh kapalı) daha büyük.

**B'ye geçme kriteri:** Tehdit modeli "ban anında geçerli olmalı, 15 dakika bile kabul edilemez" dediğinde. O noktada doğru cevap B'dir.

### Yapılacaklar (küçükten büyüğe)

- [ ] **`redis-state`'e AOF ekle** — `docker-compose.yml`'e `--appendonly yes --appendfsync everysec`. Çökmede kayıp penceresi 60s → 1s. Güvenlik state'i tutan bir store için RDB tek başına zayıf. Tek satır.
- [ ] **`getVersion`'ın `0` fallback'ine gerekçe yorumu yaz** — `session/adapter.ts`. Şu an masum görünüyor; bunun _bilinçli bir fail-open_ olduğunu ve neden kabul edildiğini (access TTL sınırı + refresh'in DB otoritesi) yazan bir yorum, sonraki okuyucunun bunu bug sanıp yanlış "düzeltmesini" engeller.
- [x] ~~`setVersion` catch'leri Sentry'ye raporlasın~~ — **2026-07-19'da tersine karar verildi:** komut içi `setVersion` best-effort bir hızlandırmadır; kalıcı düzeltme outbox geldiğinde event yolundan sağlanacak. Bu 7 catch artık **sessizdir** (log yok, Sentry yok) ve her biri bu dosyaya işaret eden açıklayıcı bir yorum taşır.
- [ ] _(ertelendi)_ B seçeneğinin uygulanması — yalnızca yukarıdaki kriter sağlanırsa.

---

## İlgili dosyalar

| Dosya                                                           | Rolü                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/core/security/session/adapter.ts`                          | `getVersion` fail-open, `setVersion`, `ROTATE_SESSION_LUA` |
| `src/core/security/auth/guard/auth.guard.ts`                    | Version karşılaştırması                                    |
| `src/module/auth/application/command/refresh-tokens/handler.ts` | DB otoritesi — riski sınırlayan yol                        |
| `src/module/auth/application/command/login-*/handler.ts`        | B seçeneğinde `setVersion` eklenecek yer                   |
| `src/module/*/application/event/*-session.listener.ts`          | İkincil reconcile yolu (aynı Redis'e bağımlı)              |
| `docker-compose.yml`                                            | `redis-state` persistence/eviction ayarları                |
