# Faz 3 — pg-boss storage ve deployment migration

İlk storage/migration sürümü yerel PostgreSQL ve production imajında doğrulandı; aşağıdaki sonuçlar güncel kodun doğrulaması değildir. Producer hâlâ `emitAsync` kullanır; kalıcı yayınlama API’si [Faz 4’te](transactional-outbox-phase-4.md) uygulandı, consumer/retry politikaları Faz 5’tedir.

## Kurulan yapı

- `pg-boss` package/lockfile’da exact `12.31.1`. Hedef Node 24, PostgreSQL 18.4.
- [Teknik topoloji üretimi](../src/core/event-bus/delivery-topology.util.ts): `user_delivery`, `admin_delivery`, `auth_delivery`; şu anda 6 source queue + 6 DLQ. Yalnızca modüllerin route hedeflerinden türetilir; Faz 7’de iki mail kuyruğu ve DLQ’ları eklenir; deployment giriş noktası `src/script/job-queue-migration.ts` aynı tanımları kullanır.
- `standard`, partition/notification kapalı; pending ve terminal retention ayrı ayrı 30 gün. Retry/timeout politikaları Faz 5’te açıkça atanacak; bu fazda job gönderilmez.
- [JobQueueAdapter](../src/core/job-queue/adapter/job-queue.adapter.ts): üç PgBoss nesnesi aynı primary endpoint’te tek pool kullanır. `DELIVERY_POOL_SIZE` varsayılanı 5; bağlantı timeout’ları mevcut `DATABASE_*` ayarlarından gelir. Business pool ve replica değişmez.
- Startup `migrate: false` ile sürümü; ayrıca eksik background migration, kuyruk, DLQ bağlantısı ve retention ayarlarını kontrol eder. Uyumsuzlukta HTTP dinlemeye başlamaz. `supervise: true`, `schedule: false`, `useListenNotify: false`, `reindex: false`; runtime DDL çalıştırmaz.
- PgBoss error/warning listener’ları start öncesinde bağlanır. Delivery bağlantı kaybı/geri gelişi SQL ve idle-client olaylarından bir kez loglanır; beklenmeyen background hataları error reporter’a gider. Başlangıç hatası korunur; cleanup hataları ayrı sınıflandırılır, bağlantı kesintileri Sentry’ye gönderilmez. Kapanışta tüm PgBoss nesneleri durdurulur, ortak pool bir kez kapanır; ardından business pool’ları kapanır.

## Deployment akışı

1. Aynı release’in Node 24 production imajını hazırlayın. Derlenmiş migration entry point’i imajın içindedir; production’da `ts-node` gerekmez.
2. Tek one-off deployment task’ında `DATABASE_URL` değerini **aynı primary veritabanının migration rolüyle** sağlayıp `npm run db:delivery:migrate` çalıştırın. Task uygulama/HTTP/consumer başlatmaz. Yerel kaynak kod için `npm run db:delivery:migrate:dev` kullanılabilir; `.env`/`.env.test` seçimi uygulamayla aynıdır. URL çalıştırılan ortamdan erişilebilir olmalıdır.
3. Komut üç şemayı sırayla vendor API ile oluşturur/günceller; DLQ’ları source queue’lardan önce hazırlar. Mevcut queue ayarlarını `updateQueue` ile uzlaştırır. Background migration/index işlerinin tamamlanmasını bekler; kuyruk kontrolü ve vendor schema drift kontrolü başarısızsa sıfır dışı kodla çıkar. Bekleme yalnız migration tamamlanmasını izler; job retry motoru değildir.
4. `DELIVERY_MIGRATION_TIMEOUT` env dosyalarında ve varsayılan olarak 900 saniyedir: her SQL için timeout ve her şemanın background migration bekleme sınırıdır; toplam deployment süresinin kesin sınırı değildir. Büyük veritabanlarında task özelinde artırılması gerekebilir. Background migration komutları `bamIntervalSeconds: 10` ile sırayla işlenir; timeout zorunlu bekleme süresi değildir. Deployment task’ına ayrıca toplam süre sınırı koyun. Paralel migration task’ları çalıştırmayın; başarısız task’tan sonra hatayı giderip aynı komutu yeniden çalıştırın. Otomatik downgrade/şema silme yoktur.
5. Runtime rolüne üç şemada `USAGE`, vendor tablolarında `SELECT/INSERT/UPDATE/DELETE`, gerekli fonksiyonlarda `EXECUTE` verin. Runtime rolü owner/migration rolü olmamalı ve `CREATE` almamalıdır. Her migration sonrası yeni nesnelerin grant’lerini deployment rolü yönetsin. Kuyruk yaratma, schema DDL ve reindex bakım rolünde kalır; Drizzle bu şemaları yönetmez.
6. Migration başarıyla bittikten sonra normal uygulama instance’larını başlatın. Rolling deployment’ta eski/yeni sürüm şema uyumunu önceden değerlendirin; uyumsuz sürümler eşzamanlı açılmaz. CI’da bu sıra [E2E workflow’una](../.github/workflows/e2e-test.yml) eklendi.

