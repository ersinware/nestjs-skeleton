# Faz 4 — Kalıcı event kabulü ve consumer routing

Durum: Kod uygulandı; test/type check/build/lint/format çalıştırılmadı, yeni test eklenmedi. Mevcut lifecycle testi `job-queue` concern’üne taşınıp kayıt API’sine, refresh-token test mock’u `publish` portuna uyarlandı. Atomiklik ve runtime kabul kriterleri henüz doğrulanmış değildir.

## Sözleşme ve akış

1. Producer, UUID v7 `eventId`’yi bir kez oluşturur. [`DurableEvent`](../src/shared/application/event/durable-event.type.ts) yalnızca `{ eventId, eventType, aggregateId }` taşır; retry/redrive kimliği değiştirmez.
2. [User](../src/module/user/infrastructure/user-delivery.constant.ts), [Admin](../src/module/admin/infrastructure/admin-delivery.constant.ts) ve [Auth](../src/module/auth/infrastructure/auth-delivery.constant.ts) katalogları schema, queue ve event hedeflerini tanımlar. [`defineDeliveryRoutes`](../src/core/event-bus/delivery-routes.util.ts) event başına tekrar hedefi reddeder; TypeScript boş hedefleri ve eksik enum eşlemelerini engeller. [`EventBusModule.register`](../src/core/event-bus/module.ts) publisher kurulurken, [migration script’i](../src/script/job-queue-migration.ts) deployment sırasında aynı kataloglardan kuyruk envanteri çıkarır.
3. [`IEventPublisherPort.publish`](../src/core/event-bus/port/event-publisher.port.ts), yalnızca kendi context kataloğundaki event’leri kabul eder. Bilinmeyen/hedefsiz event hata verir; admin profil güncelleme ve ban kaldırma işlemleri event üretmez.
4. [`EventPublisherAdapter`](../src/core/event-bus/adapter/event-publisher.adapter.ts), hedefleri ve event kaydını [`IJobQueuePort.enqueue`](../src/core/job-queue/port/job-queue.port.ts) metoduna verir. [`JobQueueAdapter`](../src/core/job-queue/adapter/job-queue.adapter.ts), `ITransactionPort.run` ile mevcut transaction’a katılır veya yenisini açar. `fromDrizzle(primaryProxy, sql)`, ALS transaction’ında parametreli SQL çalıştırır. Enqueue için ayrı delivery pool bağlantısı kullanılmaz; pg-boss queue metadata okumaları kendi pool’unda kalabilir.
5. Her hedef için aynı event ile `boss.send` çağrılır; bağımsız gönderimler `Promise.all` ile beklenir. Hata durumunda başlatılan diğer gönderimler de sonuçlandırılıp hata dışarı taşınır. `null` job ID başarı sayılmaz. Dış callback hatayı yutmamalıdır; rollback bütün hedefleri ve aynı transaction’daki audit/mutation’ı geri alır.
6. `publish` dış transaction içindeyse insert tamamlanmasını, standalone ise commit’i bekler. Job ID’leri ayrı delivery kimlikleridir; `publish` çağrısını tekrarlamak dedup garantisi vermez.

[`JobQueueModule`](../src/core/job-queue/module.ts) bütün context publisher’ları için tek storage/pool sağlar; yalnızca port token’ını dışarı açar. `event-bus` event sözleşmesi/yönlendirmeyi, `job-queue` pg-boss/transaction/pool/migration işlerini yönetir. Job verisinin anlamı kuyruk altyapısına kapalıdır; vendor istemcisi dışarı açılmaz.

## Kullanım

```ts
const event = { eventId: uuidv7(), eventType: UserEvent.BANNED, aggregateId: userId };

// Yalnız event: kendi kısa transaction’ı.
await eventPublisher.publish(event);

// Audit + event: aynı transaction. Mutation gerekmeyen use case’ler için de kullanılabilir.
await transaction.run(async () => {
    await Promise.all([eventPublisher.publish(event), audit.record(auditInput)]);
});
```

Bunlar alternatif kullanım örnekleridir; aynı event’i peş peşe iki kez göndermek için değildir. Mutation + audit + event akışında writer geçişi Faz 9a/9b’de yapılır; mevcut writer ayrıca `publish` çağırmaz.

## Faz sınırı ve doğrulama

- Mevcut User/Admin ve integration event enum değerleri `.v1` oldu; producer/listener’lar aynı enum’ları kullanır. Literal eski ad kullanan test/entegrasyonların uyumu doğrulanmalıdır.
- Mevcut producer’lar `emitAsync` kullanır; consumersız iki admin event’i kaldırılmıştır. `publish` consumer çalıştırmaz; worker/retry/DLQ politikaları Faz 5’tedir. Bu aşama uçtan uca outbox geçişi değildir.
- [`DeliveryRecord`](../src/core/event-bus/delivery-record.type.ts), `{ event, telemetry? }` sözleşmesini tanımlar. Şimdilik sadece event yazılır; opsiyonel `traceId`/`traceparent` üretimi ve tracing Faz 5a’dadır. Faz 7 notification event’leri henüz route almaz.
- Ayrı event/target arşivi eklenmedi; [Faz 1 retention/recovery sınırları](transactional-outbox-phase-1.md#4-retention-ve-recovery-kararı) geçerlidir.
- Doğrulama için: standalone commit; audit+event commit/rollback; iki hedefin ikincisi başarısızken sıfır kalıcı job; eksik route; aynı kimliğin bütün hedeflerde korunması; eşzamanlı ALS izolasyonu; bütün context’lerde tek delivery pool ve startup/shutdown. Kurulu `pg-boss@12.31.1` adapter/send kaynakları incelendi; bu senaryolar çalıştırılmadı.
