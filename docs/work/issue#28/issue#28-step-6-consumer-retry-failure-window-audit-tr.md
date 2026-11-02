# Issue #28 — Adım 6: Consumer Retry Failure-Window Audit

## Snapshot

Branch:

```text
issue#28-queue-consumer-transaction-retry-safety
```

İncelenen head:

```text
c0ba4234afab570fe5974640498d15ba126a9b6a
```

Production'daki **20 consumer** için yalnız normal retry değil, şu geniş failure window incelendi:

```text
business work / external effect succeeds
→ job completion gerçekleşmez
→ pg-boss retry'ları
→ retry'lar tükenir
→ shared DLQ
→ daha sonra redrive
→ aynı logical delivery tekrar çalışır
```

Bu adımda source/config değişikliği yapılmadı.

---

## Classification anlamı

- **safe:** failure window transaction atomicity ile kapanıyor.
- **idempotent:** aynı effect tekrarlandığında sonuç değişmiyor / converge ediyor.
- **deduplicated:** aynı logical delivery'nin tekrar effect üretmesi kalıcı olarak dedup ediliyor.
- **safe-to-repeat:** retry authoritative state'i yeniden okuyup kalan işi güvenle tamamlıyor.
- **unsafe:** normal retry veya DLQ/redrive sonrasında ikinci business/external effect mümkün.

---

## DLQ / redrive identity sonucu

Shared DLQ job'ı source payload'ını korur:

```text
data.deliveryId
data.aggregateId
```

Redrive source queue'ya yeni bir **physical pg-boss job ID** ile job oluşturabilir; ancak payload'daki logical identity korunur.

```text
physical pg-boss job ID → değişebilir
deliveryId             → değişmez
```

Dolayısıyla email için hedef key:

```text
${queueName}/${deliveryId}
```

redrive sonrasında da aynı logical delivery identity'yi üretir.

Ancak provider idempotency retention süresi sınırlı olduğundan aynı key'in çok daha geç redrive edilmesi duplicate physical send'i kalıcı olarak engellemez. Bu nedenle provider dedup tek başına DLQ/redrive dahil tam retry-safety guarantee değildir.

---

## Consumer bazında sonuç

| # | Consumer | Retry / redrive davranışı | Classification |
| ---: | --- | --- | --- |
| 1 | `UserCacheConsumer` | Başarılı Redis `DEL` sonrası retry/redrive aynı key'i tekrar siler. | **idempotent** |
| 2 | `UserSessionConsumer` | DB'den current `sessionVersion` yeniden okunur; Redis `max(stored, candidate)` uygulanır. | **idempotent** |
| 3 | `AdminInviteConsumer` | Same-delivery payload normal retry'da stabil ve provider dedup'a uygundur; fakat invite 3 gün yaşayabildiği için provider retention aşıldıktan sonra redrive duplicate email gönderebilir. | **unsafe** |
| 4 | `AdminSessionConsumer` | DB'den current version yeniden okunur; Redis update monotonic/convergent'tir. | **idempotent** |
| 5 | `UserActivationConsumer` | Same-delivery payload stabil; ancak activation 3 gün yaşayabildiği için provider retention sonrası redrive duplicate email gönderebilir. | **unsafe** |
| 6 | `UserAvatarReplaceConsumer` | Same-delivery crash/retry reconciliation güvenlidir; ancak `SUPERSEDED` kararı sonrası destructive S3 cleanup, hâlâ geçerli eski upload proof ile avatarın tekrar seçilmesiyle yarışabilir. | **unsafe — #30** |
| 7 | `UserAvatarFinalizeConsumer` | #28'de doğrulanan retry/crash/DLQ-redrive window'larında destination/finalized state'i reconcile eder; `SUPERSEDED` durumda cleanup yapmadan çıkar. Broader avatar-lifecycle safety #30'da yeniden doğrulanacaktır. | **safe-to-repeat** |
| 8 | `AdminAvatarReplaceConsumer` | User replace ile aynı same-delivery reconciliation modeline sahiptir; aynı `SUPERSEDED` cleanup + replayable proof race'i vardır. | **unsafe — #30** |
| 9 | `AdminAvatarFinalizeConsumer` | #28'de doğrulanan failure window'larında finalized state yeniden okunur; destination reuse ve repeated cleanup güvenlidir, `SUPERSEDED` durumda cleanup yoktur. Broader avatar-lifecycle safety #30'da yeniden doğrulanacaktır. | **safe-to-repeat** |
| 10 | `UserEmailConfirmationConsumer` | Current `user.name` değişirse aynı `deliveryId` farklı payload üretebilir; mevcut content-hash key de değişir ve duplicate send mümkün olur. | **unsafe** |
| 11 | `UserRefreshReuseNoticeConsumer` | Retry/redrive current email/name'i yeniden okur; payload drift duplicate send üretebilir. Provider retention sonrası aynı payload da tekrar gönderilebilir. | **unsafe** |
| 12 | `AdminEmailConfirmationConsumer` | User confirmation ile aynı mutable-name riski. | **unsafe** |
| 13 | `AdminRefreshReuseNoticeConsumer` | Current email/name mutable; ayrıca uzun gecikmeli redrive provider retention'ı aşabilir. | **unsafe** |
| 14 | `UserEmailChangeNotificationConsumer` | Payload immutable notification row'dan gelir; normal retry aynı key ile dedup edilir. Fakat notification row yaşamaya devam ettiği için retention sonrası redrive duplicate email gönderebilir. | **unsafe** |
| 15 | `AdminEmailChangeNotificationConsumer` | User notification ile aynı bounded-provider-dedup riski. | **unsafe** |
| 16 | `UserSessionRevocationLogoutAllConsumer` | Mutation + audit + follow-up job + source completion aynı pg-boss transaction'ında; retry yalnız rollback sonrası oluşur. | **safe** |
| 17 | `DeadLetterRedriveConsumer` | Her redrive batch'i bağımsız tamamlanır; retry kalan eligible DLQ row'larından devam eder. | **safe-to-repeat** |
| 18 | `AdminSessionRevocationLogoutAllConsumer` | Mutation + audit + follow-up job + completion atomik. | **safe** |
| 19 | `UserSessionRevocationRefreshReuseConsumer` | Revocation + reconcile/notice jobs + completion aynı transaction'da commit/rollback olur. | **safe** |
| 20 | `AdminSessionRevocationRefreshReuseConsumer` | User refresh-reuse path'iyle aynı atomicity modeli. | **safe** |

