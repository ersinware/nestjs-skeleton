# Rate Limiting — Hedef Mimari

> **Durum: implementasyon YOK.** Projede rate limiting'e dair hiçbir kod bulunmuyor. Önceki
> implementasyon, mimarisi yeniden tasarlanacağı için bilinçli olarak tamamen kaldırıldı. Bu belge o
> yeniden yapımın tasarım girdisidir: neyin, hangi sırayla, hangi gerekçeyle kurulacağını anlatır.
>
> ⚠️ **Buradaki kararlar üzerinde tam mutabakat sağlanmış değildir.** Her biri gerekçesiyle birlikte
> yazılmıştır ama hiçbiri kesinleşmiş sayılmaz; uygulamaya geçilmeden önce yeniden gözden geçirilmeli
> ve gerekirse mimari güncellenmelidir. Belge bir "karar kaydı" değil, tartışmanın bugünkü halidir.

---

## 1. Bu katman neyi çözer, neyi çözmez

Rate limiting **tek bir soruya** cevap verir: _"Bu çağıran, bu işlemi bu sıklıkta yapmaya hakkı var
mı?"_ Amacı tahmin etmeyi (parola, token, kod) ve kaynak tüketmeyi **pahalı hale getirmektir**.

**Çözmez:**

- **Hacimsel DDoS.** Trafiğin uygulamaya ulaşması bile istenmiyorsa çözüm CDN/WAF katmanındadır.
  Uygulama katmanı bir isteği reddetmek için önce onu kabul etmek zorundadır.
- **Bot yönetimi / fingerprinting.** Bu ayrı bir ürün alanıdır.
- **Yetkilendirme.** Rate limiting "kaç kez" sorusunu cevaplar, "kim ve neye yetkili" sorusunu değil.

Bu ayrım önemli çünkü limitleri belirlerken referans noktası bu: limit, **gerçek kullanıcının doğal
ritmini** taşıyacak kadar geniş, **saldırının işine yaramayacak** kadar dar olmalıdır. Bunun ikisini
birden yapamayan bir sayı yanlış eksende seçilmiştir.

---

## 2. Önkoşul: "çağıran kim?" sorusunun güvenilir cevabı

Rate limiting'in tamamı bu cevabın üzerine kuruludur. Cevap yanlışsa, üstündeki her sayı anlamsızdır.

Bu API'nin önünde sunucu tarafı bir BFF var:

```
Tarayıcı → CDN / LB → Next.js BFF (sunucu tarafı) → LB → BU API
```

Sonucu belirleyici: **bu API'nin TCP karşı tarafı her zaman bir BFF pod'udur, hiçbir zaman kullanıcı
değildir.** Hiçbir şey yapılmazsa tüm kullanıcı tabanı, BFF pod sayısı kadar kovaya çöker.

İki koşul sağlanmalı ve **ikisi de bu repodan zorlanamaz**:

1. **BFF, tarayıcının adresini iletmeli.** Next.js route handler'ından atılan `fetch()` kendiliğinden
   `X-Forwarded-For` göndermez; header açıkça set edilmelidir.
2. **`TRUST_PROXY` topolojiyi tarif etmeli.** _(Bu kısım halihazırda mevcut ve rate limiting'den
   bağımsızdır — silinmedi.)_

`TRUST_PROXY` bugün yalnızca `false` ya da **IP/CIDR listesi** kabul ediyor; `true` ve **hop sayısı**
boot'ta reddediliyor. Gerekçe: hop sayısı _konumsaldır_ — zincire bir proxy eklendiğinde sessizce
yanlış adresi okumaya başlar, hata vermez. CIDR listesi ise "hangi ağ bizim" der; iç bir hop eklense
de çıkarılsa da doğru kalır.

> **Sessiz başarısızlık uyarısı.** BFF header'ı iletmezse rate limiting "çalışıyor" görünür ama herkesi
> birkaç pod IP'sine anahtarlar. Hata da log da üretmez. Bu yüzden **her deploy'dan sonra doğrulanması
> gereken bir şeydir**, varsayılacak bir şey değil.

