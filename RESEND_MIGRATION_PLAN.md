# Resend Geçiş Planı

Domain doğrulaması tamamlandı. Aşağıdaki fazlar ayrı ayrı yürütülecek.

1. **Aktivasyon kimliği:** Kabul edilen her yeni aktivasyon e-postası isteğinde yeni `activationId` ve son kullanma tarihi üret; önceki bağlantıyı geçersiz kıl. Kod ve ilgili kural güncellendi; test beklentileri doğrulama fazında güncellenecek.
2. **Gönderim kimliği ve idempotency:** Sekiz akışta kuyruk adı ve `deliveryId` e-posta portuna taşındı; gönderici, alıcı, konu ve HTML içeriği değiştiğinde farklı anahtar üreten yardımcı eklendi. Resend adaptörü bu anahtarı 4. fazda kullanacak; sağlayıcının tekilleştirme penceresi 24 saat.
3. **Yapılandırma:** Sağlayıcıdan bağımsız `EMAIL_FROM_ADDRESS` ve `EMAIL_API_KEY` değişkenleri doğrulamaya, örnek ortam dosyalarına ve yerel `.env` dosyasına eklendi. Yerel API anahtarı henüz yer tutucu; gerçek anahtar gizli yapılandırmaya girilecek.
4. **Gönderim adaptörü:** Resend SDK'sını ekle; Gmail adaptörünü Resend ile değiştir. Gönderim hatalarını mevcut yeniden deneme akışına uygun biçimde ilet; test ortamındaki no-op adaptörü koru.
5. **Temizlik:** Gmail OAuth değişkenlerini, `googleapis` bağımlılığını ve artık geçerli olmayan referansları kaldır.
6. **Doğrulama ve geçiş:** Aktivasyon testlerini yeni davranışa uyarla; sekiz e-posta akışını, retry/idempotency durumlarını ve hata yollarını doğrula. Dağıtım yapılandırmasını güncelle ve doğrulanmış göndericiyle kontrollü bir gönderim yap.
