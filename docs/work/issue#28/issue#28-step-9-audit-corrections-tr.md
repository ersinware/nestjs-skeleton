# Issue #28 — Adım 9: Audit Bulguları ve Düzeltmeler

## Kapsam

Adım 1–8 kararları mevcut source ile yeniden doğrulandı. Yalnız doğrulanmış Issue #28 bulguları uygulandı. Regression kanıtı [Adım 10](issue%2328-step-10-regression-coverage-tr.md) kapsamında tutulur.

## Sınıflandırma

| Kategori                                              | Doğrulanmış bulgu                                                                         | Adım 9 sonucu                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wrong transactional mode`                            | Yok                                                                                       | 4 transactional ve 16 non-transactional consumer mode'u korundu.                                                                                  |
| `wrong join()/start()`                                | Yok                                                                                       | Mevcut boundary'ler korundu.                                                                                                                      |
| `long transaction`                                    | Yok                                                                                       | Transactional revocation path'leri kısa PostgreSQL işi olarak kaldı.                                                                              |
| `external effect inside transaction`                  | Yok                                                                                       | Yeni follow-up job dönüşümü yapılmadı.                                                                                                            |
| `wrong post-commit ordering`                          | Yok                                                                                       | Avatar reconciliation sırası korunarak #30 kapsamına dokunulmadı.                                                                                 |
| `unsafe retry`                                        | Sekiz email path'i; iki avatar replace path'i #30                                         | Email logical identity/payload-conflict davranışı düzeltildi. Avatar replace remediation'ı yapılmadı.                                             |
| `missing idempotency`                                 | Email provider identity logical delivery ile aynı değildi                                 | Provider key `${queueName}/${deliveryId}` oldu.                                                                                                   |
| `missing deduplication`                               | Provider retention'ı aşan kalıcı dedup yok                                                | Ledger/deadline eklenmedi; at-least-once delivery seçimi gereği retention sonrası duplicate-send riski kabul edildi.                              |
| `email logical-delivery payload drift`                | Confirmation name; refresh-reuse recipient/name                                           | Confirmation ve refresh-reuse isimli hitabı immutable `recipientName` job payload'ını kullanır; refresh-reuse adresi de payload'da sabittir.      |
| `incorrect provider idempotency identity`             | Key payload hash içeriyordu                                                               | `contentHash` kaldırıldı.                                                                                                                         |
| `incorrect provider retry classification`             | `invalid_idempotent_request` normal retry'a giriyordu                                     | Adapter conflict'e çevirir; queued email boundary `TerminalJobException` üretir. `concurrent_idempotent_requests` retryable kalır.                |
| `provider-retention / delayed-redrive duplicate risk` | Sekiz email path'inin tamamında provider retention sonrası duplicate physical send mümkün | Redrive engellenmedi; exactly-once iddiası yapılmadan risk açıkça sınırlandı.                                                                     |
| `incorrect authoritative-state handling`              | Yok                                                                                       | Aktivasyon/davet/confirmation eligibility read'leri korundu; refresh-reuse bildirimi immutable event-time adresine gönderilir.                    |
| `unjustified workerOptions`                           | Serbest polling sayıları canonical profile policy'siyle uyumsuzdu                         | 20 consumer canonical profile'a bağlandı; final concurrency/batch değerleri aşağıdadır.                                                           |
| `missing / incorrect LISTEN-NOTIFY dispatch`          | Instance listener, custom DB listener ve queue `notify` reconciliation yoktu              | Listener/reconnect/close desteği, `useListenNotify`, queue drift reconciliation ve notify backstop eklendi; listener observability #31'e ayrıldı. |
| `unsafe or unbounded batch parallelism`               | Yok                                                                                       | Sequential batch processing korundu; generic parallelism eklenmedi; transactional batch değeri `1` kaldı.                                         |

## Final workerOptions

Değerler process başınadır; batch içi execution sequential kalır.

| Consumer grubu                         | `localConcurrency` | `batchSize` | Profile    |
| -------------------------------------- | -----------------: | ----------: | ---------- |
| User/Admin Session                     |                  2 |           5 | `critical` |
| Dört transactional Revocation consumer |                  2 |           1 | `critical` |
| User Cache                             |                  2 |          10 | `high`     |
| User Activation                        |                  2 |           5 | `medium`   |
| Dört Avatar consumer                   |                  2 |           1 | `medium`   |
| User/Admin EmailConfirmation           |                  2 |           5 | `medium`   |
| Admin Invite                           |                  1 |           5 | `low`      |
| User/Admin RefreshReuseNotice          |                  1 |           5 | `low`      |
| User/Admin EmailChangeNotification     |                  1 |           5 | `low`      |
| DeadLetterRedrive                      |                  1 |           1 | `low`      |

Toplam 34 worker/process; transactional üst sınır `8 × replica sayısı`dır. Mevcut `JOB_QUEUE_POOL_SIZE=20` içinde listener için bir bağlantı ayrılır; polling/completion/maintenance ve diğer DB işleri de kapasite kullanır. Bu ayarlar üretim kapasitesi veya provider rate-limit garantisi değildir; peak replica/deploy overlap ile yük testi gerekir.

Profile/polling, LISTEN/NOTIFY, transaction mode ve retry/idempotency sözleşmeleri değişmez. Avatar tuning'i Issue #30 remediation'ı değildir.

## Dispatch sonucu

Profil aralıkları ve notify-only kararı [planda (Adım 2)](issue%2328-queue-consumer-transaction-retry-safety-plan-tr.md) açıklanır. Worker queue'ları `notify: true`, storage-only DLQ `notify: false` olarak reconcile edilir.

pg-boss listener handle'ını bağlantı kaybında korur. Subscription ilk LISTEN hatasında da reconnecting handle döndürür; native notify backstop polling devam eder. Listener kesintisinde bu gecikme kabul edilir; özel outage timer'ı veya worker fallback kaydı yoktur. Initial failure, live disconnect ve reconnect testleri bu karara uyarlandı ve gerçek PostgreSQL E2E çalışmasında doğrulandı.

Adım 2 correction listesindeki `listen_notify_unavailable` warning observability kararı kullanıcı review'unda ertelendi. Bu warning için application log handler'ı eklenmez; listener health, OTel export, Grafana alarmı ve ilgili diagnostic/error-reporting davranışı [Issue #31](https://github.com/ersinware/nestjs-skeleton/issues/31) kapsamında uygulanacaktır.

## Email sonucu

User/admin confirmation ve refresh-reuse job'ları üretim anındaki ismi zorunlu `recipientName` payload'ında taşır. Handler isimli hitabı bu sabit değerden üretir ve HTML escape uygular; güncel profil ismi retry içeriğini değiştirmez.

Refresh-reuse bildirimleri ayrıca zorunlu `recipientEmail` job payload'ını kullanır; güncel hesap okuması veya adres fallback'i yoktur. Hesabın sonradan silinmesi, commit edilmiş güvenlik bildiriminin gönderilmesini engellemez.

```text
same logical delivery
→ same deliveryId
→ same provider key

same key + different payload
→ ResourceConflictException
→ TerminalJobException
→ normal retry yok, shared DLQ

concurrent_idempotent_requests
→ DependencyUnavailableException
→ normal retry
```

Yeni logical email üreticileri mevcut domain davranışında yeni `deliveryId` üretmeye devam eder. Provider retention sonrasındaki delayed retry/redrive aynı identity ile yeniden denenir; application-level kalıcı dedup eklenmediğinden duplicate physical email mümkün ve at-least-once modelinde kabul edilen risktir.

## Kapsam dışı bırakılan bulgu

`UserAvatarReplaceConsumer` ve `AdminAvatarReplaceConsumer` için `SUPERSEDED` cleanup + replayable upload-proof race'i değiştirilmedi. Ownership Issue #30'da kalır.

## Acceptance sonucu

- [x] Audit ile doğrulanan retry, worker profile, provider identity/classification ve dispatch configuration problemleri düzeltildi.
- [x] Immediately-available worker queue'ları `LISTEN/NOTIFY` wake-up ve native bounded backstop polling kullanacak şekilde yapılandırıldı.
- [x] Transaction mode, transaction boundary, effect ordering ve batch parallelism alanlarında doğrulanmamış değişiklik yapılmadı.