---

## 3. Kimlik ekseni (tracker) — mimarinin merkezi kararı

"Kova anahtarı ne olacak?" sorusu, bu mimarideki en belirleyici karardır. IP tek başına kimliğin
zayıf bir vekilidir ve **iki yönde birden** bozulur:

- Kurumsal NAT / CGNAT / mobil operatör arkasında: **bir IP = yüzlerce kullanıcı**, hepsi tek bütçeyi
  paylaşır. Limiti sıkmak gerçek kullanıcıyı cezalandırır.
- IPv6 / mobil / VPN: **bir kullanıcı = onlarca IP**. Saldırgan adres değiştirmenin bedelini ödemez.

**Önerilen: üç eksenli tracker, isteğin ne olduğuna göre seçilir.**

| Eksen      | Ne zaman                                              | Anahtar                            | Neden                                                                                   |
| ---------- | ----------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| **Kimlik** | Doğrulanmış istek                                     | `user:<sub>`                       | NAT'tan etkilenmez, IP rotasyonundan etkilenmez. Gerçek kullanıcı başına bir bütçe.     |
| **Hesap**  | Kimlik doğrulama denemeleri (login, parola sıfırlama) | `account:<hash(normalize(email))>` | Dağıtık saldırıda tek savunma budur: botnet IP değiştirir ama **hedef hesap sabittir**. |
| **Adres**  | Anonim istek                                          | `ip:<request.ip>`                  | Elde başka bir şey yokken kalan tek eksen.                                              |

Üçü birbirinin alternatifi değil, **farklı saldırılara cevap veren farklı eksenlerdir**. Bir login
isteği aynı anda hem hesap hem adres ekseninde sayılabilir.

**Kritik alt karar — guard sırası.** Kimlik eksenini kullanabilmek için, rate limit kararı verilirken
`sub`'ın biliniyor olması gerekir. İki yol var:

- **(Önerilen) Rate limit guard'ı `AuthGuard`'dan önce kalsın, kimliği kendisi çözsün** — token'ın
  yalnızca **imzasını doğrulayarak**. HS256 doğrulaması ucuzdur, DB/Redis'e gitmez. Böylece kimliksiz
  bir sel, oturum doğrulamasının maliyetine ulaşmadan durur.
- Rate limit guard'ı `AuthGuard`'dan sonraya alınsın. Basittir ama **kimliği doğrulanmamış bir sel,
  rate limit'e takılmadan önce Redis'e ulaşır** — bu bir amplifikasyon vektörüdür.

> **Asla:** token'ı doğrulamadan sadece decode edip `sub`'ı okumak. İmzasız bir token'la saldırgan
> istediği kadar yeni kova üretir — `X-Forwarded-For` açığının elle yeniden inşa edilmiş hali.

---

## 4. Politika kataloğu — endpoint sayı bilmez, isim bilir

Endpoint'ler **sayı** taşımamalı, **politika adı** taşımalıdır. Sayılar tek bir yerde, konfigürasyonda
yaşar.

```
Endpoint  ──seçer──▶  Politika  ──oluşur──▶  bir veya birden fazla limiter
                                              (her limiter: pencere + limit + blok süresi)
```

Başlangıç kataloğu (isimler örnektir, kesin değildir):

