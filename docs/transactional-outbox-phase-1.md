# Kalıcı event teslimatı: Faz 1 kararları

[Implementasyon planının](../transactional-outbox-implementation-plan.md) Faz 1 kararları. Outbox henüz uygulanmadı; kapasite sayıları ölçülmemiş başlangıç bütçeleridir.

## 1. Paket ve runtime kararı

- **pg-boss 12.31.1**; Faz 3'te exact dependency ve lockfile. Sürüme bağlı davranışlarda bu tag esas alınır: ESM, Node `>=22.12.0`, şema 41. [Paket bildirimi](https://github.com/timgit/pg-boss/blob/12.31.1/package.json)
- Runtime hedefi CI ile aynı Node 24. [Nest SWC](../nest-cli.json) CommonJS çıktısı korunur; infrastructure named `PgBoss` / `fromDrizzle` import eder. Senkron ESM yüklemesi bağımlılık ağacında top-level await olmamasını gerektirir. Faz 3'te kilitli bağımlılıklar, gerçek SWC çıktısı ve production container ile yükleme/Drizzle uyumu doğrulanmadan faz kapanmaz. [Node yükleme sözleşmesi](https://nodejs.org/docs/latest-v22.x/api/modules.html#loading-ecmascript-modules-using-require)
- Yerel/CI PostgreSQL hedefi [18.4](../docker-compose.yml); pg-boss için PostgreSQL eklentisi kurulmaz. Faz 3/11'de RDS/Aurora engine, writer endpoint, DDL yetkileri ve failover ayrıca doğrulanır.

## 2. Kullanılacak paket sözleşmeleri

| Alan         | Karar                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomik kabul | Her hedef için `send(queue, delivery, { db: fromDrizzle(tx, sql) })`; mutation ve audit ile aynı primary transaction. `null` sonucu beklenen bir dedup başarısı değildir: bütün kabul rollback olur. |
| Kuyruk       | `standard`; singleton/debounce, pub/sub, cron, flow, LISTEN/NOTIFY ve FIFO kullanılmaz. İhtiyaç consumer idempotency'siyle karşılanır.                                                               |
| Dispatch     | Her queue tek sabit consumer'a ait; eventType o consumer'ın desteklediği sözleşmelerden biri olmalı. İlk worker `batchSize: 1` kullanır; tek işin hatası başka işi tekrar ettirmez.                  |
| Retry        | Native `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`; claim ve recovery için özel SQL/timer motoru yok.                                                                                |
| İş ömrü      | `expireInSeconds`/heartbeat terk edilmiş işi kurtarır; dış çağrıyı fiziksel olarak durdurduğu varsayılmaz. I/O timeout ve iş bütçesi ayrıca uygulanır.                                               |
| DLQ          | Her source queue için ayrı DLQ; DLQ önce provision edilir ve normal worker dinlemez. Başarısız source kaydı ve DLQ verisi operasyon için tutulur.                                                    |
| Redrive      | Native `redrive`, doğru source consumer'a; yeni job ID mümkündür, eventId ve kaynak telemetry korunur. Redrive yaş kontrolü operasyon adapter'ında.                                                  |
| Migration    | Yalnız deployment migration işi DDL çalıştırır. API/worker `migrate: false`; startup schema kontrolü hatasında readiness açılmaz. Async migration işleri de bitmeden rollout tamamlanmaz.            |
| Çalıştırma   | Aynı NestJS process’inde API enqueue + consumer’lar + supervision; `supervise: true`, `schedule: false`, `useListenNotify: false`. Ayrı worker deployment yok.                                       |

