# Rate Limiting — Implementasyon Planı

Kararların tek kaynağı [hedef mimaridir](rate-limiting.md). Bu plan uygulama sırasını,
geçiş sınırlarını ve kabul ölçütlerini tanımlar; ilerleme veya test çalıştırma günlüğü değildir.
Tamamlanma koddan, doğrulama sonuçları ilgili CI/PR kanıtından değerlendirilir.

## 1. Teslim sırası ve geçiş sınırları

| Faz | Kapsam                                                         | Bağımlılık                                                               |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Ortak mekanizma ve üç IP politikası                            | Hazır counter, ayrı Redis, metadata denetimi, HTTP sözleşmesi            |
| 2   | Login ve aktivasyon yeniden gönderiminde hedef hesap limitleri | Faz 1 mekanizması; mevcut login normalizasyonu                           |
| 3   | Doğrulanmış principal limitleri ve nihai endpoint eşlemeleri   | Authentication tarafından yayınlanan, session kontrolünden geçmiş kimlik |
| 4   | Cache, session ve rate-limit Redis için birlikte observability | Yönetilen sağlayıcı metrikleri ve mevcut Grafana Cloud altyapısı         |

Her faz uygulama, wiring, endpoint metadata'sı ve ilgili sözleşmeleri birlikte teslim eder.
Çalışan bir faz, sonraki fazın boş config'ine veya henüz bulunmayan resolver'ına dayanamaz.
Yeni tracker aynı mekanizmaya eklenir; guard içinde endpoint/policy adına göre dallanma yapılmaz.

Geçişte yalnız tamamlanmış politikalar kataloğa eklenir. Faz 1'de `default`, `refresh-token`
ve `user-registration-admin-user-activation` uygulanır. Login ve aktivasyon yeniden gönderimi
faz 2'ye; parola/email initiate, admin davet ve avatar initiate faz 3'e kadar **açıkça**
`default` seçer. Bu geçiş nihai koruma düzeyi veya eksik metadata için fallback değildir.
Özel politika eklenirken bütün limiter'ları ve endpoint eşlemeleri birlikte değiştirilir;
boş/kısmi politika, sessiz atlama veya geçici muafiyet kullanılmaz.

## 2. Faz 1 — ortak mekanizma ve IP politikaları

### Uygulama sınırları

- Resmî `@nestjs/throttler` storage sözleşmesi ve seçilen topluluk Redis adapter'ının hazır
  Sliding Window Counter algoritması kullanılır. Paket davranışı yayımlanmış sürümden
  doğrulanır; özel sayaç/Lua algoritması veya `@nestjs-redis/client` eklenmez.
- Rate-limit concern'ü bağlantı yaşam döngüsünü sahiplenir; ortak Redis factory/classifier
  sürücüye özgüdür. Cache/session ioredis istemcileri değiştirilmez. Runtime bağlantı kesintisi
  startup/shutdown'u kilitlememeli; offline Swagger üretimi canlı Redis gerektirmemeli.
- Her HTTP handler açık politika veya probe muafiyeti seçer; fixture'lar da buna dahildir.
  Sınıf seviyesinde bildirim, eksik/çelişen metadata, boş politika, eksik resolver ve
  geçersiz sayısal bütçe başlangıçta reddedilir. Bir aşamada limiter olmaması muafiyet değildir.
- Politikanın sıralı limiter tanımları, tracker kaynağı, aşaması ve sayıları tek typed TS
  katalogda tutulur. JSON, politika başına env veya endpoint üzerinde sayı kullanılmaz.
- Key kapsamı ve tam IP normalizasyonu mimari §6'ya uyar. Framework'ün route içeren key'i,
  IPv6 `/64` gruplaması, otomatik limiter sıralaması ve isimli header'ları devralınmaz.
- Global sıra: pre-auth rate limit → authentication → post-auth rate limit → authorization.
  `@Public()` rate-limit muafiyeti sağlamaz; limiter credential doğrulamaz veya audit aktörü yayınlamaz.
- Sayaçlar sıralı çalışır; ilk ret/hata sonrası devam edilmez, önceki sayımlar geri alınmaz.
  Süre sınırı her tam storage increment işleminin bekleyişine uygulanır; script yükleme ve
  yürütme aynı süreyi paylaşır. Ortak aşama deadline'ı yoktur. Timeout paket işlemini iptal
  etmez; geç komut/mutation mümkündür. Sonucu belirsiz işlem yeniden gönderilmez;
  çalışmadığı bilinen `NOSCRIPT` fallback'i paket tarafından yönetilir.