| Politika          | Nerede                                    | Neden ayrı                                                                               |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DEFAULT`         | İşaretlenmemiş her endpoint               | Kötüye kullanımı yumuşatır. **Güvenlik kontrolü değildir**, o yüzden cömerttir.          |
| `AUTH`            | Kullanıcı girişi                          | Tahmin edilebilir sır doğrular.                                                          |
| `ADMIN_AUTH`      | Admin girişi                              | Çok az kişi kullanır, çok yüksek değerdedir — herkesten sıkı olmalı.                     |
| `REGISTRATION`    | Kayıt                                     | Kişi başına ömürde bir kez. Kısa pencere yanlış eksen; uzun pencere + düşük tavan doğru. |
| `SENSITIVE_WRITE` | Parola değiştirme, e-posta değiştirme vb. | Mevcut sırrı doğrular veya hesabı devreder.                                              |

**Politika ekleme maliyeti sıfıra yakın olmalı:** yeni bir enum üyesi + limiter tanımı. Guard'a
dokunmak gerekiyorsa mekanizma yanlış kurulmuş demektir. Bir politikanın limiter eşlemesi
**exhaustive** olmalı, yani yeni bir politika eklenip enforce edilmeyi unutulduğunda **derleme
hatası** vermeli.

**Ne zaman kritik sayılır?** Kural: _endpoint **tahmin edilebilir bir sır** doğruluyorsa kritiktir._

- Login, parola değiştirme → **evet** (parola tahmin edilebilir).
- Token yenileme (`refresh`) → **hayır**. Sunulan şey **imzalı bir token**, tahmin edilecek bir şey
  yok; asıl savunma tek kullanımlık rotasyon + reuse tespitidir. Üstelik bu, uygulamanın kullanıcı
  istemeden çağırdığı tek uçtur (açılış, token süresi dolması, sekme odağı) — trafiği patlamalı gelir
  ve paylaşımlı bir IP bütçesi meşru oturumlara 429 döndürür. Çoğu istemci bunu "oturum kapandı"
  diye okur; sonuç kitlesel logout olur.

---

## 5. Çift pencere: patlama + sürdürülen

Tek pencere iki saldırı şeklinden yalnızca birini görür.

| Saldırı                            | İhtiyacı                   | Tek kısa pencere ne yapar                                                                    |
| ---------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| Hızlı otomatik patlama (saniyeler) | Kısa pencere, sıkı limit   | Yakalar                                                                                      |
| Yavaş, sürdürülen tahmin (saatler) | Uzun pencere, toplam tavan | **Göremez** — pencere sürekli sıfırlanır, "kendini yavaşlat, görünmez ol" boşluğu açık kalır |

Bu yüzden hassas politikalar **en az iki limiter** taşımalı ve geçmek için **hepsini birden** sağlamak
gerekmelidir: kısa pencere ani patlamayı keser, uzun pencere toplam denemeye tavan koyar. Uzun
pencerenin tavanı bilinçli olarak cömert seçilir — gerçek bir kullanıcının ya da paylaşımlı bir ofisin
üreteceğinin çok üstünde, bir saldırının ihtiyaç duyduğunun çok altında.

**Blok süresi açıkça belirtilmeli.** Belirtilmezse pencere süresine eşitlenir; bu da "limiti aşmanın
bedeli, zaten dolmak üzere olan pencerenin kalanı" demektir — yani bedel yok.

**Blok süresi ne kadar olmalı?** Bu, doğrudan **tracker eksenine** bağlıdır:

- Tracker **IP** ise uzun blok kötü bir takastır: saldırgan adres değiştirir (bedava), aynı NAT'ı
  paylaşan herkes birlikte kilitlenir.
- Tracker **kimlik** veya **hesap** ise uzun blok anlamlı hale gelir.

---

## 6. Anahtar şeması

Anahtar üç parçadan oluşmalı: **`<önek>:<politika>:<tracker>`**

- **Önek** — throttle sayaçlarını başka hiçbir şeyle karıştırmamak için (bkz. §7).
- **Politika** — bütçeler politika düzeyinde ayrılır.
- **Tracker** — §3'teki eksen.

**Route/handler adı anahtara girmemeli.** Girerse her endpoint kendi bütçesini alır ve saldırgan
uçlar arasında dolaşarak toplam bütçeyi çarpar: `login` + `admin login` + `register` üç ayrı bütçe
demektir. Politika düzeyinde tek bir tavan, "kimlik doğrulama yüzeyinin tamamı" için anlamlı bir
sınır üretir.

Karşı argüman: route bazlı izolasyon, bir ucun yoğun trafiği yüzünden başka bir ucun kilitlenmesini
engeller. Bu yüzden ayrım **politika düzeyinde** yapılır — farklı ritimdeki uçlar farklı politikalara
konur, aynı politikadaki uçlar ise zaten bilerek aynı bütçeyi paylaşır.

---

## 7. Depolama ve dayanıklılık

**Redis, ayrı bir anahtar uzayında.** Sayaçlar cache ile aynı keyspace'i paylaşmamalı: aksi halde bir
cache flush'ı tüm rate limit sayaçlarını sıfırlar — yani cache temizliği bir güvenlik kontrolünü
kapatır. Ayrı bir key prefix'i (veya ayrı DB index'i) şart. Bunun için ikinci bir bağlantı gerekiyorsa,
o bağlantının kopma/dönme geçişleri de birincisiyle **aynı loglama muamelesini** görmeli.

**Pencere tipi: sabit pencere kabul, sliding değil.** Sabit pencere, sınırda 2× patlamaya izin verir
(pencerenin sonunda bütçeyi harca, devrilir devrilmez tekrar harca). Sliding window bunu kapatır ama
tracker başına sıralı bir yapı (sorted set) maliyeti getirir. Karar: **sabit pencere kullanılır ve bu
2× payı limit seçilirken hesaba katılır.** Sliding window'a geçiş, ancak sınır patlaması gerçek bir
sorun haline gelirse gündeme alınır.

**Kesinti davranışı — tek bir "fail-open" cevabı yeterli değil:**

| Politika           | Redis yokken                      | Gerekçe                                                                                                                                                                   |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT`          | **Fail-open** (geç)               | Bu bir güvenlik kontrolü değil; bir cache kesintisi uygulamayı yere sermemeli.                                                                                            |
| Hassas politikalar | **Süreç-içi bellek sayacına düş** | Kusurludur (etkin limit instance sayısıyla çarpılır) ama "koruma tamamen yok"tan çok daha iyidir. Bir Redis kesintisi, brute-force penceresini açan bir olay olmamalıdır. |