## Doğrulama — 15 Eylül 2026

İzole PostgreSQL **18.4**, Redis **7**, yerel Node **22.22.2** ve Dockerfile’ın production imajındaki Node **24.11.1** kullanıldı. Mevcut geliştirme veritabanına dokunulmadı.

| Kontrol                                                           | Sonuç                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Boş veritabanında ilk kurulum; production imajından migration     | Üç şema, 8 source + 8 DLQ; exit 0                                                                            |
| Tekrar provisioning                                               | Kuyruk oluşturulma zamanları ve mevcut job korundu                                                           |
| Eksik şema/kuyruk, yanlış şema sürümü                             | Startup reddedildi; runtime otomatik migration yapmadı                                                       |
| Policy, partition, notify, DLQ, iki retention ayarında uyuşmazlık | Her biri reddedildi; mutable ayarlar deployment ile düzeldi                                                  |
| Pending/failed/in-progress BAM; eksik vendor indexi               | Startup/deployment ilgili kontrolde reddedildi; index onarımından sonra deployment geçti                     |
| Erişilemeyen DB; kilit altında SQL timeout                        | Exit 1, asılı process yok; kilit kalkınca tekrar başarılı                                                    |
| Migration hata enjeksiyonu: 12 senaryo                            | Context, pool/boss background, ardışık/geç hatalar, ana hata + cleanup, BAM timeout ve drift görünür; exit 1 |
| Sınırlı runtime rolü                                              | Startup ve supervision geçti; aynı rolün `CREATE TABLE` işlemi `42501` ile reddedildi                        |
| Gerçek `12.20.0 → 12.31.1` upgrade ve timeout sonrası kurtarma    | Şema 31 → 41; 18 BAM, üç eski job korundu; 30 saniye yetmedi, 120 saniyeyle tekrar tamamlandı                |
| Production HTTP ve SIGTERM                                        | Readiness 204; bozuk kuyrukta HTTP açılmadı; normal kapanışta bağlantılar sıfırlandı                         |
| İki gerçek PostgreSQL kesintisi ve idle bağlantı kaybı            | Her kesintide tek LOST/RESTORED; SQL hatası korunur, beklenen outage error reporter’a gönderilmez            |
| Eşzamanlı shutdown ve birleşen hatalar                            | Pool bir kez kapanır; startup hatası korunur, cleanup hataları kaybolmaz                                     |

[7 lifecycle testi](../src/core/job-queue/adapter/job-queue.adapter.spec.ts) ve delivery sınırlarını/defaultlarını da kapsayan [110 env testi](../src/core/config/environment/env.validation.spec.ts) geçti. Gerçek DB kontrolleri ve migration hata enjeksiyonları bu çalışma için geçici harness’lerle ayrıca çalıştırıldı; `npm test` bunları çalıştırmaz.

SWC build, TypeScript kontrolü, production image build ve değişen TypeScript dosyalarının hedefli lint kontrolü geçti. Tüm proje test/lint paketi çalıştırılmadı. Sonraki `job-queue` ayrımı/test uyarlaması, 900 saniye timeout ve cleanup hata sınıflandırması yeniden doğrulanmadı.

## Sonraki faz/ortam doğrulamaları

- Faz 4’te `fromDrizzle(tx, sql)` ile mutation + audit + delivery commit/rollback atomikliği.
- Faz 1 kapasite bütçesinde storage/index/autovacuum ve RDS/Aurora TLS/failover davranışı; henüz üretim kapasitesi kanıtlanmış değildir.
- Startup kontrolü sürekli delivery health/backlog izlemesi değildir. Mevcut readiness primary/replica/session kontrollerini korur; worker, backlog ve alarm kapsamı Faz 5/10/11’de tamamlanır.

Kaynaklar: sabit sürümün [lifecycle API’si](https://github.com/timgit/pg-boss/blob/12.31.1/src/index.ts), [schema kontrolü](https://github.com/timgit/pg-boss/blob/12.31.1/src/contractor.ts), [background migration motoru](https://github.com/timgit/pg-boss/blob/12.31.1/src/bam.ts). Kurulu paket kaynakları da incelendi.
