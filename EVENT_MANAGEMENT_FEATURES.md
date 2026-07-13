# Event Yönetimi — Özellik Notu (API Gözünden)

> Bu, ileride yazılacak **ops / event-management** modülü için ihtiyaç duyulan yetenekleri, onları
> tüketen operatör gözünden anlatan bir özellik listesidir. Silinen eski `ops` modülü buradaki
> maddelerin bir kısmını (health, listeleme, retry, delete) zaten karşılıyordu; yeniden yazarken bu
> listeyi bir kontrol listesi olarak kullan.

> ⚠️ **Kapsam: bu proje sadece backend/API.** Burada tarif edilen her şey **API endpoint'i** olarak
> teslim edilir — UI, ekran, buton, renk, grafik, banner **bu projenin işi değildir**. "Operatör şunu
> görmeli / yapabilmeli" ifadelerini "API bunu sağlayan bir endpoint sunmalı" diye oku. Sunum tamamen
> ayrı bir frontend'in sorumluluğu; bizim işimiz **doğru veriyi ve aksiyonu** JSON olarak açmak.

> 📌 **Şema notu (ops silinince yapıldı):** Sadece ops'un okuduğu için `outbox` ve `notification`
> tablolarından **`attempts`** ve **`lastError`** kolonları; hiç yazılmayan **`traceId`** kolonu da
> kaldırıldı. Bu modülü yazarken **`attempts` ve `lastError` kolonlarını geri eklemen** (ve `markDead`'in
> yeniden `error` alması, claim'de `attempts++`) gerekecek — aşağıdaki "deneme sayısı" ve `lastError`
> maddeleri bunu varsayar.

## Kim tüketir?

- **Super Admin** — sistemin arka plandaki mesajlaşma sağlığını (outbox + email/notification) izleyen ve
  takılan işleri kurtaran kişi (bir panel/istemci üzerinden bu API'yi çağırır). Endpoint'ler yalnızca
  Super Admin'e açık; sıradan admin/user erişememeli.

## Neyi yönetiyoruz?

Sistemde iki tane "güvenilir mesajlaşma defteri" (ledger) var, API ikisini de yönetebilmeli:

1. **Outbox** — domain event'lerin dış dünyaya/diğer modüllere güvenli yayılması.
2. **Notification (email)** — kullanıcılara giden e-postaların dayanıklı kuyruğu.

Her ikisinde de bir satırın yaşam döngüsü aynı mantıkta: `PENDING → PROCESSING → PUBLISHED/SENT`
(başarı) veya tüm denemeler tükenince `DEAD` (ölü mektup / dead-letter).

---

## 1. Sağlık / Özet Endpoint'i

Tek çağrıyla "her şey yolunda mı?"yı özetleyen bir health endpoint'i.

- Her iki ledger için **durum bazlı sayaçlar** döndür: kaç tane `PENDING`, `PROCESSING`, `DEAD`.
- `DEAD` sayısı yanıtta ayrı bir alan olarak net dursun (istemci vurgulamayı kendi yapar) — asıl aksiyon
  gerektiren metrik bu.
- **Backlog sinyali**: `PENDING` sayısı yanıtta bulunmalı ki istemci "relay yetişemiyor" durumunu
  algılayabilsin.
- Hafif ve hızlı olmalı (yalnızca `COUNT`); istemci kısa aralıklarla polling yapabilir.
- İsteğe bağlı: trend gösterimi gerekiyorsa zaman-serisi zaten Prometheus/Grafana'da; bu endpoint anlık
  sayaç döndürmekle yetinir.

## 2. Listeleme Endpoint'i

- **Duruma göre filtreleme** — `status` query paramı; verilmezse varsayılan `DEAD` (operatörün asıl
  ilgilendiği liste).
- **Sayfalama** — mevcut `QueryPaginationDto` / `ResponsePaginationDto` ile.
- **Arama / filtre query paramları**:
  - Event tipine göre (ör. `UserRegistered`, `admin.session.revoked`).
  - Alıcıya göre (notification tarafında e-posta adresi).
  - Aggregate / ilgili kayıt id'sine göre.
  - Tarih aralığına göre.
- Her satır response DTO'su kısa özet taşısın: **id, tip, durum, deneme sayısı, son hata (kısaltılmış),
  oluşturulma / son güncellenme zamanı**.
- Notification listelemesinde e-posta **gövdesi response'a konmamalı** (payload hafif kalsın, gizlilik).

## 3. Detay Endpoint'i

Tek bir event'in tüm hikâyesini döndüren `GET .../:id`:

- Tam **payload / metadata** (event tipi, aggregate id, oluşturulma zamanı).
- **Kaç kez denendi** ve **neden başarısız oldu** — `lastError` olarak **kısa, insan-okur bir sebep**
  (`error.message`), tam stacktrace değil.
- **Zaman bilgisi**: ne zaman oluştu, ne zaman DEAD'e düştü (createdAt / updatedAt).
- Notification için: alıcı, konu, (gerekiyorsa yetkiyle) gövde önizlemesi, provider mesaj id'si.

### Hata detayı: tablo vs. observability iş bölümü

Projede zaten OTel + Sentry + Grafana/Loki var; bu yüzden hata verisini ikiye ayırıyoruz:

- **Tablo (`lastError`) = "bir bakışta neden"** — triage için kısa sebep. DLQ panelinin **kendi kendine
  yetmesini** sağlar: operatör dead satırın yanında nedeni görür, korelasyon gerektirmez. Ayrıca
  Loki/Sentry retention'ı (7–30 gün) dolsa bile sebep, satır yaşadığı sürece kalır; o sistemler down
  olsa bile triage/retry akışı çalışır.
- **Sentry / Loki = "derin inceleme"** — full stacktrace, breadcrumb, request context. Bunlar **tabloya
  yazılmaz**.
- **Köprü**: her failure log satırı, ilgili **outbox/notification id'yi structured field** olarak
  içermeli. API detay/liste yanıtında bu id zaten döndüğü için, istemci aynı id ile Grafana/Sentry'de
  korelasyon kurabilir. (Deep-link'i istemci üretir; API yalnızca id'nin loglarda ve yanıtta tutarlı
  bulunmasını garanti eder.)
- **PII dikkati**: `error.message` içine ham kullanıcı verisi sızabilir; uzun süre DB'de duracağı için
  gerekirse sınırla/sanitize et.

## 4. Kurtarma Aksiyonları (Command Endpoint'leri)

Asıl değer burada — takılan işi API üzerinden kurtarabilmek:

- **Retry (tekli)** — `POST .../:id/retry`: bir `DEAD` satırı tekrar `PENDING`'e alıp relay'i tetikle.
  Sadece `DEAD` satırlar etkilenmeli; canlı (işlenmekte olan) bir event yanlışlıkla bozulmamalı.
- **Toplu retry** — filtrelenmiş tüm `DEAD` satırları yeniden dene (ör. `POST .../retry?status=DEAD`).
- **Delete / Discard (tekli)** — `DELETE .../:id`: artık anlamsız / zararlı bir dead event'i kalıcı sil.
  Yine sadece `DEAD` satırlar silinebilmeli. Yıkıcı işlem; yetki + throttle ile korunmalı.
- **Toplu delete**: dikkatli kullanılacak, aynı korumalarla.
- Yanıtlar net olmalı: bulunamayan id'de `404`, başarılıda `204 No Content` (mevcut `ApiDefault*`
  dekoratörleriyle belgelenir). Onay diyaloğu vb. istemcinin işi.

## 5. Güvenlik & İzlenebilirlik

- Tüm endpoint'ler **yalnızca Super Admin**'e açık (`@Roles(AdminRole.SUPER_ADMIN)`).
- **Audit log**: kim, ne zaman, hangi event'i retry/delete etti kaydı tutulmalı (özellikle delete için).
- Retry/delete endpoint'leri **`@CriticalThrottle()`** ile korunmalı (yanlışlıkla toplu tetikleme).
- Idempotent olmalı: aynı retry'ı iki kez çağırmak işi bozmamalı (event tekrar gönderilse bile
  tüketiciler idempotent).