**Fail-open dar tutulmalı.** Yalnızca _depolama_ hatasını yutmalı, "guard içinde ne olursa olsun geç"
anlamına gelmemeli. Aksi halde alakasız bir hata (örneğin bir audit yazımı) sessizce rate limit
bypass'ına dönüşür — sebeple sonucun ters orantılı olduğu bir hata sınıfı.

---

## 8. İstek akışı, adım adım

```
1. İstek gelir
   └─ Fastify onRequest hook: audit context açılır (sourceIp, userAgent, method, route)
      · sourceIp, TRUST_PROXY'ye göre çözülmüş adrestir  → §2

2. Rate limit guard çalışır (AuthGuard'dan ÖNCE)
   ├─ a) Politika çözülür: endpoint'teki dekoratör → yoksa DEFAULT
   ├─ b) Tracker çözülür: token imzası geçerliyse user:<sub>, değilse ip:<addr>  → §3
   ├─ c) Politikanın her limiter'ı için sayaç artırılır ve limit kontrol edilir  → §5
   └─ d) Sonuç:
        ├─ Hepsi limit içinde  → devam
        └─ Herhangi biri aşıldı → 429 + Retry-After            → §9

3. AuthGuard çalışır
   └─ token DOĞRULANIR → actor audit context'e yayınlanır

4. AuthRolesGuard → rol kontrolü
5. Pipe / handler
```

Sıralamanın gerekçesi: **en ucuz reddetme en önde.** Rate limit kararı bir sayaç artırımıdır; oturum
doğrulaması ise Redis okumasıdır. Pahalı olanı öne almak, saldırganın bedelini bize ödetir.

---

## 9. İhlal akışı

**İstemciye ne döner:**

- **429** ve **`Retry-After`** header'ı. Bu header opsiyonel bir nezaket değil: onsuz istemci ne zaman
  tekrar deneyeceğini bilemez ve genellikle hemen tekrar dener — yani blok, ürettiği yükü azaltmaz.
