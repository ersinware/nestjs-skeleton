# pg-boss ile Transactional Outbox / Inbox Implementasyon Planı

Tarih: 14 Eylül 2026. Durum: implementasyon öncesi plan; bu belge çalışma davranışının uygulandığını iddia etmez.

## 1. Amaç, kapsam ve kararlar

Hedef, orta/büyük ölçekli kurumsal bir modular monolith için kalıcı, gözlemlenebilir, yatay ölçeklenebilir event teslimatıdır. API ve worker görevleri cloud-native deployment ile ayrı ölçeklenebilmeli; bounded context'ler ileride kendi veritabanlarıyla mikroservise çıkarılabilmelidir.

Anlaşılan kararlar:

- PostgreSQL ve pg-boss kullanılacak. Polling, job claim, retry sayacı, backoff ve worker kurtarma motoru sıfırdan yazılmayacak.
- İş değişikliği, doğrudan `audit.audit` kaydı ve ilgili outbox teslimat kayıtları **aynı PostgreSQL transaction'ında** yazılacak. Audit consumer veya sonradan audit taşıma akışı olmayacak.
- API yalnızca event kaydetmeyi ve event + audit kaydetmeyi de destekleyecek; aggregate mutation zorunlu olmayacak.
- Durable acceptance ile consumer completion ayrı sözleşmeler olacak. Request başarısı normalde kalıcı kabuldür; bütün consumer'ların bitmesini beklemez.
- Her gerekli consumer için bağımsız teslimat işi olacak. Bir consumer'ın hatası başarılı diğer consumer'ları tekrar çalıştırmayacak.
- Uçtan uca semantik at-least-once olacak. Gereken consumer'larda uygulama seviyesinde transactional inbox kullanılacak.
- Kalıcı event yalnızca `eventId`, sürümlü `eventType` ve `aggregateId` taşır; `payload` veya aggregate snapshot'ı içermez. Consumer gereken güncel authoritative state'i `aggregateId` ile sahipli port/facade üzerinden okur.
- Outbox teslimatı event'ten ayrı teknik metadata olarak kaynak `traceId` ve `traceparent` saklar. Her consumer denemesi ayrı trace açar ve kaynak span'e link verir; tracing yokluğu iş teslimatını engellemez.
- Bugün process içi dispatch kullanılacak. RabbitMQ adaptasyonu için sınırlar hazırlanacak; bu çalışmada RabbitMQ kurulmayacak.
- Session güvenliği, optimistic concurrency, DDD/Hexagonal sınırlar ve mevcut HTTP sözleşmeleri dikkatsizce gevşetilmeyecek.
- Bu aşamada yalnızca belge oluşturulur. Aşağıdaki commit'ler gelecekteki implementasyon işlerini tarif eder; bugün kod, bağımlılık, migration veya test değiştirilmez.

## 2. Araştırma sonucu: pg-boss yeterli mi?

**Sonuç:** pg-boss, aynı DB transaction'ına katılan outbox depolaması ve teslimat yürütücüsü olarak uygun. Genel bir uygulama inbox'ı, dış servislerde exactly-once etkisi veya sınırsız event arşivi sağlaması beklenmemeli. Kurumsal yeterlilik; aşağıdaki atomiklik, retention, failover ve yük kabul kriterleriyle doğrulanacak. Kaynak incelemesi kapasite benchmark'ının yerine geçmez.