## 6. Bildirim / Alerting (opsiyonel)

- Sunum/alarm katmanı esasen **Prometheus/Grafana** işi (dead sayısı için alert rule). Bu API'nin payı,
  o alarmların dayandığı **sayaçları health endpoint'i / metrikler üzerinden açmak**.
- Uygulama tarafında ekstra istenirse: `DEAD` eşiği aşıldığında bir event/log yayınlamak (istemci ya da
  alert pipeline tüketir).

## 7. API Sözleşmesi Detayları

- **Boş sonuç**: dead yoksa boş liste + `total: 0` (hata değil).
- **Kısaltılmış `lastError`** liste yanıtında; tam mesaj detay endpoint'inde.
- Zaman alanları **ISO-8601 / UTC** döndür; saat dilimi ve "3 dakika önce" gibi relatif gösterim
  istemcinin işi.
- Tüm endpoint'ler `@ApiTags` + `@ApiOperation` + uygun `ApiDefault*` dekoratörleriyle belgelenmeli.
- Uzun listelerde performans: şimdilik offset tabanlı sayfalama; ileride cursor tabanlı düşünülebilir.

---

## Özet Kontrol Listesi (hepsi API endpoint'i)

- [ ] Health endpoint'i: iki ledger için durum sayaçları (PENDING/PROCESSING/DEAD)
- [ ] Listeleme endpoint'i (varsayılan DEAD) + sayfalama + arama/filtre query paramları
- [ ] Detay endpoint'i: payload, deneme sayısı, kısa sebep (`lastError`), zaman alanları
- [ ] Hata iş bölümü: yanıtta kısa sebep + failure loglarında structured id (korelasyon için)
- [ ] Retry endpoint'leri (tekli + toplu), sadece DEAD satırlar
- [ ] Delete endpoint'leri (tekli + toplu), sadece DEAD satırlar
- [ ] Super Admin kısıtı + audit log + `@CriticalThrottle()`
- [ ] Dead/backlog için health/metrik verisi (alarmı Grafana kurar)
- [ ] Swagger belgeleme (`@ApiTags`/`@ApiOperation`/`ApiDefault*`) + boş liste / 404 / 204 sözleşmesi