- Gövde, projenin standart hata şeklini (`ErrorDefaultDto`) izlemeli.
- **Hangi limiter'ın tetiklendiği açıklanmamalı.** "Bu hesaba özel limit aşıldı" demek, hesabın var
  olduğunu doğrular (kullanıcı numaralandırma).

**Ne kaydedilir — bir bloka bir kayıt, isteğe değil.** Bir blok, **tek bir karardır** ama binlerce
isteği reddeder. 60 saniyelik bir blok, saniyede 100 istek altında altı bin audit kaydı üretir. Audit
deposu log seviyesinden muaftır, politikayla saklanır ve ileride bir tabloya dönüşecektir — yani
istek başına kayıt, herhangi bir anonim çağıranın çekebileceği bir **yazma amplifikasyonu** kolu olur.

Bu yüzden kayıt, **limiti aşan ilk istekte** ve **yalnızca rate limit bileşeninin kendisi tarafından**
yazılmalıdır: bloka _sebep olan_ isteği, arkasında yakalananlardan ayırt edebilen tek yer orasıdır.
Global exception filter'ın 429'u kaydetmesi yanlıştır — filter her reddi görür, sadece ilkini değil.

Kayda ayrıca **fazladan kimlik alanı geçilmemelidir**: adres, user agent, method ve route zaten ortam
context'inden gelir. Bir rate limit reddi bunun ötesinde bir şey tespit etmez.

**Metrik ayrı bir iştir.** "Kaç blok oldu, hangi politikada" sorusu audit'in değil, metriklerin
sorusudur; alarm oradan kurulur.

---

## 10. Hesap düzeyi savunma — throttle katmanının bittiği yer

Rate limiting **hız** ölçer. Kimlik doğrulama saldırılarının bir kısmı hızlı değildir.

Dağıtık credential stuffing bunun tipik örneğidir: 1000 IP'lik bir botnet, her IP'den dakikada 10
deneme yaparsa hiçbir IP limiti aşılmaz — ama dakikada 10.000 deneme yapılmış olur. Bunu **hesap
ekseni** (§3) kısmen yakalar; geri kalanı throttle katmanının işi değildir:

| Katman       | Sorumluluk                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Throttle** | Hız. `account:<hash(email)>` ekseninde bir limiter.                                                                                                                  |
| **Domain**   | Başarısız deneme sayacı, kademeli gecikme, risk sinyali (görülmemiş IP/cihaz), gerekirse CAPTCHA eşiği. Bu bir **iş kuralıdır** ve login use case'inin içinde yaşar. |

> **Tuzak:** düz bir hesap kilitleme, saldırgana bir DoS aracı verir — herhangi biri, herhangi bir
> hesabın e-postasına yanlış parola göndererek o hesabı kilitleyebilir. Kademeli gecikme + risk
> sinyali daha güvenli şekildir. Bu, tasarım gerektiren bir iştir; hızlı bir ekleme değildir.

---

## 11. Gözlemlenebilirlik

Projenin genel kuralları burada da aynen geçerlidir; rate limiting'e özel ayrımlar şunlar:

| Sinyal     | Ne için                                        | Kural                                                                                                                                       |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit**  | Kanıt: kim, ne zaman, nereden bloklandı        | Blok başına **bir** kayıt (§9). Blok başlangıcında, rate limit bileşeninin kendisi tarafından.                                              |
| **Metrik** | Alarm ve trend: blok sayısı, politika kırılımı | Alarmın kaynağı budur, audit değil.                                                                                                         |
| **Log**    | Teşhis                                         | Reddedilen istek başına log **yazılmaz**. Kesinti gibi durumlarda kayıt, bağlantı düzeyinde ve durum-geçişine bağlı olarak bir kez tutulur. |

---

## 12. Uygulama sırası

Her adım bir öncekini varsayar; sıra atlanmamalıdır.