Araştırmada resmi release listesinde `12.31.1` görüldü. İncelenen paket ESM ve Node `>=22.12.0` istiyor; pg-boss belgeleri PostgreSQL 13+ gereksinimi belirtiyor. İlk implementasyon commit'i kesin sürümü lockfile'a sabitleyecek; o sürümün API, SQL ve migration davranışını doğrulayacak. Yeni bir sürüm otomatik olarak daha güvenli kabul edilmeyecek. [Release listesi](https://github.com/timgit/pg-boss/releases), [12.31.1 paket bildirimi](https://github.com/timgit/pg-boss/blob/12.31.1/package.json), [resmi proje](https://github.com/timgit/pg-boss)

| İhtiyaç              | Araştırma bulgusu                                                                             | Projeye kalan sorumluluk                                                      |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Atomik enqueue       | `send` / `insert` mevcut transaction'a `db` adapter'ıyla katılabiliyor; Drizzle adapter'ı var | Mutation, audit ve bütün teslimatların aynı bağlantı/transaction'ı kullanması |
| İş yürütme           | pg-boss worker API'si mevcut                                                                  | İnce dispatcher ve doğru consumer eşlemesi                                    |
| Retry / worker ölümü | Kalıcı retry politikası, expiration ve heartbeat desteği var                                  | Timeout bütçeleri, hata sınıflandırması ve idempotency                        |
| Dead-letter          | Queue bazında DLQ ve redrive mevcut                                                           | Alarm, retention, yetkili kurtarma ve replay politikası                       |
| Inbox                | Job kaydı uygulama etkisini otomatik dedup etmez                                              | Unique inbox kaydı ile DB etkisini aynı transaction'a almak                   |
| E-posta              | Kuyruk kabulü sağlayıcı kabulü değildir                                                       | Sağlayıcı idempotency'si veya açık duplicate toleransı                        |
| Mikroservis          | PostgreSQL job'ı broker'a publish yapan worker'ı çalıştırabilir                               | RabbitMQ adapter'ı, consumer ingress, ack ve sözleşme sürümleme               |

Atomik entegrasyon için resmi örnek `boss.send(..., { db: fromDrizzle(tx, sql) })` kullanıyor. Proje `drizzle-orm/node-postgres` kullandığından belgelenen driver yoluyla uyumludur. Aynı DB URL'sini kullanmak tek başına transaction paylaşmak değildir. [ORM transaction adapter'ları](https://pgboss.io/api/adapters)

pg-boss'un özellik listesindeki “exactly-once” ifadesi, Gmail çağrısı veya bağımsız DB commit'i dahil bütün iş etkilerine genişletilmeyecek. Consumer etkisi gerçekleştikten sonra job completion kaydedilmeden çökme olasılığı tasarımın parçasıdır.

## 3. Mevcut checkout'ta doğrulanan durum

| Alan                                                                                                                                                          | Mevcut durum                                                                          | Gerekli değişiklik                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [User writer](src/module/user/infrastructure/adapter/user-writer.adapter.ts), [Admin writer](src/module/admin/infrastructure/adapter/admin-writer.adapter.ts) | Conditional upsert sonrası event yayımlanıyor; `.catch(() => {})` kullanılıyor        | Emit yerine transaction içi kalıcı enqueue                         |
| User/Admin mutation handler'ları                                                                                                                              | `save` ve `auditPort.record` ayrı çağrılar                                            | Tek commit sınırı                                                  |
| [Audit adapter](src/core/observability/audit/adapter/audit.adapter.ts)                                                                                        | Kendi primary client'ı üzerinden insert yapıyor                                       | Mutation'ın transaction'ına katılma                                |
| [Event publisher port](src/core/event-bus/port/event-publisher.port.ts)                                                                                       | `emitAsync` listener completion bekliyor                                              | Kalıcı kabul ile teslim sözleşmelerini ayırma                      |
| [DomainEvent](src/shared/domain/event/domain-event.ts)                                                                                                        | `type`, `aggregateId`; writer dispatch sırasında ID üretiyor                          | Bir kez oluşturulan, retry boyunca sabit event kimliği             |
| [AggregateRoot](src/shared/domain/aggregate-root/aggregate-root.ts)                                                                                           | `pullDomainEvents` listeyi temizliyor                                                 | Commit başarısızken event kaybını önleme                           |
| [OnAppEvent](src/core/event-bus/decorator/on-app-event.decorator.ts)                                                                                          | Zaten `suppressErrors: false` uyguluyor                                               | Merkezi politikayı koruma; doğrudan `OnEvent` bypass'ını engelleme |
| Revocation consumer'ları                                                                                                                                      | `eventId` komuta iletilmiyor; her çalışmada sürüm artıyor; ardından mail gönderiliyor | Inbox ve notification işinin ayrılması                             |
| Gmail adapter                                                                                                                                                 | `users.messages.send`; uygulama idempotency anahtarı yok                              | Tekrar azaltma ve belirsiz gönderim sonucu politikası              |
| `logout-all`                                                                                                                                                  | Listener bekleniyor; ardından audit yazılıyor                                         | Event + audit atomik kabul                                         |
| Refresh reuse                                                                                                                                                 | Redis sonucundan sonra fire-and-forget event ve ayrı audit                            | Kalıcı event + audit kabulü; Redis/PG boşluğunu ayrıca ele alma    |

Kod envanteri tüm user/admin mutation handler'larını kapsar: register/create, update, ban/unban, delete, permissions, password, admin activate/re-invite ve session revoke. Read/disclosure ve reddedilen işlem audit'leri mutation audit'iyle birleştirilmeyecek.

IDE'de görünen `docs/issue/session-recovery-and-revocation.md` bu checkout'ta bulunamadı. Session tasarımında mevcut [Security & Sessions](agent/security-and-sessions.md) esas alındı; mevcut olmayan belgenin kararları uygulanmış varsayılmadı.

## 4. Mimari ve sahiplik

### 4.1 Context sahipliği

- Her producer context için pg-boss'un yönettiği ayrı teknik şema önerilir: `user_delivery`, `admin_delivery`, `auth_delivery`. Bunlar başka context'lerin iş tabloları değildir; producer'ın teslimat deposudur.
- Migration'lar pg-boss'un desteklenen CLI/API'siyle yönetilir. Kütüphane tabloları Drizzle ile yeniden modellenmez veya elle değiştirilmez.
- `core/event-bus` genel port, adapter ve worker yaşam döngüsünü barındırır; event isimleri, consumer iş kuralları ve topic-to-consumer eşlemesi context kayıtlarından composition aşamasında sağlanır. Core somut context import etmez.
- Application içinde Drizzle transaction, pg-boss `Job` veya Nest `EventEmitter2` görünmez. Domain ve shared katmanlarına pg-boss bağımlılığı girmez.
- Context başına şema maliyeti; pool, maintenance ve migration sayısına yansır. Ortak bounded pool kullanımı veya ayrı pool bütçesi Faz 1'de kesinleştirilir; her queue için kontrolsüz bağlantı havuzu açılmaz.
- Mikroservise çıkarılan context kendi DB'si ve teslimat şemasıyla taşınır. Başka servisin PostgreSQL kuyruğunu uzaktan okuyarak servisler arası entegrasyon kurulmaz.

Mevcut rehber modül tablolarını aynı adlı şemaya bağlar. pg-boss'un yönettiği context'e ait teknik şemalar ve kütüphane iç tabloları için dar bir istisna, uygulama aşamasında Data & State'e eklenecek. Kütüphane iç UUID üretimi de proje aggregate/event UUID v7 kuralının kapsamından açıkça ayrılacak; paket SQL'i bu sebeple fork edilmeyecek.

### 4.2 Event ve delivery kimlikleri

Kalıcı event sözleşmesi yalnızca üç alandır; ayrı bir `payload` alanı yoktur:

```ts
{
    eventId: '...',
    eventType: 'user.updated.v1',
    aggregateId: '...'
}
```

Bu gösterim planlanan kalıcı sözleşmedir; mevcut event tipi adlarının sürümlü biçime geçirilmesi Faz 4 kapsamındadır. Alanlar job'ın JSON verisinde taşınabilir; her biri için ayrıca PostgreSQL sütunu açılması gerekmez. pg-boss'un kendi job yönetim alanları bu event sözleşmesinin parçası değildir.

- `eventId` bir mantıksal event için bir kez UUID v7 olarak üretilir. Job retry, DLQ ve redrive yeni mantıksal event değildir.
- pg-boss job ID'si delivery kimliğidir; özellikle redrive sırasında değişebilir. Inbox job ID'si üzerinden kurulmaz.
- Consumer kimliği class/method adından türetilmez; refactor ile değişmeyen sözleşme kimliğidir.
- Sözleşme sürümü `eventType` içinde taşınır; ayrı `schemaVersion` yoktur. `producerContext`, `occurredAt`, `correlationId`, `causationId` ve `routeVersion` eklenmez. Consumer kimliği queue/registry eşlemesinden çözülür, event'e kopyalanmaz.
- İş verisi olarak yalnızca `aggregateId` taşınır. Durum, sürüm sayacı, e-posta adresi, token, parola veya HTML eklenmez. Consumer ihtiyaç duyduğu state'i her denemede primary kaynaktan yeniden okur; cache eviction gibi yalnızca ID kullanan işler gereksiz DB okuması yapmaz.
- Event türü yapılacak işlemi belirtir; güncel state bu işlemin bugün nasıl uygulanacağını belirler. Reconciliation güncel sürümü yansıtır; logout/reuse talebi ise inbox korumasıyla bir kez revocation uygular. Güncel okuma, bütün consumer'ları kendiliğinden idempotent yapmaz.
- Bulunamayan, soft-delete edilmiş veya artık işleme uygun olmayan aggregate için consumer'a özgü sonuç tanımlanır. Session reconciliation soft-delete edilmiş principal'ın güncel sürümlerini de okur; geçici okuma hatası “aggregate yok” diye başarılı tamamlanmaz.
- Bu sözleşme olay anındaki state'i veya aggregate sürümünü yeniden kuramaz. Kaynak mutation'ın geçmiş kanıtı aynı transaction'daki audit kaydındadır; consumer iş verisi için audit'i okumaz. Tarihsel snapshot gerektiren yeni bir ihtiyaç bu planın garantisi değildir ve ayrıca tasarım kararı gerektirir.
- Actor bilgisi otomatik olarak worker'a taşınmış sayılmaz. AsyncLocalStorage process sınırını geçmez. İlk mutation audit'i request tarafında yazılır; consumer'ın kendi mutation audit'i kaynak `eventId` ile ilişkilendirilir, sahte kullanıcı kimliğiyle yazılmaz. Event'e veya command payload'ına audit actor eklenmez.

### 4.3 Transaction API'si

Önerilen application sözleşmesi, typed context writer port'larına ek olarak transport-neutral bir transaction port'udur. Şematik kullanım:

```ts
// Yalnızca event: port kendi kısa transaction'ını açar.
await eventPublisher.accept(event);

// Event + audit: aggregate mutation gerekmez; event aggregateId taşır.
await transaction.run(async () => {
    await eventPublisher.accept(event);
    await audit.record(auditInput);
});

// Mutation + audit + event(ler).
// Yetkilendirme, aggregate load ve hashing mümkün olduğunca bu bloğun önündedir.
await transaction.run(async () => {
    await writer.save(aggregate); // aggregate event'lerini aynı transaction'a ekler
    await audit.record(auditInput);
});
```

Bu örnek planlanan API'dir, mevcut derlenebilir kod değildir. Somut isimler Faz 2'de belirlenir. `run` callback'i yalnızca kısa DB işlerini kapsar; Redis/Gmail/network çağrıları ve pipeline dispatch içine alınmaz.

Teknik adapter'lar async-scope içindeki aynı Drizzle transaction'ını çözer. Kapsam transaction'ın sahibi context ve DB kimliğini taşır; başka context'in business writer'ı bu kapsamı kullanamaz. Core audit ve producer'ın delivery deposu izin verilen teknik katılımcılardır. İç içe çağrı bağımsız commit açmaz; başka DB/context'e katılım reddedilir. Scope callback dışına kaçamaz, detached promise başlatılamaz.

`record`/`accept` transaction içindeyken resolve olması yalnızca insert'in başarılı olmasıdır; dayanıklılık garantisi dıştaki `run` commit'inde oluşur. Transaction dışında her port dönüşü kendi commit'ini bekler. Mevcut `IAuditPort` JSDoc'u bu ayrımı anlatacak.

Mutation writer'ları geçiş tamamlanınca aktif mutation transaction'ı gerektirir; yanlışlıkla audit'ten ayrı commit sessizce yapılamaz. Event-only publisher ise transaction yokken güvenli biçimde kendi transaction'ını açar. Bu API aggregate load/save zorunluluğunu kaldırır; event'in `aggregateId` alanı yine zorunludur. Audit-only read/refusal kayıtları çalışmaya devam eder.

Transaction başarısızlığında aggregate event listesi tüketilip kaybolmamalı. Event'ler bir kez hazırlanır; commit sonrasında temizlenir veya başarısız aggregate instance'ının tekrar kullanımı açıkça engellenir. Belirsiz commit sonucu bütün handler'ı körlemesine tekrar çalıştırarak yeni event ID üretmeye yol açmamalı. HTTP request idempotency ayrı bir konudur; event dedup bunu otomatik çözmez.

### 4.4 Fan-out ve teslim

Producer routing kataloğu bütün gerekli hedefleri bilir. Application yalnızca event'i kabul ettirir; hedef seçimini adapter yapar. Her hedef job'ı **aynı ilk transaction'da** eklenir. Bir hedefin enqueue işlemi başarısızsa bütün transaction rollback olur. Consumer'ların iş değişiklikleri bu transaction'a katılmaz.

```text
Producer transaction
  business write + audit.audit + delivery A + delivery B
                         |
                       COMMIT
                  /               \
         pg-boss worker A     pg-boss worker B
                 |                   |
          consumer A             consumer B
          kendi commit'i         kendi etkisi
```

Bir consumer job'ından orijinal event tipine genel `emitAsync` yapılmayacak; bu bütün subscriber'ları her job için tekrar çağırır. Seçilen yol: merkezi wrapper/registry ile `(consumerId, eventType)` adresine hedefli process içi dispatch. `consumerId` job'ın queue eşlemesinden, sürümlü `eventType` event'ten alınır. Exactly-one handler registration startup'ta doğrulanır; eksik veya çift registration başarılı teslim sayılmaz. Listener command pipeline'ını kullanır; core handler'ı doğrudan çağırmaz. DLQ/redrive sırasında kaynak queue'nun consumer eşlemesi korunur; queue adı değiştirilirse pending işler için açık geçiş yapılır.

Route kataloğu runtime listener keşfinin tesadüfi sonucuna bağlı olmayacak; API-only deployment worker register etmeden enqueue yapabilmeli. Hedefi olmayan event için sessiz başarı yok: açıkça tanımlı saklama amacı yoksa konfigürasyon hatasıdır. “Sadece event” desteği, “bilinmeyen/hedefsiz event'i düşür” anlamına gelmez.

İlk sürüm pg-boss `send` çağrılarını açık hedef listesiyle transaction içinde kullanır. Kütüphanenin pub/sub API'si olsa da çoklu enqueue atomikliği ve sürümlü subscription yaşam döngüsü doğrulanmadan ona geçilmez.

## 5. Inbox: nerede ve neden?

**Consumer sayısı karar ölçütü değildir.** Tek consumer/tek instance bile crash sonrası aynı event'i yeniden alabilir. Birden fazla instance aynı consumer kimliğinin worker'larıdır; her instance için ayrı inbox kimliği yaratılmaz.

| Mevcut consumer/akış                                              | Etki                                                 | Karar                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `UserCacheListener.invalidateProfile`                             | Cache anahtarı silme                                 | Inbox yok; tekrar güvenli. Stale cache fill yarışı ayrıca devam eder            |
| `UserSessionListener.reconcile`, `AdminSessionListener.reconcile` | Primary state okuyup Redis sürümünü max olarak yazma | Inbox yok; tekrar/out-of-order reconciliation güvenli olmalı                    |
| User/Admin `revokeAfterReuse`, `revokeAfterLogoutAll`             | DB session/revocation sayaçlarını artırma            | **Transactional inbox gerekli**; tekrar yeni oturumları da iptal edebilir       |
| `AdminInviteListener.sendInvite`                                  | Gmail gönderimi                                      | Gönderim ledger'ı/sağlayıcı idempotency'si; DB inbox tek başına yeterli değil   |
| Revocation içindeki güvenlik bildirimi                            | DB commit ardından e-posta                           | Ayrı notification job'ına çıkar; revocation inbox'ı mail retry'ını engellemesin |
| Kaynak mutation audit'i                                           | `audit.audit` insert                                 | Consumer yok; kaynak transaction'da yazılır                                     |
| Gelecekteki RabbitMQ ingress                                      | Mesajı yerel iş kuyruğuna kabul etme                 | Giriş dedup kaydı + enqueue aynı yerel transaction'da; sonra ack                |

Inbox modeli context'e ait tabloda `(consumer_id, event_id)` birleşik primary key, çelişen tekrarları denetlemek için `event_type` ve `aggregate_id`, retention için `processed_at` içerir. Ayrı surrogate ID veya genel metadata alanı gerekmez. Consumer kimliği sabit registration'dan alınır. Aynı event ID ile farklı event türü/aggregate ID gelirse sessiz duplicate kabul edilmez; karantinaya alınır.

```text
BEGIN
  INSERT inbox ... ON CONFLICT DO NOTHING RETURNING ...
  Duplicate ise: iş etkisini tekrar uygulama
  Yeni ise: business write + kendi audit'i + yeni outbox işleri
COMMIT
```

Inbox satırı iş etkisinden ayrı commit edilmez. Eşzamanlı duplicate'ler DB uniqueness ile yarışır; winner rollback ederse diğer deneme işi yapabilmelidir. Business conflict durumunda inbox da rollback olur; retry yeni authoritative state yükler. Geçerli no-op (ör. artık bulunmayan hesap) bilinçli tamamlanmış sonuç olarak kaydedilebilir.

Revocation handler'ına `eventId` taşınır. Inbox geçildikten sonra counter bump, audit ve session reconciliation/notification enqueue aynı commit'te yapılır. Redis ve e-posta bu DB transaction'ının dışında kalır.

DB'ye yazmayan tek consumer'da da idempotency anlamlı olabilir: örneğin bir dış API'ye ücretlendirme veya e-posta çağrısı. Ancak DB inbox'ı ile dış etkiyi atomik yapmak mümkün değildir; sağlayıcı mekanizması veya reconciliation gerekir.

## 6. E-postanın iki kez gönderilmesi

Mevcut Gmail `users.messages.send` sözleşmesinde belgelenmiş bir idempotency-key parametresi bulunmuyor. Bu nedenle Gmail + PostgreSQL ile hem kayıpsız gönderim hem hiçbir durumda duplicate olmaması garanti edilemez. Bu sonuç API sözleşmesinden ve iki bağımsız commit sınırından çıkarımdır. [Gmail send API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)

```text
Gmail kabul etti → bağlantı koptu / worker kapandı → sent kaydı yazılamadı
```

Önce `sent` yazmak mail kaybına, sonra yazmak belirsiz sonuçta duplicate'e yol açabilir. Sabit MIME `Message-ID`, “sent klasöründe ara” veya sadece pg-boss job ID'si bu pencereyi güvenilir biçimde kapatmaz.

Planlanan azaltma:

- Mantıksal notification için sabit kimlik; aynı event/purpose için tek notification oluşturma.
- Notification event'i de aynı üç alanı taşır. Ayrı notification üretilirse kendi sabit `eventId`'si olur; kaynak event ile tekilleştirme ilişkisi producer'ın inbox/ledger transaction'ında tutulur. Amaç event tipi/consumer kaydından, alıcı ve içerik gereken güncel owner okumasından çözülür; event'e adres, token veya içerik eklenmez.
- Context'e ait gönderim ledger'ı: kabul bekleyen, gönderiliyor, gönderildi, sonucu belirsiz ve terminal hata durumları. Süreli sahiplik çakışmayı azaltır; lease expiry eski dış çağrıyı geri alamaz.
- Başarısı DB'ye kaydedilmiş gönderim tekrar gönderilmez. Provider message ID saklanır; hassas içerik loglanmaz.
- Belirsiz sonuç normal “hiç gönderilmedi” ile aynı sınıfa konmaz. Varsayılan mevcut rehbere uygun duplicate toleranslı at-least-once gönderimdir; duplicate azaltılır, sıfır duplicate iddia edilmez.
- Kesin duplicate önleme iş gereksinimiyse Gmail adapter'ı ile tamamlandı denemez. Sağlayıcı seçimi ayrı karar olur; idempotency anahtarı süresi, aynı anahtar için aynı e-posta istek içeriği şartı ve replay penceresi doğrulanır. Sağlayıcı bu planla kendiliğinden değiştirilmez.
- Invite token retry'da değişebildiği için idempotency destekleyen sağlayıcıya geçişte aynı anahtar altında farklı e-posta istek içeriği gönderilmez. Güvenli içerik saklama/sabit üretim veya generation bazlı gönderim sözleşmesi notification altyapısında ayrıca tasarlanır; güncel uygunluk kontrolü korunur. Bunlar event payload'ı değildir; outbox'a token veya içerik konmaz.
- Admin invite her denemede güncel banned/deleted/active ve `revocationVersion` bilgisini okur; token güncel sürümle üretilir. Event davet generation'ı taşımaz: eski invite işi, sonraki re-invite'dan sonra çalışırsa güncel daveti gönderebilir. Farklı event ID'leri inbox tarafından birleştirilmez. Bu güncel durum semantiği kabul senaryosunda doğrulanır; eski generation'ı ayırt edip bastırma garantisi verilmez. Böyle bir gereksinim doğarsa owner tarafında kalıcı notification/generation politikası ayrıca tasarlanır; event'e snapshot eklenmez.

## 7. Retry, dead-letter, kurtarma ve telafi

### 7.1 Retry politikası

Kütüphanenin `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`, `expireInSeconds` ve gerekirse `heartbeatSeconds` seçenekleri yapılandırılır. Retry/expiration için kendi timer veya SQL claim döngümüz yazılmaz. Queue'dan job'a miras kalan varsayılanlar açıkça sabitlenir; callback'in gerekli işi beklemeden dönmesi başarı sayılmamalıdır. [Job seçenekleri](https://pgboss.io/api/jobs)

Önerilen hata politikası:

| Hata                                                                    | Davranış                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Geçici DB/Redis/network/provider kesintisi                              | Sınırlı retry + capped exponential backoff ve jitter                  |
| Consumer optimistic concurrency çakışması                               | Yeni state yükleyerek retry; aynı stale aggregate tekrar save edilmez |
| Bilinmeyen sürümlü eventType, geçersiz event alanları, olmayan consumer | Karantinaya/DLQ'ya yönlendirme; başarılı ack yok                      |
| Artık gereksiz iş                                                       | Açık no-op sonucu; teknik hata gibi retry edilmez                     |
| Programlama hatası                                                      | Sentry + sınırlı retry/terminal hata; yutulmaz                        |
| Belirsiz e-posta sonucu                                                 | Bölüm 6'daki ayrı politika                                            |

Queue sınıfları ayrılır: güvenlik reconciliation/revocation, cache ve notification. E-posta kuyruğu güvenlik işlerini bloke etmez. Başlangıç sayıları gerçek dependency timeout'ları ve ölçülen p99 süreler görülmeden üretim standardı olarak uydurulmaz. Faz 1 kapasite girdilerini, Faz 5 sayısal politika dosyasını üretir; üretime çıkışta boş bırakılmaz.

### 7.2 DLQ ve dead event tespiti

DLQ önce oluşturulur, sonra source queue ona bağlanır. Her consumer'ın bağımsız terminal teslimat sonucu vardır; bütün event'i tek “dead” etiketiyle başarılı tüketicilerden koparmayız. Source ve DLQ retention'ları ayrı tanımlanır. Native redrive kullanılır; job ID değişse bile envelope içindeki event ID korunur. [Queues](https://pgboss.io/api/queues), [Redrive](https://pgboss.io/api/jobs#redrive)

Tespit sadece exception log'undan yapılmaz. Şunlar izlenir:

- Failed ve DLQ kayıt sayısı, en eski çözülmemiş teslimat yaşı.
- Ready backlog ve enqueue-to-completion gecikmesi.
- Retry artışı, expiration/heartbeat recovery ve consumer'ın ilerlememesi.
- Kayıtlı hedef için aktif worker bulunmaması; process `wip` verisi tek başına fleet sağlığı değildir.
- Retention sonuna yaklaşan pending/DLQ kayıtları; metrik örneklerinin güncelliği.

pg-boss `error` listener'ı `start` öncesinde bağlanır. `warning` olayları mevcut observability port'larına çevrilir; job hatalarının tamamı yalnızca bu process olaylarından takip edilmeyecek. [pg-boss events](https://pgboss.io/api/events)

### 7.3 Operasyonel kurtarma

Yetkili operasyon komutu/runbook: listele → hata/sürüm/yan etki durumunu incele → sebebi gider → sınırlı batch ile tek başarısız consumer'ı redrive et → sonucu doğrula. Komut önce dry-run gösterebilir; gerçek replay kim tarafından, hangi nedenle yapıldı audit'e yazılır. İlk sürümde herkese açık bir yönetim HTTP endpoint'i açılmaz.

Inbox retention içindeki başarılar redrive'da no-op olur. Notification job'ları provider belirsizliği nedeniyle ayrı uyarı/işlem politikası kullanır. Redrive üç event alanını değiştirmez; consumer güncel state'i yeniden okur, eski state'i tekrar uygulamaz. İş anlamını düzeltmek gerekiyorsa orijinal kayıt korunur ve ayrı command yeni event ID üretir; kaynak event ile ilişki operasyon audit'inde tutulur, event'e `causationId` eklenmez.

**Telafi retry değildir.** Örneğin ban event'i dead oldu diye ban otomatik geri alınmaz. Öncelik ileri yönde state reconciliation'dır. Geri alma gerekiyorsa domain kurallarını, yetkiyi ve audit'i uygulayan ayrı command gerekir. Bu projede generic saga/compensation motoru eklenmez.

### 7.4 Retention ve veri kaybı sınırı

pg-boss kalıcı event arşivi değildir. Varsayılan retention'lar körlemesine kullanılmayacak: queued/retry süresi ve terminal kayıt temizliği ayrı değerlendirilir. İncelenen SQL ve API'deki cleanup koşulları sabitlenen sürümde birlikte kontrol edilir. DLQ varlığı, hiç çalışmamış ve retention'ı dolmuş her job'ın otomatik DLQ'ya gireceği anlamına gelmez. [12.31.1 SQL uygulaması](https://github.com/timgit/pg-boss/blob/12.31.1/src/plans.ts)

Üretim öncesi `maksimum desteklenen kesinti`, `maksimum event replay yaşı`, `operatör müdahale süresi`, `pending retention`, `DLQ retention`, `inbox/notification retention` sayısallaştırılır. Retention en kötü kesinti + retry + müdahale süresini kapsar; dedup süresi bütün desteklenen replay aralığını kapsar. Yaşı aşmış event'in normal redrive'ı reddedilir; kontrollü reconciliation gerekir.

Çözülmemiş kayıtların desteklenen kurtarma penceresinde sessiz silinmesi kabul edilmez. Daha uzun veya sınırsız kurtarma istenirse native retention yeterli varsayılmaz: context'e ait değişmez event/target arşivinin ilk transaction'a eklenmesi ve buradan kontrollü recovery, ayrı depolama kararı olarak zorunlu olur. Audit tablosu event arşivi yerine kullanılmaz. Bu karar Faz 1'de kapatılmadan pg-boss-only depolama üretime alınmaz; retry motoru yine pg-boss'ta kalır.

## 8. Çoklu Fargate instance, ordering ve cloud işletimi

pg-boss PostgreSQL locking ile normal claim yarışını yönetir. Ancak bu, iş etkilerinde hiç yarış olmayacağı anlamına gelmez: aynı aggregate'in farklı event'leri, retry sırasında hâlâ yaşayan eski worker, DB failover ve external timeout yarışları devam eder.

- Instance başına queue açılmaz. Aynı consumer'ın instance'ları aynı queue'yu paylaşır; farklı consumer'lar farklı queue kullanır.
- DB etkilerinde unique inbox + optimistic concurrency birlikte çalışır.
- Varsayılan iş sözleşmesi out-of-order toleranslıdır. UUID v7 veya oluşturulma zamanı commit/completion sırası garantisi değildir.
- `localConcurrency` fleet limiti değildir. Global kısıt gerektiğinde sürümün desteklediği DB-backed group concurrency değerlendirilir. Strict ordering yalnızca somut invariant gerektirirse eklenir; retry/dead job'ın aynı anahtarı bloke etmesi operasyonel sonuçtur.
- Heartbeat/expiration, eski Gmail/Redis çağrısını fiziksel olarak iptal etmiş sayılmaz. Desteklenen çağrılara abort/deadline iletilir; idempotency yine gereklidir.
- Başlangıçta batch size 1; batching ancak iş bazında completion/failure korunarak ölçümle açılır.

Worker API'si polling, opsiyonel LISTEN/NOTIFY ve local/global concurrency seçeneklerini belgeliyor. NOTIFY yalnızca uyandırma optimizasyonudur; polling fallback kalır. Bildirim bağlantısı session-pinned olmalıdır. [Workers](https://pgboss.io/api/workers)

Deployment tasarımı:

1. Aynı image için API ve worker rolleri; üretimde ayrı ECS services ve bağımsız autoscaling. Tek process geliştirme modu mümkün.
2. Migration/queue topology ayrı one-off deployment adımı. Her task başlarken kontrolsüz DDL çalıştırılmaz. Eski worker'lar yeni event üretilmeden yeni sözleşmeyi okuyabilir olmalı.
3. Stateless container, bounded DB pool ve graceful shutdown. SIGTERM'de yeni iş kabulü/claim durur; aktif request/job'lar sınırlı sürede drain edilir, iş kaynakları ve DB pool kapatılır, son span'ler üretildikten sonra telemetry flush/shutdown tamamlanır. Toplam süre stopTimeout bütçesine sığar; ayrıntılar Bölüm 8.1'de.
4. ECS Fargate `stopTimeout` varsayılanı 30, üst sınırı 120 saniye. İş timeout'u ve drain bütçesi buna uydurulur; daha uzun işin checkpoint/retry stratejisi gerekir. [ECS container tanımı](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html)
5. API liveness dış bağımlılığa bağlanmaz. API readiness kalıcı enqueue için gereken primary DB/şema uygunluğunu kapsar. Worker readiness başlangıç/registration durumunu gösterir; uzun süren ilerlememe ayrıca alarmdır. Cache arızasında API fail-open kuralı korunur.
6. OTel ve Grafana/Loki/Sentry entegrasyonu Bölüm 8.1'deki kalıcı kaynak bağlamı + her denemeye ayrı trace/link modeliyle kurulur. Üç alanlı business event ile teknik teslimat metadata'sı ayrı tutulur.
7. Autoscaling yalnızca CPU'ya dayanmaz: backlog yaşı ve drain hızı, consumer maliyeti ve DB kapasitesi birlikte kullanılır. Kontrolsüz task artışı primary DB'yi çökertmemeli.
8. Peak üretim hızı × fan-out × retry amplifikasyonu ile yük hesaplanır. API p95/p99, oldest event age, DB connection/WAL/IOPS, autovacuum ve storage büyümesi ölçülür. Güvenlik queue'ları için ayrı gecikme SLO'su yazılır.

### 8.1 Outbox ve consumer tracing tasarımı

**Mevcut kod:** [tracing.ts](src/tracing.ts) HTTP/Fastify instrumentation'ını ve Pino `traceId`/`spanId` korelasyonunu kurar; tracing test/CI'da veya SDK kapalıyken çalışmaz. HTTP isteği geçerli upstream trace bağlamını devam ettirebilir; her istekte mutlaka yeni trace ID oluşturulmaz. [TracingBehavior](src/core/cqrs/tracing.behavior.ts) listener dahil bütün pipeline girişlerinde command/query span'i açar ve hataları işaretler. [Event publisher](src/core/event-bus/adapter/event-publisher.adapter.ts) ve `OnAppEvent` ayrıca messaging span'i açmaz, DB kuyruğuna bağlam aktarmaz. [Audit adapter](src/core/observability/audit/adapter/audit.adapter.ts) yazma anındaki aktif trace ID'yi kaydeder. OTel tracing'in sahibidir; Sentry exception tracking ve `SentryContextManager` korunur. Bunlar kod/config bulgularıdır; backend üzerinde canlı trace doğrulaması değildir.

#### Alanların anlamı ve depolama

Bir trace işlem zinciridir; span o zincirdeki HTTP isteği, command veya DB sorgusu gibi ölçülen bir adımdır. W3C `traceparent` örneği:

```text
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
│  │                                │                └ trace flags
│  │                                └ kaynak span ID
│  └ trace ID
└ traceparent formatının sürümü
```

- `00`: Bu metnin hangi W3C formatıyla okunacağını belirtir; eventType içindeki `.v1` veya uygulama sürümü değildir.
- `traceId`: İlişkili işlem zincirinin 32 hexadecimal karakterlik kimliği.
- Kaynak `spanId`: Bağlamı gönderen ölçüm adımının 16 hexadecimal karakterlik kimliği; yalnız trace ID ile hangi adıma bağlanılacağı bilinmez.
- Trace flags: Bit alanıdır. Örnekte `01`, sampled bitinin açık olduğunu gösterir; kaynak tarafın trace kaydı için sampling işaretidir. İşin başarılı/başarısız olduğunu veya Collector'ın trace'i kesin saklayacağını söylemez. `00` için sampled biti kapalıdır. Parser elle yazılmaz; OTel propagator kullanılır.

Kaynak: [W3C Trace Context](https://www.w3.org/TR/trace-context/).

pg-boss'un vendor tablolarına özel sütun eklenmez. Uygulamanın job JSON verisi event ile teknik tracing bilgisini ayrı taşır. Bu, business payload eklemek değildir. Şematik kayıt:

```ts
{
    event: { eventId: '...', eventType: 'user.updated.v1', aggregateId: '...' },
    telemetry: {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    }
}
```

`telemetry` yalnızca `traceId` ve `traceparent` alanlarını kabul eder; genel baggage aktarımı açılmaz. OTel propagator çıktısından yalnızca `traceparent` saklanır ve broker header'ına aktarılır. `telemetry` isteğe bağlıdır ve adapter tarafından doldurulur; domain/application caller OTel context veya tracing alanı vermek zorunda değildir. `traceId`, inceleme kolaylığı için `traceparent` içindeki kimliğin bilinçli tekrarıdır; aynı geçerli span context'inden üretilir. Çelişkide geçerli `traceparent` esas alınır ve ayrı ID normalize edilir; geçersiz/eksik context iş hatasına veya DLQ'ya dönüşmez. Geçerli trace ID tek başına varsa yalnız korelasyon için kullanılabilir; span link'i uydurulmaz. Boyut/format doğrulaması merkezi yapılır, ham hatalı header loglanmaz. Telemetry exporter kesintisi business transaction'ı başarısız yapmaz; outbox DB insert hatası ise normal atomiklik kuralına tabidir.

#### Producer, worker ve retry akışı

1. Kalıcı kabul adapter'ı aktif command/request bağlamında kısa enqueue span'i açar. Aynı mantıksal event'in bütün hedeflerine bu span'den üretilen kaynak metadata'sı ilk DB transaction'ında yazılır. Açık dış transaction varsa enqueue span'inin bitmesi durable commit anlamına gelmez; commit/rollback üst transaction/use-case span'inde görünür. Transaction veya span kuyruk bekleme süresince açık tutulmaz.
2. Worker her job denemesi için izole OTel context ve Sentry scope oluşturur. Yeni root trace içinde bir consumer processing span'i açar; saklanan kaynak span context'ini **parent değil link** olarak ekler. Polling döngüsü veya başka job'ın aktif context'i parent olarak sızmaz. Consumer ve bütün gerekli promise'leri bu span içinde await edilir.
3. Mevcut command/query `TracingBehavior` span'leri processing span'inin altında çalışır. Cache eviction gibi pipeline kullanmayan consumer da dış processing span'iyle görünür. DB/Redis/HTTP otomatik instrumentation'ının bu aktif bağlama katılması doğrulanır; her listener'a elle tracing kodu eklenmez.
4. Retry ve fan-out consumer'ları ayrı trace/span kimlikleri üretir. Aynı event'in retry/DLQ/redrive'ı kaynak `traceId`/`traceparent` bilgisini değiştirmez. Consumer yeni mantıksal event üretirse onun kaynağı o anda çalışan consumer'ın enqueue span'idir; ilk HTTP kaynağı yeni event'e zorla kopyalanmaz. Arşivden recovery gerekiyorsa teknik kaynak metadata'sı da korunur.
5. No-op/inbox duplicate başarılı sonuç olarak görünür. Başarısız denemede span exception/ERROR kaydeder, hata pg-boss'a kadar yayılır. Worker sınırı mevcut exception/dependency kurallarına göre log/Sentry raporlamasını sahiplenir; HTTP exception filter'ı varmış gibi davranılmaz. Span'lerde hata işaretlemek ile aynı hatayı birden çok kez Sentry'ye göndermek ayrıdır.
6. Aktif Pino `traceId`/`spanId` worker denemesinindir. Kaynak outbox `traceId` değeri log/span bağlamında `sourceTraceId` olarak kullanılır; aktif kimlik üzerine yazılmaz. `eventId`, consumer kimliği, job ID ve deneme bilgisi ilişkilendirmeye eklenir. Alanlar span adı, metric dimension veya Loki index label yapılmaz; span adları event türü/consumer gibi sınırlı sözlükten gelir. Success/no-op sonuçları metrik/span ile izlenir; her polling veya iş adımı için info log üretilmez.
7. Kaynak mutation audit'i kendi transaction'ında kaynak trace ID'yi, consumer'ın kendi mutation audit'i consumer trace ID'yi kaydeder. İş ilişkisi `eventId` ile kurulur; audit actor taşınmaz. Trace retention/sampling, audit veya inbox dayanıklılığının yerine geçmez.

```text
Trace A: HTTP → command → enqueue span → transaction commit
                              ⋮ link
Trace B: consumer / deneme 1 → command → DB / Redis / e-posta
                              ⋮ aynı kaynak span'e link
Trace C: consumer / deneme 2 → command → DB / Redis / e-posta
```

Span link modeli mesajlaşmada desteklenir. [OTel messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)

#### Sampling, işletim ve shutdown

[Collector config](docker/otel-collector/config.yml) `decision_wait: 30s` ile ERROR/slow/baseline tail sampling kullanır. Dakikalar sonra çalışan job'ı kaynak HTTP trace'ine eklemek, daha önce verilmiş drop kararına takılabilir. Bu nedenle her deneme ayrı root trace olur; mevcut `parentbased_always_on` SDK politikası değiştirilmez. Kaynak bağlamın sampled flag'i link metadata'sıdır, yeni root trace'in parent sampling kararı değildir. Collector yeni denemeyi kendi hata/gecikmesiyle değerlendirir; aynı trace'in span'leri aynı Collector'a yönlendirilir. Uzun çalışan denemenin kendisi yine karar penceresini aşabilir; worker timeout, Collector kapasitesi ve karar penceresi birlikte doğrulanır. [Tail sampling davranışı](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md)

Kaynak trace sampling/retention nedeniyle yoksa link onu geri getirmez. Grafana'da link gezintisi, `sourceTraceId`/`eventId` ile log arama ve aktif trace/log korelasyonu deployment kabul kriteridir. Queue bekleme süresi ayrı metrik olarak ölçülür; processing span süresine kuyrukta geçirilen saatler eklenmez. Trace hacmi fan-out × deneme sayısıyla bütçelenir. Tracing kapalı veya context eksikken de aynı teslimat/inbox davranışı çalışır; testlerde exporter'a ihtiyaç yoktur.

Mevcut `tracing.ts` SIGTERM/SIGINT'te SDK shutdown'ı hemen başlatır. Worker entegrasyonunda kapanış tek koordineli akışa alınır: yeni iş kabulünü durdur → aktif işleri deadline içinde drain et → DB/iş kaynaklarını kapat ve son span'leri bitir → OTel shutdown ve Sentry flush → process sonlandır. Exporter kapanışı worker drain ile yarışmaz; flush bütçeli olur ve süresiz shutdown bekletmez. SIGKILL için flush garantisi verilmez. API ve worker bootstrap'ında instrumentation import sırası ve process başına yeni `service.instance.id` korunur.

### RDS / Aurora

pg-boss DB server extension'ı değildir; normal PostgreSQL nesneleri kurar. RDS PostgreSQL/Aurora PostgreSQL için extension allowlist'ine bağlı özel pg-boss kurulumu gerektirmediği, kurulum modelinden çıkarımdır. Kesin engine sürümü, DDL hakları, TLS, failover ve migration çalışması hedef ortamda doğrulanır. [pg-boss kurulum](https://pgboss.io/install)

Gerçek extension'lar AWS'nin ürün/engine sürümü listesiyle sınırlıdır. Bu plan pg_cron, pgmq veya CDC extension'ı gerektirmez. [RDS extensions](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Extensions.html), [Aurora extensions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Extensions.html)

Producer enqueue, worker claim ve authoritative consumer okumaları writer/primary endpoint'e gider. Read replica kullanılmaz. RDS Proxy/başka pooler varsa transaction bağlantı pinning'i ve LISTEN desteği ayrıca doğrulanır; uyumsuzsa notification bağlantısı doğrudan kurulur veya polling kullanılır. Runtime rolü minimum haklı; migration/bakım rolü ayrı. Backup/PITR'da DB dışı etkiler geri alınmadığından restore sonrası notification replay ve inbox retention runbook'u zorunludur.

## 9. `suppressErrors: false` global olabilir mi?

Kurulu `@nestjs/event-emitter` tiplerinde `EventEmitterModuleOptions` içinde bu seçenek yok; `OnEventOptions` içinde var. Loader `options?.suppressErrors ?? true` kullanıyor. Bu nedenle `forRoot({ suppressErrors: false })` desteklenen global çözüm değildir. `ignoreErrors` başka bir EventEmitter davranışıdır, yerine geçmez. [Nest events dokümanı](https://docs.nestjs.com/techniques/events), [3.1.0 module options](https://github.com/nestjs/event-emitter/blob/3.1.0/lib/interfaces/event-emitter-options.interface.ts)

Projede çözüm zaten var: `OnAppEvent` merkezi wrapper'ı `OnEvent(event, { suppressErrors: false })` döndürüyor. Hedefli dispatch'e uyarlanırken bu politika korunacak. ESLint şu an `EventEmitter2` import'unu sınırlıyor, doğrudan `OnEvent` için aynı koruma yok; wrapper dışındaki import da engellenecek. Vendor patch/monkey patch yapılmayacak.

Yalnızca decorator yeterli değildir: handler ve worker bütün gerekli promise'leri await eder, `.catch(() => {})` kaldırılır. Bir job'ın consumer hatası pg-boss'a ulaşmalıdır. pg-boss callback'inde Nest listener kullanılmayan bir yol olursa `suppressErrors` o yola uygulanmaz; normal async rejection sözleşmesi geçerlidir.

## 10. Auth ve Redis kaynaklı event'ler

### Logout-all

Auth context event + `LOGOUT_ALL` audit kaydını aynı DB transaction'ında kabul ettirir. Owner consumer inbox üzerinden bir kez revocation yapar; kendi mutation audit'i ve reconciliation/notification işleri kendi transaction'ındadır. HTTP dokümanı “kalıcı kabul”ü açıkça anlatır; bütün session'ların anında silindiğini söylemez. Bu semantik fark rollout kapsamındadır.

### Refresh reuse

Mevcut Redis rotation Lua'sı reuse tespitinde session durumunu değiştirmiş olabilir. Ardından PG event + audit transaction'ı açılır; commit sonrası 401 üretilir. 401 exception'ı DB transaction callback'i içinden fırlatılıp event/audit rollback ettirilmez. PG kabulü başarısızsa kalıcı kabul iddiası yok; mevcut exception taxonomy'siyle availability hatası ele alınır, hata yutulmaz.

**Açık sınır:** Redis değişikliği ile PG commit arasında process çökerse pg-boss bunu tek başına kurtaramaz. Yalnızca PostgreSQL outbox eklemek bu güvenlik açığını çözmüş sayılmayacak.

Üretim öncesi ayrı güvenlik tasarımı gerekir: örneğin Lua ile aynı atomik işlemde sabit bir operation ID taşıyan recoverable reuse intent'i bırakmak ve idempotent olarak PG'ye aktarılana kadar tutmak. Böyle bir çözüm Redis persistence/recovery politikasına bağımlıdır ve yeni bir cross-store köprü getirir. Alternatif PG-authoritative session/intent tasarımı daha geniş kapsamlıdır. Hangisinin seçileceği Faz 8'de karar kaydı ve crash senaryolarıyla kapatılır; bu belge Redis/PG arasında dağıtık transaction vaat etmez. Kendi genel retry motorumuzu yazmama şartı korunur; bu özel kaynak yakalama açığı saklanmaz.

## 11. Commit edilebilir implementasyon aşamaları

Her satır kendi başına incelenebilir ve commit edilebilir bir iş paketidir. **Bağımsız commit, bağımsız deployment veya rastgele sırada uygulama demek değildir.** Bağımlılıklar aşağıda açık. Alt yapı commit'leri aktif akışları değiştirmeden eklenir; ara commit'lerde dual publish yapılmaz. Gerekli güvenlik/retention kapıları kapanmadan üretime açılmaz.

| Faz / önerilen commit                                               | Bağımlılık        | Kapsam ve somut çıktı                                                                                                                                                                                                                       | Bitiş/kabul ölçütü                                                                                                             |
| ------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1 — `docs: finalize durable delivery contracts and capacity limits` | Yok               | Kesin pg-boss sürümü; runtime/SWC uyumu; queue API ve kaynak kontrolü; retention/replay sayıları; arşiv gerekip gerekmediği; event/consumer envanteri ve şema/pool bütçesi. Gerekli dar rehber istisnalarını tanımla                        | Inbox/mail/Redis sınırları açık; bilinmeyen paket davranışları karar verilmiş. Paket prototipi gerekiyorsa ayrı doğrulama işi  |
| 2 — `feat: add context scoped transaction and audit participation`  | 1                 | Teknik transaction port/scope, primary transaction çözümleme ve audit adapter katılımı; standalone audit korunur                                                                                                                            | Commit/rollback scope'u kesin; cross-context DB mutation engeli; audit acceptance JSDoc'u doğru                                |
| 3 — `feat: add pg-boss storage and deployment migrations`           | 1                 | Bağımlılık/lockfile, teknik şemalar, one-off migration/queue provisioning, config validation, kontrollü pool lifecycle                                                                                                                      | API ve worker schema uyumunu kontrol edebilir; runtime DDL gerektirmez; henüz producer geçişi yok                              |
| 4 — `feat: add durable event acceptance and consumer routing`       | 2, 3              | Üç alanlı event ve ayrı opsiyonel telemetry kayıt sözleşmesi, eventType içinde sürüm, stable IDs, queue/consumer kataloğu, tek transaction'da bütün hedef enqueue, event-only API, audit+event API; gerekiyorsa minimal event/target arşivi | Payload/snapshot yok; partial fan-out ve missing route sessiz başarı değil; public port vendor bağımsız                        |
| 5 — `feat: add delivery workers retries and dead-letter policies`   | 4                 | Hedefli in-process dispatch, wrapper/ESLint kuralı, startup registration, pg-boss worker, retry/timeout/DLQ politikaları, temel error reporting                                                                                             | Bir consumer'ın hatası diğerini tekrarlatmaz; iş hatası pg-boss'a ulaşır; no-subscriber başarı yok                             |
| 5a — `feat: trace durable event delivery and consumer attempts`     | 4, 5              | Merkezi enqueue instrumentation; isteğe bağlı traceId/traceparent kaydı; izole consumer root span ve kaynak link; Pino/Sentry korelasyonu; retry/redrive metadata koruması                                                                  | Event sözleşmesi üç alan; telemetry opsiyonel; her deneme ayrı trace; context sızıntısı yok; mevcut CQRS span'leri child       |
| 6 — `feat: add transactional consumer inbox`                        | 2, 4              | User/Admin inbox tabloları ve portları; unique dedup + business transaction katılımı; replay retention kontrolü                                                                                                                             | Aynı event eşzamanlı işlendiğinde tek DB etkisi; rollback sonrasında yeniden deneme mümkün                                     |
| 7 — `feat: separate notification delivery from session revocation`  | 4, 5, 5a, 6       | User/Admin revoke komutlarına eventId; inbox + counter + audit + follow-up jobs atomik. Maili ayrı consumer'a çıkar; kimlik/ledger yolu ve aggregateId üzerinden güncel alıcı/içerik okuması                                                | Mail hatası counter'ı tekrar artırmaz; eski invite'ın güncel daveti gönderebilmesi açık; Gmail garantisi abartılmaz            |
| 8 — `feat: persist auth event requests and audit atomically`        | 4, 5, 6, 7        | Logout-all ve refresh-reuse durable acceptance; doğru transaction dışı 401; Bölüm 10 Redis capture/recovery kararının uygulanması veya açık release engeli                                                                                  | Grace 409, gerçek reuse ve logout semantiği korunur; Redis/PG crash boşluğu kapatılmadan güvenlik akışı tamamlandı denmez      |
| 9a — `feat: migrate user mutations to transactional outbox`         | 2, 4, 5, 6, 7     | User writer ve bütün ilgili handler'lar; audit tek commit; event pull güvenliği; cache/session listener geçişi                                                                                                                              | User tarafında doğrudan fire-and-forget kalmaz; no-op event/audit üretmez; password session sonucu korunur                     |
| 9b — `feat: migrate admin mutations to transactional outbox`        | 2, 4, 5, 6, 7     | Admin writer/handler/listener geçişi; invite/re-invite/activation dahil                                                                                                                                                                     | Admin tarafında aynı garantiler; pending/banned/deleted invite kontrolleri korunur. 9a'dan bağımsız commit edilebilir          |
| 10 — `feat: add delivery operations and retention controls`         | 5, 5a, 6, 7       | Sınırlı/dry-run replay komutu, native redrive adaptasyonu, operasyon audit'i, retention enforcement, alarmlar/dashboard, trace-link/log gezintisi, queue wait/processing ölçümleri ve recovery runbook                                      | Dead işler tespit ve kurtarılabilir; başarılı consumer'lar hedeflenmez; yaş sınırı ve notification belirsizliği kontrol edilir |
| 11 — `feat: support independent api and worker deployments`         | 3, 5, 5a, 10      | Bootstrap rolleri, readiness, koordineli drain → kaynak kapanışı → OTel/Sentry flush, container/ECS deployment sözleşmesi, bağlantı ve autoscaling bütçesi                                                                                  | Son iş span'leri SDK kapanmadan biter; flush bütçeli; çoklu instance/failover ve API-only enqueue doğrulanır                   |
| 12 — `refactor: remove legacy event delivery paths`                 | 8, 9a, 9b, 10, 11 | Eski emit sözleşmesi/uyumsuz yorumları kaldır; son rehber güncellemeleri; consumer kataloğu ve rollout belgesi                                                                                                                              | Tek publish yolu; eski/yeni producer dual publish yok; rollback planı pending işleri kaybettirmiyor                            |

Her fazda ilgili `AGENTS.md` / `agent/` kuralları yeniden değerlendirilir; yalnızca kalıcı mimari kurallar kendi bölümünde güncellenir. Bu plan değişiklik günlüğüne dönüştürülmez. Test yazma/çalıştırma, lint ve format için proje kuralına göre ayrıca açık istek gerekir; bugünkü belge isteği bunları çalıştırma yetkisi olarak yorumlanmaz. Aşağıdaki senaryolar gelecekte izin verilerek yapılacak doğrulamanın tasarımıdır. Doğrulanmamış faz üretime hazır diye raporlanmaz.

## 12. Doğrulama ve üretime çıkış kapıları

Mocks yalnızca port davranışı için yeterlidir. Atomiklik, queue recovery ve concurrency iddiaları gerçek PostgreSQL; session etkileri gerçek Redis ile sınanmalı. İlgili testler değişen fazla birlikte ayrı incelenebilir parça olarak hazırlanır; kritik doğrulama son refactor'a kadar ertelenmez.

| Senaryo                                               | Beklenen sonuç                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Mutation insert başarılı, audit insert hata           | Mutation ve bütün job'lar rollback                                                                                                         |
| Son hedef enqueue hata                                | Önceki hedefler dahil hiçbir job/mutation/audit commit olmaz                                                                               |
| Event-only kayıt                                      | Aggregate load/save olmadan, aggregateId taşıyan event'in kalıcı kabulü ve sonradan teslimi                                                |
| Minimal sözleşme                                      | Business event yalnız eventId, sürümlü eventType, aggregateId; ayrı opsiyonel telemetry kabul edilir; business payload/snapshot reddedilir |
| Teslimden önce aggregate değişmiş                     | Consumer güncel primary state'i kullanır; geçmiş state üretmez; cache eviction yalnız ID ile çalışabilir                                   |
| Aggregate yok / soft-delete / artık uygun değil       | Consumer'a özgü no-op veya güncel reconciliation; dependency hatası yokluk sayılmaz                                                        |
| Eski invite işi re-invite sonrasında çalışır          | Güncel uygunluk ve revocationVersion kullanılır; event'ler arasında generation dedup garantisi yok                                         |
| Commit öncesi worker çalışıyor                        | Uncommitted event görülmez                                                                                                                 |
| Commit sonrası API process ölür                       | Başka worker teslim eder                                                                                                                   |
| Consumer DB commit sonrası job completion öncesi ölüm | Inbox ikinci DB etkisini engeller                                                                                                          |
| Aynı event iki farklı job ID ile iki task'ta          | Aynı consumer için tek etki; farklı consumer'lar birbirini engellemez                                                                      |
| Inbox winner transaction rollback                     | Sonraki consumer işi gerçekleştirebilir                                                                                                    |
| Mail gönderimi hata                                   | Revocation tekrar uygulanmaz; sadece notification yeniden denenir                                                                          |
| Gmail kabulü sonrası timeout                          | Belirsiz durum politikası uygulanır; exactly-once iddiası yok                                                                              |
| Counter event'leri ters sırada                        | Redis floor düşmez; eski event eski sürümü geri yazmaz                                                                                     |
| Retry tükenmesi / desteklenmeyen eventType sürümü     | Kayıt ve hata DLQ/karantinada; alarm var                                                                                                   |
| Dead job redrive                                      | Mantıksal kimlik korunur; yalnızca hedef consumer denenir                                                                                  |
| Pending/DLQ retention sınırı                          | Desteklenen recovery penceresinde kayıp yok; arşiv kararı uygulanmış                                                                       |
| Task SIGTERM / SIGKILL / heartbeat kaybı              | Drain veya recovery; duplicate dış etkiler için korumalar geçerli                                                                          |
| RDS/Aurora writer failover                            | Reconnect ve kalıcı işlerin recovery'si; belirsiz commit yolu güvenli                                                                      |
| Yanlış registration / doğrudan OnEvent                | Startup/config kontrolü veya statik kural hata verir                                                                                       |
| Rolling deployment                                    | Eski worker desteklenmeyen eventType sürümünü başarılı tüketmez; yeni route'lar hazır olmadan producer açılmaz                             |
| Enqueue ve kaynak metadata                            | traceId/traceparent aynı geçerli enqueue span'inden; metadata bütün hedeflerle aynı transaction'da; rollback kalıcı iş bırakmaz            |
| Consumer ve command tracing                           | Processing root span altında CQRS ve I/O span'leri; pipeline'sız cache consumer da görünür                                                 |
| Retry / fan-out / redrive tracing                     | Ayrı deneme trace'leri aynı kaynak span'e link verir; event ve kaynak kimliği değişmez                                                     |
| Eşzamanlı iki worker işi                              | OTel/Sentry scope, log kimlikleri ve audit actor bağlamı diğer işe sızmaz                                                                  |
| Tracing kapalı / hatalı metadata                      | İş ve inbox garantileri aynı; gereksiz retry/DLQ yok; ham header loglanmaz                                                                 |
| Gecikmiş consumer hatası / sampling                   | Kaynak trace'in drop kararından bağımsız yeni deneme değerlendirilir; uzun iş/Collector penceresi doğrulanır                               |
| Log / audit korelasyonu                               | Aktif traceId consumer'a, sourceTraceId kaynağa ait; kaynak ve consumer audit'leri eventId ile ilişkili                                    |
| Grafana trace link / kaynak trace yok                 | Link ve log arama çalışır; saklanmayan kaynak trace için varlık garantisi verilmez                                                         |
| SIGTERM sırasında aktif iş                            | İş/DB span'leri SDK shutdown'dan önce biter; OTel/Sentry flush toplam stopTimeout'u aşmaz                                                  |
| Read/refusal audit                                    | Kaynak mutation transaction'ına yanlışlıkla bağlı değil; mevcut fail semantics korunur                                                     |
| Refresh grace / gerçek reuse crash noktaları          | 409/401 ve revocation davranışı belgelenen sınırla tutarlı                                                                                 |
| Restore + eski event replay                           | Inbox/mail retention ve dış etkiler runbook'u uygulanır                                                                                    |

Test altyapısı değişirken `test/shared/test-app.factory.ts` üretimle aynı bootstrap rol/seçeneklerini kullanmalı; queue worker'ları durdurulmadan DB temizlenmemeli. Beklemeler sabit sleep yerine bounded eventual assertion olmalı. E2E isolation event/inbox/job kayıtlarını kapsamalı. Mevcut Testing Rules'a göre `test/` boundary kuralları henüz tanımlı değil; test import tasarımında bu açık ayrıca dikkate alınır.

Üretim kapıları: hedef yük ve gecikme SLO'su ölçülmüş; retention/replay rakamları kesinleşmiş; Redis reuse capture kararı kapanmış; Gmail duplicate toleransı veya sağlayıcı değişikliği açık; DLQ alarmı ve runbook denenmiş; trace link/log korelasyonu, context izolasyonu ve drain sonrası flush doğrulanmış; kill/failover ve rolling upgrade doğrulanmış. Bunlar sağlanmadan “kurumsal ölçekte hazır” denmez.

## 13. Gelecekte RabbitMQ adaptasyonu

Producer aynı yerel transaction'da audit ve broker-publish job'ını kaydeder. pg-boss worker persistent mesajı doğru exchange/route'a yollar, publisher confirm'i bekler; unroutable mesajı da başarısız teslim sayar. Confirm consumer completion değildir. Consumer kendi DB/inbox commit'inden sonra ack verir. [RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms)

Alternatif ingress: RabbitMQ consumer'ı dedup + yerel pg-boss enqueue'yu tek transaction'da kaydeder, sonra ack verir; iş etkisini yerel worker yapar. Receipt dedup ile business completion inbox'ı farklı aşamalardır; “mesaj alındı” kaydı “iş yapıldı” yerine kullanılmaz.

RabbitMQ'ya geçiş yalnızca config değişikliği diye sunulmaz: broker topology, publisher confirms/returns, reconnect, consumer ack, versioned network envelope ve bağımsız DB'ler eklenir. Domain/application iş kuralları ve kalıcı kabul sözleşmesi korunur. Lokal consumer job'ları ile broker publish'in aynı anda aynı iş etkisini üretmesi migration sırasında engellenir; pending işler drain edilir veya kimlikleri korunarak taşınır.

Network üzerindeki event de yalnızca `eventId`, sürümlü `eventType`, `aggregateId` taşır. Broker routing/trace header'ları transport sorumluluğudur. Bölüm 8.1'deki kalıcı kaynak bağlamı broker-publish worker'ının trace'ine link verir; outbound traceparent aktif publish span'inden OTel ile header'lara enjekte edilir. Network consumer ayrı processing trace'iyle bu publish span'ine link verir. Kaynak outbox metadata'sı değiştirilmez; gerektiğinde kaynak traceId ayrı korelasyon header'ında korunur. Yerel enqueue yapan ingress, yeni enqueue span'inin bağlamını kaydeder; business eventId sabit kalır. Consumer başka servisin DB'sini doğrudan okumaz; mevcut consumer-owned port'un adapter'ı owner servisin authoritative okuma API'sine geçer. Owner erişilemiyorsa okuma retry edilir; stale cache ile iş kararı verilmez. Bu tercih servisler arasında okuma anında erişilebilirlik bağımlılığı getirir; payload'sız event bu bağımlılığı kaldırmaz. Owner kendi state'ini işleyen consumer'ı mümkün olduğunca kendi servisinde tutar; gerekli remote read sözleşmeleri extraction aşamasında hazırlanır.

Her servis kendi audit tablosuna yerel mutation transaction'ında yazar. Merkezi audit toplama/taşıma bu planın parçası değildir.
