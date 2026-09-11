# Session Veri Kaybı, Geri Yükleme ve İptal Güvenliği

**Durum:** Açık; çözüm seçenekleri henüz kararlaştırılmadı veya uygulanmadı.
**İnceleme tarihi:** 2026-09-09.
**Kapsam:** Redis durumunun kaybolması/gerilemesi, access ve refresh token iptallerinin korunması,
gelecekteki RabbitMQ outbox/inbox çalışmasıyla ilişkisi.

Bu not, mevcut koddan çıkarılan olası arıza ve eşzamanlılık senaryolarını anlatır; üretimde
gözlemlenmiş olay veya testle yeniden üretilmiş bulgu değildir. İlgili genel inceleme:
[Authentication & Authorization](auth-security-review.md). Bu dosya yeni bir mimari karar değildir.

## 1. Mevcut model ve garantilerinin sınırı

- Principal sahibi modül DB'de `sessionVersion` ve `revocationVersion` tutar.
- Permission değişikliği yalnızca `sessionVersion` artırır. Tam iptal ayrıca
  `revocationVersion` değerini yeni session sürümüne taşır.
- Redis, access kontrolü için `sessionVersion` değerini yansıtır. Guard DB'ye bakmaz;
  version anahtarı yoksa veya token sürümü Redis eşiğinin altındaysa 401 döner.
- Login, okuduğu kimliğin sürümünü ve permission'larını kullanır; version yazımını ve
  refresh-session açılışını bekler. Refresh primary auth state üzerinden revocation
  eşiğini kontrol eder, version yazar ve session rotation'ını bekler.
- `VERSION_LUA`, mevcut Redis değeri ile gelen sürümün maksimumunu atomik olarak saklar.
  Her yazım refresh-lifetime TTL'yi yeniler. Anahtar yoksa gelen değer yazılır.
- `session:<id>:<jti>` anahtarının varlığı aktif refresh credential'ını temsil eder;
  ham JWT saklanmaz. Rotation eski anahtarı silip yenisini ve grace tombstone'unu oluşturur.
  Tek-session logout yalnızca ilgili refresh-session anahtarını siler; DB sayaçlarını artırmaz.
- Compose session Redis için AOF, `appendfsync everysec`, RDB snapshot ve kalıcı volume kullanır.
  Bunlar kayıpsız geri yükleme garantisi değildir. Redis belgelerine göre `everysec`, çökmede
  yaklaşık son bir saniyelik yazının kaybına izin verebilir; eski backup daha geniş geri dönüş yaratabilir.

**Atomiklik ile kalıcılık farklıdır:** Lua eşzamanlı istemcilerin işlemi bölmesini engeller;
başarılı işlemin etkisinin disk kaybı, eski backup veya veri kaybeden failover sonrasında
korunacağını tek başına garanti etmez. Her Redis restart'ı veri kaybı anlamına da gelmez.

Kaynak kod:

- [SessionAdapter](../../src/core/security/session/adapter/session.adapter.ts)
- [AuthenticationGuard](../../src/core/security/auth/guard/authentication.guard.ts)
- [Login](../../src/module/auth/application/command/login.util.ts)
- [Refresh](../../src/module/auth/application/command/refresh-tokens/handler.ts)
- [Logout](../../src/module/auth/application/command/logout/handler.ts)
- [Compose](../../docker-compose.yml)

## 2. Sorun: kaybolan version anahtarının eski değerle oluşturulması

Örnek zamanlama:

| Adım | Olay                                                                       | DB  | Redis |
| ---- | -------------------------------------------------------------------------- | --- | ----- |
| 1    | Login kimliği okur; sürüm ve permission'lar belleğe alınır                 | 11  | 11    |
| 2    | Login parola doğrulaması veya başka bir async adımda bekler                | 11  | 11    |
| 3    | Başka istek permission değiştirir; yeni sürüm Redis'e de ulaşır            | 12  | 12    |
| 4    | Redis veri kaybeder; version anahtarı kaybolur                             | 12  | yok   |
| 5    | Eski login devam eder ve belleğindeki sürümle `setVersion(id, 11)` çağırır | 12  | 11    |
| 6    | Login eski permission'larla, sürümü 11 olan token döndürür                 | 12  | 11    |

Son istek Redis tekrar erişilebilir olduktan sonra yazabiliyorsa bu sıralama mümkündür.
Anahtar mevcut kalsaydı max işlemi 12'yi koruyacak, eski token guard'dan geçemeyecekti.
Anahtar kaybolunca Lua önceki 12 değerini hatırlamaz; 11'i yeni başlangıç kabul eder.