- Redis kesintisi/timeout/bilinen OOM 503; gerçek limit ihlali 429 üretir. Diğer hatalar
  genel 503'e çevrilmez. İlk bloktan alınan standart `Retry-After` zorunludur; diğer
  limiter'ların durumunu veya bekleme sonunda kabul garantisini açıklamaz.
- Live/ready sayaç tüketmez; detaylı health `default` kullanır. Mevcut probe yanıtları,
  hata `no-store` ve HTTP access logları korunur. Teknik ret için ek log/audit üretilmez.

### Kabul ölçütleri

- Aynı IP/policy farklı endpoint ve uygulama bağlantılarında ortak bütçe kullanır;
  farklı IP/policy ayrışır. İki pencere, ilk ret, geri almama ve değişmeyen blok bitişi doğrulanır.
- Eşdeğer IPv4/mapped IPv6 normalize olur; farklı tam IPv6 adresleri ayrı kalır.
  Güvenilmeyen forwarded header bütçeyi değiştiremez; güvenilen proxy yolu gerçek IP'yi ayırır.
- Pre-auth ret authentication/handler'ı çalıştırmaz; authentication hatasıyla karşılaşan
  isteğin daha önce tükettiği sayaç korunur. 429 gövdesi/header'ı hassas limiter bilgisi içermez.
- Hazır olmayan Redis, gecikmiş yanıt ve bilinen kapasite reddi fail-closed davranır;
  ACL/auth/Lua gibi beklenmeyen hatalar korunur. Timeout sonrasında geç mutation ihtimali
  gerçek Redis ile sınanır; yalnız yanıt süresini ölçmek iptal güvencesi sayılmaz.
- Atomik eşzamanlı tüketim, TTL temizliği, script-cache kaybı sonrası toparlanma ve uyumlu
  limit/blok süresi değişikliklerinin state'i koruması gerçek Redis ile doğrulanır.
- Persistence/restart/failover ve yük/bellek kabulü ayrı kanıt ister. Persistence açılmamış
  workflow servisiyle geçen E2E, Compose AOF recovery veya production kapasite kanıtı değildir.
- Build, offline Swagger/SDK ve HTTP sözleşmesi birlikte değerlendirilir. Kimliksiz contract
  fuzzing, authentication arkasındaki başarılı iş akışlarının veya bütün response schema'larının kanıtı değildir.

## 3. Faz 2 — hedef hesap politikaları

- `user-login`, `admin-login`, `user-activation-resend` politikaları mimari §4'teki bütçelerle
  eklenir; her biri IP kısa → IP uzun → hesap kısa → hesap uzun sırasını uygular.
- Guard pipes'tan önce çalışır: yapılandırılmış email alanını raw body'den güvenle çıkarır.
  Normalizasyon login/lookup ile aynı olmalı; bağımsız lowercase veya sağlayıcıya özgü alias
  kuralı eklenmez. Core, module DTO/domain tipine bağımlı olmaz.
- Eksik/uygunsuz email, sıra hesap limiter'ına geldiğinde 400 üretir; sayaç atlanmaz,
  IP'ye düşülmez ve ortak boş key üretilmez. Önce IP reddederse 429 geçerlidir.
  Diğer payload alanları normal pipes akışında doğrulanır.
- Normalize email SHA-256 hex ile kodlanır; HMAC, secret veya hesap varlığı sorgusu yoktur.
  Hash anonimlik garantisi değildir. Başarı sayacı sıfırlamaz; sayılan teslim edilen email
  veya başarısız parola değil, ilgili limiter'a ulaşan istektir.

Kabul: aynı email farklı IP'lerden hesap bütçesini; aynı IP farklı email'lerle IP bütçesini
paylaşır. Bilinmeyen hesap aynı sınıra tabidir. Login ve resend politikaları ayrışır;
anti-enumeration yanıtı ve mevcut workflow audit'i korunur. Her kısa/uzun sınır, eksik alan,
ilk ret ve yasaklanan sonraki etkiler doğrulanır.

## 4. Faz 3 — doğrulanmış principal ve nihai kapsam

- `password-change-email-change-initiate`, `admin-invitation`, `avatar-upload-initiate`
  politikaları mimari §4'teki endpoint ve bütçelerle eklenir. Ek IP/default limiti konmaz.
