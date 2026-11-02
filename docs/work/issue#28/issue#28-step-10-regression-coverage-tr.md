# Issue #28 — Adım 10: Regression ve Failure-Path Testleri

## Kapsam ve sınırlar

Deploy yapılmadığından eski payload formatı için geriye dönük uyumluluk kapsam dışıdır. Avatar `SUPERSEDED` cleanup / replayable upload-proof remediation'ı Issue #30'da, listener health/telemetry çalışması Issue #31'de kalır.

Unit testleri port sınırlarını; E2E testleri gerçek PostgreSQL, pg-boss ve uygulama wiring'ini kullanır. Email provider sınırı test içinde modellenir; gerçek Resend'e gönderim yapılmaz. Retention testi provider saatini ilerletir; uygulama veya PostgreSQL saatini değiştirmez.

## Senaryo eşlemesi

| Garanti                                                                   | Test kanıtı                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB işi başarılı → completion hatası → rollback → retry                    | `test/core/job-queue/transactional-consumer.e2e-spec.ts`: gerçek completion SQL'i çalıştıktan sonra hata; mutation, follow-up ve completion rollback; sonraki attempt tek mutation ve tek follow-up ile tamamlanır.                                  |
| Follow-up + business mutation + completion atomicity                      | Aynı E2E dosyasında callback hatası, deferred constraint ile commit hatası, terminal transactional hata ve başarılı commit. Auth revocation E2E'sinde dört gerçek owner path'i ve follow-up payload'ları.                                            |
| External effect başarılı → completion hatası → retry                      | `test/module/email-change/email-delivery-retry.e2e-spec.ts`: provider kabulünden sonra settlement hatası, aynı key/payload ile retry, retention içinde tek fiziksel email.                                                                           |
| Retry exhaustion → shared DLQ                                             | Transactional consumer E2E, email-delivery retry E2E ve mevcut email-change E2E'deki bir retry sonrası tükenme.                                                                                                                                      |
| DLQ/redrive logical identity, değişen physical ID, worker restart         | Email-delivery retry E2E: worker durdurulur, DLQ redrive edilir, yeni physical ID ve aynı `deliveryId`/payload doğrulanır; production worker yeniden başlatılır.                                                                                     |
| Commit-dependent cleanup                                                  | Admin/User `replace-*-avatar/handler.spec.ts`: başarılı callback sonrası commit bekletilir; commit öncesinde silme yoktur. Commit hatasında da cleanup başlamaz. Gerçek transaction commit/rollback davranışı transactional consumer E2E'de sınanır. |
| Bağımsız batch settlement ve sequential execution                         | `job-queue-feature.module.spec.ts`: ilk job beklerken sonraki başlamaz; completed/failed/deadletter/completed sonuçları korunur. Transactional consumer E2E aynı mixed batch'in kalıcı state'lerini doğrular.                                        |
| Transactional `batchSize: 1` ve notify topology                           | Feature unit testi geçersiz batch'i worker başlamadan reddeder. Email-delivery E2E gerçek DI kaydındaki 20 consumer'ı, dört transactional batch'i ve queue `notify` değerlerini denetler.                                                            |
| LISTEN/NOTIFY immediate wake-up                                           | `test/core/job-queue/notification-dispatch.e2e-spec.ts`: idle fetch sonrasında 30s backstop beklenmeden teslim.                                                                                                                                      |
| Missed notification → safety-net polling                                  | Aynı E2E dosyasında notification callback'i düşürülür; healthy listener base timer üretmez, backstop teslimi kurtarır.                                                                                                                               |
| Initial listener unavailable ve sonradan listener kaybı → native backstop | Aynı E2E dosyasında gerçek LISTEN SQL hatası ve `pg_terminate_backend`; notify backstop teslimi kurtarır, reconnect session'ı yeniler.                                                                                                               |
| Multi-node notification → tek claim                                       | Aynı E2E dosyasında iki bağımsız pg-boss node'u bildirimi alır; bir job tek kez işlenip tamamlanır.                                                                                                                                                  |
| Listener lifecycle                                                        | Subscription unit testleri: bir pinned session, callback forwarding, capped reconnect, initial failure recovery, close/idempotent release ve in-flight acquisition sonrası shutdown.                                                                 |
| Canonical worker polling profilleri                                       | Feature unit testleri dört profilin notify backstop aralıklarını ve ayrı base polling override'ı verilmediğini denetler.                                                                                                                             |
| Same delivery + same payload → same key; new logical delivery → new key   | Email adapter unit ve email-delivery E2E testleri. Admin/User aggregate testleri yeni logical email için yeni `deliveryId` üretimini doğrular.                                                                                                       |
| Payload drift → aynı key + terminal conflict                              | Adapter unit testi gerçek SDK üzerinden key'in değişmediğini; sekiz email handler unit testi conflict→terminal dönüşümünü; Admin/User email-delivery E2E retry yapılmadan DLQ settlement'ı doğrular.                                                 |
| Concurrent idempotency conflict → retry                                   | Adapter unit, sekiz handler'ın transient propagation testleri ve Admin/User email-delivery E2E aynı kimlikle başarılı retry'ı doğrular.                                                                                                              |
| Mutable recipient drift ve authoritative state                            | Dört consumer'ın validation unit testleri; confirmation/refresh-reuse handler unit testleri; aggregate payload testleri; email-change E2E'de profil değişiminden sonra aynı body/JWT; Auth revocation E2E'de committed event-time recipient.         |
| Provider retention sonrası delayed redrive stratejisi                     | Email-delivery E2E: retention sonrasında redrive engellenmez, aynı identity/payload yeniden denenir ve ikinci physical send mümkün kalır. Seçilen at-least-once stratejisi budur; kalıcı ledger veya exactly-once garantisi eklenmez.                |

