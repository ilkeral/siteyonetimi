-- "Sakin" terimi "İkamet Eden" olarak değiştirildi: araç durumu serbest metin
-- olduğundan mevcut kayıtlar da güncellenir (ekranda olduğu gibi gösteriliyor).
UPDATE "Vehicle" SET "status" = 'ikamet eden' WHERE lower("status") = 'sakin';