- Tracker yalnız authentication'ın session kontrolünden sonra yayınladığı principal ID'dir;
  raw token, body/param ID'si veya davet hedefi değildir. Principal türü rate-limit key'ine
  eklenmez; auth/session/audit kimlik kuralları değiştirilmez.
- Public endpoint ile principal politikası eşleşmesi startup'ta reddedilir. Başarılı
  authentication sonrası gerekli principal yokluğu system fault'tur. Authentication reddi
  post-auth sayacı tüketmez; sonraki authorization/handler reddi tüketimi geri almaz.

Kabul: aynı principal farklı IP'lerle aynı bütçeyi paylaşır; farklı principal'lar ayrışır.
Parola/email initiate aynı bütçeyi, davet/re-invite çağıran admin bütçesini paylaşır.
Email confirm, logout/logout-all ve `PATCH me` default'ta kalır; doğrudan storage upload
API sayacı tüketmez. Nihai envanter mimarideki dokuz politika/24 limiter ve probe
muafiyetleriyle karşılaştırılır; özel gruplarda geçici default eşlemesi bırakılmaz.

## 5. Faz 4 — üç Redis için observability

Cache, session ve rate-limit birlikte ele alınır. Mimari §11'deki sinyal ve başlangıç eşikleri
mevcut Grafana Cloud yaklaşımına bağlanır; sağlayıcının sunmadığı metrik veya production
container exporter erişimi varsayılmaz. Önceki fazlara kullanılmayan metric port/exporter eklenmez.

- İlk ret için bir request sonucu sayılır; aynı ret her limiter için tekrar artırılmaz.
  Tam blok başlangıcı sayımı vaat edilmez; tracker/key/request kimlikleri metric label'ı olmaz.
- Connection geçiş logları korunur; teknik ret için ek request logu veya audit eklenmez.
  Provider sinyali ile uygulamanın bağımlılığa erişebilmesi aynı güvence sayılmaz.
- Cache'in normal eviction'ı tek başına alarm değildir; eşikler trafikle doğrulanır.
  Kalıcılık alarmı yalnız desteklenen/etkin kalıcılık için kurulur; No Data sağlıklı sayılmaz.

Kabul: kapasite, erişilemezlik, veri kesilmesi, geçerli kalıcılık hatası ve recovery kontrollü
fault injection ile doğrulanır; servisler ayrışır ve aynı ret çift sayılmaz. Gerçek AWS
kaynaklarına işlem yapmak yerine önce review edilebilir deployment konfigürasyonu hazırlanır.

## 6. Deployment ve geri dönüş

- Web/mobile ingress zinciri ve yönetilen sağlayıcı uyumluluğu deployment kabulünün parçasıdır
  (mimari §2, §7, §12). Yerel test AWS kabulü değildir. AOF everysec, replica freshness veya
  sabit bir saniyelik failover kaybı garantisi vermez; session recovery güvenliği ayrı değerlendirilir.
- Geçişte uyumsuz eski/yeni policy/config'ler birlikte trafik almamalıdır. Limit-only değişim
  count'u, blok süresi değişimi aktif bloğun bitişini korur. Pencere/tracker anlamı değişirse
  yeni limiter kimliği gerekir; sürüm alanı, conversion veya toplu reset eklenmez.
- Default'tan özel politikaya geçiş yeni bütçe açar; default state silinmez. Eski key'ler
  doğal TTL ile temizlenir. Rollback kod ve metadata/config'i birlikte geri alır; yeni
  politikaların korumasını sürdüreceği veya başlamış mutation'ı geri alacağı varsayılmaz.

## 7. Doğrulama yöntemi

Test yetkisi, yerleşimi, workflow bağımlılıkları ve bütçe izolasyonu
[proje rehberine](../../AGENTS.md) ve [test kurallarına](../../agent/testing.md) tabidir.

Fazların kabulünde özellikle ilk ret sonrası yasaklanan etkiler ile gerçek Redis
atomiklik/state/TTL ve arıza davranışı ayrıştırılır. Saatlerce production pencere süresi
beklemek yerine kontrollü bütçe/TTL kullanılır. Çalıştırılan kontroller, kapsam sınırları
ve yapılmayan kabul işleri CI/PR kanıtında belirtilir; sayısal test sonuçları bu plana kopyalanmaz.