| #   | Adım                                                                                                                       | Neden burada                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **BFF'in `X-Forwarded-For` ilettiğini doğrula, ortam başına `TRUST_PROXY` CIDR'larını belirle**                            | Koddan önce gelir. Bu yanlışsa üstündeki hiçbir şeyin anlamı yok (§2). Kod değil, deploy işi.                                                                                                                  |
| 1   | **İskelet:** rate limit concern'ü, port + adapter + global guard, politika dekoratörü, boş katalog                         | Üstüne her şeyin bineceği yapı.                                                                                                                                                                                |
| 2   | **`DEFAULT` politikası**, tek pencere, IP ekseni, Redis'te **ayrı anahtar uzayı** (§7)                                     | En basit dikey kesit; uçtan uca çalıştığını burada görürüz.                                                                                                                                                    |
| 3   | **429 için Swagger dekoratörü** (`ApiDefaultTooManyRequestsResponse` benzeri) + `Retry-After`                              | 429 üreten ilk endpoint ile birlikte **aynı anda** yazılmalı. Silme sırasında bu dekoratör de kaldırıldı; ölü kod bırakmamak için. Dokümante edilmemiş bir hata durumu, istemci için var olmayan bir durumdur. |
| 4   | **Çift pencere** (patlama + sürdürülen) ve **hassas politikalar**: `AUTH`, `ADMIN_AUTH`, `REGISTRATION`, `SENSITIVE_WRITE` | Mekanizma ayakta olduğu için bu sadece katalog genişletmesidir.                                                                                                                                                |
| 5   | **Kimlik ekseni** (`user:<sub>`) + guard sırası kararının uygulanması (§3)                                                 | Buraya kadar her limit IP eksenindedir; asıl kaliteyi bu adım getirir.                                                                                                                                         |
| 6   | **Hassas politikalar için kesinti degradasyonu** (bellek sayacına düşüş, §7)                                               | Fail-open davranışı netleştikten sonra anlamlı.                                                                                                                                                                |
| 7   | **Hesap ekseni** (`account:<hash(email)>`) + domain katmanı kademeli gecikme (§10)                                         | Tasarım gerektirir; en sona bırakılır.                                                                                                                                                                         |
| 8   | **E2E doğrulama:** audit context'inin handler'a kadar taşındığı, `Retry-After`'ın döndüğü, blok başına tek kayıt yazıldığı | Davranışı sabitler.                                                                                                                                                                                            |

---

## 13. Yeniden yaparken atlanmaması gereken tuzaklar

Önceki implementasyonda bedeli ödenmiş, tekrar edilmemesi gereken hatalar:

- **Süre birimi.** Kütüphanenin beklediği birim ne ise, JSDoc ve `.env` yorumu **aynı birimi** yazmalı.
  Saniye sanılan bir milisaniye değeri, rate limiting'i **hata vermeden** devre dışı bırakır. Yanlış
  yönde sessiz olan her varsayılan böyle yazılmalı.
- **`X-Forwarded-For` güveni.** "Her hop'a güven" ayarı, çağıranın kendi IP'sini seçmesine — yani kendi
  rate limit kovasını seçmesine — izin verir. Aynı değer audit kaydındaki `sourceIp`'yi de besler.
- **Boolean dekoratör.** "Kritik mi?" diye bir bayrak taşıyan dekoratör, ikinci bir politika
  gerektiğinde çöker. Baştan **politika adı** taşımalı.
- **Framework guard'ından türetme.** Bir framework sınıfını extend edip alt sınıfa `@Inject` eklemek,
  temel sınıfın bağımlılık metadata'sını **gölgeler** (genişletmez) — temel sınıfın injectlerini de
  yeniden bildirmek gerekir, yoksa uygulama boot'ta patlar.
- **Reddi her katmanda kaydetmek.** Kaydı yazacak tek yer, olguyu _tespit eden_ yerdir. Filter her
  429'u görür; ilkini ayırt edemez.
- **Sağlık uçları.** Liveness/readiness probe'ları rate limit'e takılmamalı — bir load balancer'ın
  sağlık kontrolü 429 alırsa instance sağlıksız sayılır ve kesinti kendi kendini büyütür.