---

## Avatar replace follow-up — Issue #30

`UserAvatarReplaceConsumer` ve `AdminAvatarReplaceConsumer` için normal same-delivery retry akışı güvenlidir:

```text
copy success → crash → destination reuse
DB commit → cleanup failure → finalized state'ten cleanup resume
repeated delete → safe
stale pending save → optimistic-lock failure → cleanup yok
```

Ancak genel classification **unsafe** olmalıdır. `SUPERSEDED` branch DB state'i bir kez okuyup transaction / optimistic-lock olmadan destructive cleanup yapar. Upload proof ise expiry süresi boyunca replay edilebilir.

Mümkün race:

```text
D1 selected
→ D2 selected
→ D1 consumer D1'i SUPERSEDED okur
→ eski D1 upload proof tekrar kabul edilir
→ DB tekrar D1'i selected/pending yapar
→ stale D1 consumer D1 source/destination cleanup yapar
```

Bu cross-cutting problem queue retry'dan daha geniştir; avatar upload-proof lifecycle ve destructive cleanup coordination birlikte incelenmelidir. Remediation **Issue #30** scope'undadır ve Issue #28 içinde implemente edilmeyecektir.

### Finalize consumer scope notu

`UserAvatarFinalizeConsumer` ve `AdminAvatarFinalizeConsumer` için #28'de incelenen failure window'larında somut unsafe senaryo doğrulanmadı. Özellikle `SUPERSEDED` state destructive cleanup yapmadan return eder; bu nedenle replace consumer'lardaki bilinen race doğrudan finalize path'lerine taşınmaz.

Bu `safe-to-repeat` sonucu **yalnız #28'de doğrulanan retry/crash/DLQ-redrive window'ları için geçerlidir**. Issue #30 bütün avatar lifecycle'ını, finalize path'leri dahil, yeniden inceleyecek; yeni bir race bulunursa bu classification supersede edilecektir.

---

## Transactional consumer sonucu

Dört transactional consumer için:

```text
application mutation
+ audit
+ follow-up job
+ source job completion
= tek pg-boss transaction
```

Bu yüzden aynı source delivery için:

```text
DB commit başarılı
+
source completion başarısız
+
retry
```

şeklinde ayrık bir window oluşmaz.

Buradaki **safe** classification ayrı bir duplicate job'ın business command açısından idempotent olduğunu değil, aynı pg-boss delivery'nin retry/redrive failure window'unu ifade eder.

---

## Email sonucu

### 1. Payload drift nedeniyle unsafe

```text
UserEmailConfirmationConsumer
AdminEmailConfirmationConsumer
UserRefreshReuseNoticeConsumer
AdminRefreshReuseNoticeConsumer
```

Mevcut key:

```text
${queueName}/${deliveryId}/${contentHash}
```

olduğu için payload değişikliği provider identity'yi de değiştiriyor.

### 2. Payload stabil olsa da retention nedeniyle unsafe

```text
AdminInviteConsumer
UserActivationConsumer
UserEmailChangeNotificationConsumer
AdminEmailChangeNotificationConsumer
```

Normal same-payload retry provider tarafından deduplicate edilebilir; fakat DLQ'da yeterince uzun bekleyip provider retention aşıldıktan sonra redrive edilirse aynı email tekrar fiziksel olarak gönderilebilir.

Bu nedenle **8 email consumer'ın tamamı**, DLQ/redrive dahil uçtan uca değerlendirmede mevcut haliyle tam retry-safe değildir.

Adım 7–8'de:

- logical delivery identity,
- authoritative state,
- payload stability,
- `${queueName}/${deliveryId}` key invariant'ı,
- provider retention sınırı,
- duplicate-effect strategy

ayrıntılı olarak kesinleştirilmelidir.

---

## Acceptance review

- [ ] **Every consumer is classified for normal retry and DLQ/redrive safety; defects owned by Issue #28 are corrected, and cross-cutting defects outside this issue are linked to dedicated follow-up issues.**

Audit classification tamamlandı. **8 email consumer** Issue #28 kapsamında unsafe; iki avatar replace consumer ise cross-cutting race nedeniyle **unsafe — #30** olarak takip edilir.

```text
Step 6 audit status: COMPLETE
safe: 4
idempotent: 3
safe-to-repeat: 3
unsafe: 10
deduplicated: 0 (unbounded guarantee olarak)

Step 6 corrections / follow-ups identified:
- 4 mutable-payload email path
- 8 email path için provider-retention / DLQ-redrive duplicate strategy
- 2 avatar replace consumer için `SUPERSEDED` cleanup + replayable upload-proof race → Issue #30
```