## Testlerin gerektirdiği düzeltmeler

- Listener kesintisinde native `notifyPollingIntervalSeconds` backstop gecikmesi kabul edilir; özel queue timer'ları ve adapter fallback kaydı kaldırıldı. Initial LISTEN hatasında reconnecting handle ve bounded reconnect korunur.
- Transactional consumer için `batchSize: 1` invariant'ı worker kaydından önce doğrulanır.
- Eski hash içeren email key ve serbest polling interval test beklentileri yeni contract'a uyarlandı.

## Doğrulama

2026-11-02 tarihinde notify-only revizyonu sonrası yeniden çalıştırıldı. İlk E2E çalışmasında iki testin `1s` notify ayarı, pg-boss'un varsayılan `2s` base aralığından küçük olduğu için reddedildi. Testler `2s` notify aralığına uyarlandı; live-disconnect testinde reconnect wake-up callback'i bastırılarak native backstop teslimi ayrı doğrulandı. Üretim profilleri `5s` ve üzerindedir; bu test düzeltmesi üretim ayarlarını değiştirmedi.

- `npm run format`: başarılı.
- `npm run lint:fix`: başarılı.
- `npm run test:type`: başarılı.
- `npm run ci:local`: exit `0`; Quality, unit coverage, build ve E2E job'ları başarılı. Publish job'ı pull-request event'inde çalışmadı.
- Unit: 90 dosya, 1.144 test başarılı.
- E2E: 22 dosya, 432 test başarılı; workflow kendi PostgreSQL/Redis/SeaweedFS servislerini kurup temizledi.
- Spectral contract lint başarılı; Schemathesis 49 operation için 6.846 case üretti, tamamı geçti. Authenticated fixture içermeyen generated case'ler için authentication, missing-data ve schema-mismatch uyarıları sürdü; business davranışı yukarıdaki unit/E2E testleriyle doğrulandı.

E2E çalışması gerçek Resend veya AWS acceptance yerine geçmez. Mevcut SeaweedFS conditional multipart completion sınırlaması ayrıca test çıktısında belirtilir; Issue #28 düzeltmesi değildir.

- [x] Corrected/high-risk transaction ve retry-safety path'leri regression kapsamındadır.
- [x] Retry exhaustion, DLQ/redrive logical identity ve seçilen delayed-redrive davranışı doğrulandı.
- [x] Notify-only revizyonunda immediate notification, missed-notification backstop, initial/live listener backstop ve multi-node claim yeniden doğrulandı.