**Zarar:** Henüz süresi dolmamış, geri alınmış permission'ları taşıyan access token kabul
edilebilir. Tam iptal eşiği de Redis'te gerilerse ban/password/logout-all nedeniyle iptal
edilmiş eski access token'lar için benzer risk vardır. JWT imzası kırılmaz; geçerli imzalı
bir token'a yanlış iptal eşiği uygulanır. Saldırganın böyle bir token'a sahip olması gerekir.

Anahtarın eksik olması tek başına erişim açmaz: guard 401 verir. Eksik anahtara güncel,
doğru sürüm yazılması da tek başına sorun değildir. Risk eski değerle yeniden oluşturulmasıdır.
Normal TTL dolumunda eski JWT'ler zaten süresi dolmuş olabilir; her anahtar kaybı aynı etkiyi yaratmaz.

## 3. Sorun: eski version değerinin doğrudan geri yüklenmesi

1. DB ve Redis 12'ye ilerlemiştir; eski access token'ın sürümü 11'dir.
2. Redis 11 içeren eski kalıcı durumdan geri açılır; DB 12 olarak kalır.
3. Guard 11 sürümlü token'ı Redis'teki 11 ile karşılaştırır ve kabul eder.

Bu senaryo için gecikmiş login gerekmez. Max yazımı ancak güncel bir değer tekrar geldiğinde
iyileştirir; okuma sırasında Redis değerinin eski olduğunu anlayamaz. Reconciliation bu aralığı
kısaltabilir ancak tek başına aralık boyunca erişimi önlemez.

## 4. Sorun: logout/rotation ile tüketilmiş refresh kaydının geri gelmesi

Rotation örneği:

1. Süresi dolmamış `R1` token'ı için Redis'te aktif session anahtarı vardır.
2. Refresh Lua işlemi `R1` anahtarını siler, `R2` anahtarını ve `R1` grace tombstone'unu yazar.
3. İstemci başarılı yanıtla `R2` alır.
4. Redis rotation öncesindeki duruma döner; `R1` anahtarı tekrar vardır.
5. `R1` sahibi refresh yapar. İmza, süre, principal durumu ve DB revocation kontrolü geçerse
   Lua'daki `DEL R1` sonucu 1 olur; işlem normal rotation kabul edilir ve yeni token üretir.

Tek-session logout için aynı risk vardır: başarılı `DEL` kaybolur veya eski backup'tan geri
dönülürse session anahtarı yeniden vardır. Logout audit kaydının varlığı token kontrolünde kullanılmaz.

**Zarar:** Kullanılmış veya logout edilmiş, fakat JWT süresi dolmamış refresh token tekrar
access/refresh token üretebilir. Token'ı önceden ele geçiren kişi erişimini uzatabilir.
Rotation durumunun gerilemesi meşru istemcinin token'ını kaybedip hatalı reuse değerlendirmesi
ve beklenmedik toplu iptal gibi erişilebilirlik sorunları da doğurabilir.

DB `revocationVersion` kontrolü devam eder: token son tam iptal eşiğinin altındaysa reddedilir;
ban/silinmiş hesap kontrolleri de ortadan kalkmaz. Ancak rotation ve tek-session logout bu
eşiği artırmadığından, yalnızca bu kontroller tüketilmiş token geçmişini korumaz.

**Yalnızca version anahtarlarını DB'den yeniden kurmak refresh rotation/logout geçmişini geri getirmez.**

## 5. Çözüm seçeneği: kalıcı refresh-session otoritesi

Oturumları Redis kaybına rağmen korumak istenirse auth modülü kendi DB şemasında oturumun
güncel geçerlilik durumunu tutabilir. Örnek model (nihai şema değil):

```text
sessionId / familyId
principalId + principalType
currentRefreshJti
expiresAt
revokedAt
```

- Refresh, aktif ve süresi dolmamış session'da `currentRefreshJti = sunulan jti` koşuluyla
  atomik olarak yeni JTI'ye geçer. Aynı token'la iki isteğin yalnızca biri kazanır.
- Logout aynı session'ı DB'de iptal eder. Başarı yanıtı DB commit'inden sonra verilir.
- Refresh geçerliliği primary DB'den doğrulanır; eski Redis kaydı tek başına kabul sebebi olamaz.
- Mevcut grace/reuse ayrımı korunacaksa tüketilen JTI ve tüketilme zamanı gibi ek bilgiler gerekir.
  Birden çok hızlı rotation ve replay penceresi dikkate alınarak geçmiş/retention kapsamı seçilmelidir.