Enqueue için resmi parametreli Drizzle adapter kullanılır. [12.31.1 Drizzle adapter](https://github.com/timgit/pg-boss/blob/12.31.1/src/adapters/drizzle.ts), [transaction API](https://pgboss.io/api/adapters)

`migrate: false` schema kontrolünü korur; constructor `db` adapter'ı ortak pool kullanımını sağlar. [12.31.1 yaşam döngüsü](https://github.com/timgit/pg-boss/blob/12.31.1/src/index.ts), [schema kontrolü](https://github.com/timgit/pg-boss/blob/12.31.1/src/contractor.ts)

Native retry jitter içerir. Cleanup, süresi dolan pending/retry job'ı DLQ'ya taşımadan silebilir. DLQ/redrive zamanı ilk kabul zamanı değildir. [12.31.1 SQL](https://github.com/timgit/pg-boss/blob/12.31.1/src/plans.ts)

## 3. Event ve consumer kataloğu

Event `{ eventId, eventType, aggregateId }`; ayrı opsiyonel telemetry `{ traceId, traceparent }`. Aşağıdaki `.v1` adları Faz 4/producer geçişlerinde uygulanacak, şu anki enum değerleri değildir. Queue adı sabit consumerId ile aynıdır; DLQ adı `<consumerId>.dlq`. Aynı consumer'a giden birden çok eventType aynı queue'yu kullanır.

| Producer şeması  | Kalıcı eventType                                                                                                                | ConsumerId                                          | Etki / tekrar koruması                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `user_delivery`  | `user.updated.v1`, `user.unbanned.v1`                                                                                           | `user.cache.invalidate`                             | Cache delete; inbox yok                                                       |
| `user_delivery`  | `user.banned.v1`, `user.deleted.v1`, `user.permissions_changed.v1`                                                              | `user.cache.invalidate` ve `user.session.reconcile` | İki atomik job; delete ve güncel primary sürümün Redis max-write'ı; inbox yok |
| `user_delivery`  | `user.password_changed.v1`, `user.sessions_revoked.v1`                                                                          | `user.session.reconcile`                            | Güncel session floor; inbox yok                                               |
| `admin_delivery` | `admin.banned.v1`, `admin.deleted.v1`, `admin.permissions_changed.v1`, `admin.password_changed.v1`, `admin.sessions_revoked.v1` | `admin.session.reconcile`                           | Güncel session floor; inbox yok                                               |
| `admin_delivery` | `admin.invited.v1`                                                                                                              | `admin.invite.send`                                 | Güncel uygunluk/token/alıcı; gönderim ledger'ı, Gmail duplicate toleransı     |
| `auth_delivery`  | `user.refresh_reuse_detected.v1`, `user.logout_all_requested.v1`                                                                | `user.session.revoke`                               | User inbox + counter + audit + follow-up enqueue                              |
| `auth_delivery`  | `admin.refresh_reuse_detected.v1`, `admin.logout_all_requested.v1`                                                              | `admin.session.revoke`                              | Admin inbox + counter + audit + follow-up enqueue                             |
| `user_delivery`  | `user.security_notice_requested.v1` (yeni, Faz 7)                                                                               | `user.security-notice.send`                         | Yalnız reuse sonrası; güncel alıcı, gönderim ledger'ı                         |
| `admin_delivery` | `admin.security_notice_requested.v1` (yeni, Faz 7)                                                                              | `admin.security-notice.send`                        | Yalnız reuse sonrası; güncel alıcı, gönderim ledger'ı                         |

Kaynak envanter: [User event enum](../src/module/user/domain/event/user-event.enum.ts), [Admin event enum](../src/module/admin/domain/event/admin-event.enum.ts), [User auth event'leri](../src/shared/domain/user/event/user-integration-event.enum.ts), [Admin auth event'leri](../src/shared/domain/admin/event/admin-integration-event.enum.ts); [User listener'ları](../src/module/user/application/event), [Admin listener'ları](../src/module/admin/application/event).

**Hedefsiz event'ler:** Consumersız `admin.updated` ve `admin.unbanned` üretimi Faz 9b'de kaldırılır; mutation/audit korunur. Diğer bilinmeyen/hedefsiz event kabulü hatadır; event üretmeyen işlemlere sırf outbox için event eklenmez.

Toplam **8 source queue + 8 DLQ**, üç producer şemasına dağılır: user 3+3, admin 3+3, auth 2+2. Auth şemasındaki worker'ın User/Admin komutunu çalıştırması, auth business transaction'ına katılım değildir; consumer kendi owner transaction'ını açar.

## 4. Retention ve recovery kararı

**Ayrı event arşivi yok.** Source/DLQ süreleri açıkça yapılandırılır:

| Sınır                                   | Başlangıç kararı                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Desteklenen worker/dependency kesintisi | 24 saat                                                                                                |
| Operatör müdahalesi                     | Alarmdan itibaren en geç 24 saat                                                                       |
| Tek retry turu bütçesi                  | Denemeler ve beklemeler toplamı en fazla 24 saat; Faz 5'in sayısal retry ayarları bu sınırı sağlayacak |
| Yeni manuel replay başlatma             | İlk kalıcı kabule göre en fazla 7 gün (604800 saniye)                                                  |
| Pending/retry ve DLQ retention          | `retentionSeconds: 2592000` (30 gün)                                                                   |
| Source/DLQ terminal retention           | `deleteAfterSeconds: 2592000` (tamamlanmadan itibaren 30 gün)                                          |
| Inbox ve notification dedup             | Başarılı etki kaydından itibaren en az 30 gün; çözülmemiş gönderim kayıtları otomatik silinmez         |
| Yaş alarmı                              | Çözülmemiş işler 24 saatte kritik; 7 günde normal replay kapısı kapanır, reconciliation gerekir        |

Kesinti + müdahale + retry bütçesi 3 gün; replay penceresi 7 gün, fiziksel saklama 30 gündür. Güvenlik gecikme hedefi Bölüm 5'tedir.

Faz 10 operasyon audit'i ilk kabul zamanı, eventId, consumerId ve eski/yeni job kimliklerini en az 30 gün ilişkilendirir. İlk DLQ source bilgisinden, sonraki redrive'lar bu zincirden yaşını çözer; zincir eksikse redrive reddedilir. Event envelope genişlemez; business consumer audit'ten state okumaz.

7 günden sonra yeni replay yerine reconciliation gerekir; mevcut native retry ve dedup sürer. Tamamlanmış işi yeniden gönderme, yeni eventId ile replay ve doğrudan vendor tablo düzenleme desteklenmez. 30 günü aşan kesintide kayıt kaybı mümkündür; daha uzun recovery ihtiyacı arşiv kararını yeniden açar. DB restore dış e-posta etkisini geri almaz.

## 5. Pool ve kapasite bütçesi

Her uygulama instance’ı API ve bütün consumer’ları tek NestJS process’inde çalıştırır. API ve consumer DB işlemleri mevcut business pool’u paylaşır. Üç schema instance'ı **process başına tek delivery pool** kullanır (`db.executeSql`). Enqueue, Faz 2'nin primary transaction'ını `send` çağrısına geçirir. Altyapı bütün boss instance'larını durdurduktan sonra ortak pool'u bir kez kapatır.

| Girdi                                   | Başlangıç bütçesi                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Primary business pool / process         | Mevcut `.env.example` değeri 25                                                                                                    |
| Delivery pool / process                 | 5 bağlantı; Faz 3'te ayrı doğrulanmış konfigürasyon                                                                                |
| Replica pool                            | Process başına `DATABASE_REPLICA_POOL_SIZE` (`.env.example`: 10); verilmezse `DATABASE_POOL_SIZE`. Primary alias ise yeni pool yok |
| Aktif job / uygulama process’i          | Başlangıçta her source queue için 1, toplam en fazla 8; ayrı notification queue'ları korunur                                       |
| Tasarım yükü                            | Sürekli 10, 5 dakikalık burst 50 logical event/s; en fazla 2 source delivery/event. Follow-up notification ayrıca sayılır          |
| Sağlıklı bağımlılıklarda gecikme hedefi | Güvenlik/cache enqueue→completion p99 ≤5 s; notification p99 ≤60 s; ölçülene kadar SLO sağlandı denmez                             |

Primary bağlantı üst sınırı: `eşzamanlı uygulama process sayısı × (DATABASE_POOL_SIZE + delivery pool limiti) + migration ve diğer istemciler`. Process sayısı rolling deployment örtüşmesini de kapsar. Örneğin 4 uygulama process’i ve 25+5 limitleriyle uygulama toplamı en fazla 120 bağlantıdır; bu ölçülmüş ihtiyaç veya başlangıçta açılan bağlantı sayısı değildir. API/consumer veya kuyruk sayıları ayrıca çarpılmaz. Ayrı replica sunucusunun bütçesi ayrı hesaplanır; aynı sunucuya yönelen ek pool’lar o sunucunun toplamına eklenir. DB limitinin en az %20’si ayrılır.

10 event/s × 2 delivery × 30 gün ≈ **51,84 milyon source job**; follow-up, DLQ ve indeks maliyeti eklenir. Faz 3 storage/index/vacuum, Faz 11 yük/backlog drain, CPU/I/O ve Gmail quota doğrulamasını kapsar. Bütçe yetmezse retention sessizce azaltılmaz; kapasite/arşiv kararı yeniden değerlendirilir.

Pool timeout'ları [database pool factory](../src/core/database/database-pool.factory.ts) politikasıyla uyumlu olur. Bağlantı yalnız kısa DB işlemlerinde tutulur; supervision ve business transaction'ları ayrı bounded pool'larda ilerler. Autoscaling DB bütçesiyle sınırlanır.

## 6. Sonraki faz ve doğrulama

Sonraki iş Faz 2: context-scoped transaction ve audit katılımı. Atomiklik, inbox/Gmail sınırları ve Faz 8'in Redis reuse capture engeli için [ana plan](../transactional-outbox-implementation-plan.md) geçerlidir. Reuse ayrı notification üretir; logout-all mail üretmez.

Kaynak/config incelemesi yapıldı; test, lint, format, build veya entegrasyon deneyi çalıştırılmadı. Runtime, kapasite ve failover kabulü ilgili fazlarda doğrulanmalıdır.