**Bütün ham token'ları veya sonsuz bir blacklist'i saklamak zorunlu değildir.** İmzalı JWT'de
aktif JTI/session durumu yeterli bir temel olabilir; opaque token seçilirse hash saklanabilir.
JWT/secret/parola log veya audit'e yazılmamalıdır.

Redis'e yazıp DB'yi sonradan outbox ile güncellemek bu garantiyi sağlamaz: cevap ile kalıcı kayıt
arasında aynı kayıp penceresi kalır. DB otoritesi seçilirse önce DB commit edilir.

Bedeli: refresh/logout için DB bağımlılığı, transaction ve cleanup ihtiyacı. Bu değişiklik
[Data & State](../../agent/data-and-state.md#data--state) içindeki “Keep sessions in Redis” kuralının bilinçli revizyonunu gerektirir.
Auth kendi session tablolarına sahip olmalı; principal tablolarına cross-module JOIN/transaction
eklenmemeli. Principal revocation okuması ile eşzamanlı refresh arasındaki semantik ayrıca tasarlanmalıdır.

Bu seçenek refresh sorununu hedefler; Redis'e bakan access guard'ın eski sürüm riskini tek başına çözmez.
DB'nin kendisinin eski backup'a dönmesi de ayrı bir güvenli kurtarma politikası gerektirir.

## 6. Access sürümleri ve güvenli kurtarma seçenekleri

### A. Yetkili DB durumunu access kontrolünde okumak

Her access kontrolünde güncel primary sürümünü kontrol etmek Redis gerilemesine bağımlılığı
kaldırabilir. Bedeli istek başına DB erişimi ve DB arızasında erişilebilirlik kaybıdır.
Modül sınırları korunmalı; core guard'a doğrudan principal tablo erişimi eklenmemelidir.
İptalle eşzamanlı başlamış/in-flight isteklerin davranışı ayrıca tanımlanmalıdır; DB okuması
tamamlanmış kontrolleri geriye dönük iptal etmez.

### B. Redis'i korumak, güvenilir kurtarma protokolü uygulamak

Veri kaybında yeniden giriş kabul ediliyorsa kalıcı refresh-session tablosu zorunlu olmayabilir.
Ancak “Redis'i temizle ve trafiği aç” yeterli değildir. Tasarım şunları kapsamalıdır:

1. Redis durumuna güvenilemeyen dönemde tüm instance'larda session kabulünü/üretimini durdurmak.
2. Kurtarma öncesinde başlamış işlemlerin eski sürüm/session yazmasını engellemek veya bunları
   geçersiz bir generation'a hapsetmek; yalnızca load balancer trafiğini kapatmak yeterli olmayabilir.
3. Eski access ve refresh token'ları güvenilir biçimde geçersizleştirmek. Redis dışında kalıcı
   bir session generation/epoch, token ve session sözleşmelerine eklenebilecek seçeneklerden biridir.
4. Primary sürümlerini ve yeni generation'ı doğrulamadan trafiği açmamak; soft-deleted principal'ların
   iptal durumunu da korumak. DB'den yeniden kurulum sırasında yeni mutasyonlarla yarışları yönetmek.
5. Instance'ların eski epoch kullanmasını önlemek; kontrol kaynağına erişilemiyorsa fail closed olmak.

Epoch bir hazır çözüm değildir: nerede tutulduğu, her istekte nasıl doğrulandığı, eski worker'ların
nasıl engellendiği ve kaybın nasıl tespit edildiği tasarlanmalıdır. Yalnızca elle backup restore
senaryosunu ele almak, otomatik failover veya kısmi veri kaybını kapsamaz.

### C. Kalıcılık ve işletim önlemleri

AOF politikası, replication/failover ayarları, kalıcı volume, session store için eviction
politikası, backup doğrulaması ve monitoring riskin olasılığını azaltır. Daha sık fsync performans
bedeli getirir. `WAIT`/replication veya AOF tek başına her arıza altında kayıpsızlık garantisi değildir.
Güvenlik gereksinimi, kabul edilebilir veri kaybı ve kurtarma süresi açıkça belirlenmelidir.

## 7. Tek başına yeterli olmayan değişiklikler

- Login'de DB'yi bir kez daha okumak: son okuma ile Redis yazımı arasında yine yarış vardır.
- TTL'yi kaldırmak: expiry'yi önlese de veri kaybını/eski backup'ı önlemez.
- Lua veya Redis kilidi eklemek: Redis'in kaybettiği geçmişi geri getirmez.
- Yalnızca version reconciliation: tüketilmiş refresh kayıtlarını veya eski rotation geçmişini bilmez.
- Yalnızca outbox: teslim edilip tamamlanmış Redis etkisi sonradan kaybolunca otomatik replay garantisi yoktur.
- Yalnızca refresh-session DB tablosu: access guard Redis'e güvenmeye devam ederse access riski kalır.

## 8. RabbitMQ outbox/inbox çalışmasına ilişkili not

Bu konu Redis geri yüklemeden ayrıdır: aynı revocation event'i tekrar işlenirse mevcut
`RevokeUserSessionsCommand` / `RevokeAdminSessionsCommand` sayaçları yeniden artırabilir.
Gecikmiş tekrar, ilk iptalden sonra açılan yeni oturumları da iptal edebilir; audit/e-posta tekrarlanabilir.

Revocation consumer'ı için `(consumer, eventId)` unique anahtarlı transactional inbox düşünülsün:

1. Consumer'ın yerel DB transaction'ında inbox kaydını eklemeyi dene.
2. Önceden commit edilmiş kayıt varsa tekrar mutasyon yapma.
3. Yeni event için inbox, aggregate mutasyonu, audit ve üretilen outbox kayıtlarını birlikte commit et.
4. RabbitMQ ACK'ini yalnızca commit sonrasında gönder. Commit sonrası ACK kaybındaki tekrar inbox'a takılır.

Event kimliği retry/replay boyunca sabit kalmalı; delivery tag kimlik değildir. Ayrı bir transaction'da
erken “işlendi” kaydı yazılmamalı. Aynı HTTP işleminin yeni eventId ile tekrar üretilmesi ayrı request
idempotency konusudur. Inbox retention desteklenen replay süresini kapsamalıdır.

Redis/e-posta DB transaction'ına dahil olmaz. Kalıcı outbox işi üzerinden ayrı yürütülmelidir.
Reconciliation güncel primary sürümünü max ile yansıttığından normal tekrarlara uygundur;
sayaç artıran revocation ile aynı idempotency özelliğine sahip değildir. E-posta sağlayıcısı
idempotency destekliyorsa kullanılmalı; desteklemiyorsa kararlaştırıldığı üzere duplicate kabul edilebilir.

Relay publisher confirms ve yönlendirilemeyen mesajların takibini; consumer commit sonrası ACK,
retry/backoff, başarısız iş takibi ve replay'i ele almalıdır. Publisher confirm consumer commit'i değildir.
Inbox/outbox başarılı uygulanmış olsa da Redis etkilerinin sonradan kaybı için bölüm 6 gereklidir.

İlgili, ayrıca ertelenmiş kod işi: post-mutation `setVersion(...).catch(() => {})` çağrıları
erişilebilirlik hatalarıyla beklenmeyen hataları ayırmıyor. Retryable event işinin başarısızlığı
korunmalı; beklenmeyen hataların sessizce yutulması ayrı düzeltilmelidir.

## 9. Uygulama öncesi kararlar ve doğrulama senaryoları

Önce karar verilecekler:

- Veri kaybında bütün oturumları kapatmak kabul ediliyor mu, oturumları korumak mı gerekiyor?
- Refresh geçerliliğinin otoritesi Redis mi, auth-owned DB durumu mu olacak?
- Access iptali için kabul edilen gecikme ve kurtarma sırasında fail-closed sınırı nedir?
- Generation/epoch, retry/replay retention ve graceful concurrent-refresh sözleşmesi nasıl olacak?

Seçilen çözüm için kontrollü entegrasyon/arıza testlerinde doğrulanacaklar (henüz çalıştırılmadı):

- DB 11 okuyan gecikmiş login, DB 12 ve Redis anahtar kaybından sonra eski erişim açamamalı.
- Redis 11'e geri yüklenirken DB 12 kaldığında eski permission/access token kabul edilmemeli.
- Başarılı rotation/logout öncesi Redis durumu geri getirildiğinde tüketilmiş token kullanılamamalı.
- Eşzamanlı refresh tek kazanan üretmeli; grace/reuse ayrımı seçilen sözleşmeye uymalı.
- Kurtarma sırasında eski worker ve farklı instance eski generation ile session oluşturamamalı.
- Aynı revocation event'i commit/ACK arızaları ve eşzamanlı teslimde bir kez mutasyon yapmalı.
- Başarılı teslim sonrası Redis etkisinin kaybı, kurtarma/rebuild prosedürüyle ele alınmalı.

## Kaynaklar

- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis replication ve WAIT sınırları](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [RabbitMQ reliability](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ acknowledgements ve publisher confirms](https://www.rabbitmq.com/docs/confirms)
