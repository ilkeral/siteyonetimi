-- ÇOK KİRACILILIK KATMANI 3/3 — PostgreSQL satır düzeyi güvenlik (RLS)
--
-- Her site tablosunda bir satır yalnızca şu durumda görünür/yazılır:
--   "siteId" = current_setting('app.site_id')   — API her sorguda işlem içinde ayarlar
--   ya da app.bypass_rls = 'on'                — seed, zamanlanmış görev, siteler arası rapor
--
-- FORCE kullanılmaz: tablo sahibi (migration çalıştıran rol) kurallara takılmaz.
-- Kurallar uygulama tablo sahibi OLMAYAN bir rolle bağlandığında devreye girer
-- (pnpm db:app-role + DB_RLS=on). Süper kullanıcı RLS'yi her zaman atlar.
--
-- Tablo listesi packages/db/src/index.ts TENANT_MODELS ile aynıdır; yeni
-- tenant modeli eklerken buraya da bir migration ile kural ekleyin.

ALTER TABLE "Block" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Block"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Unit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Unit"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Person" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Person"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "UnitOccupancy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UnitOccupancy"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Vehicle"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Account"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Category"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LedgerEntry"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "DuesItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DuesItem"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "DuesRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DuesRun"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "BankTransaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankTransaction"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Meter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Meter"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "MeterDistribution" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MeterDistribution"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Ticket"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "NotificationTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationTemplate"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "NotificationCampaign" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationCampaign"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "NotificationMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationMessage"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Announcement"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "SecurityIncident" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SecurityIncident"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "LostItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LostItem"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "VisitorLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitorLog"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "PaymentScore" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentScore"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "SitePaymentScore" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SitePaymentScore"
  USING ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("siteId" = current_setting('app.site_id', true) OR current_setting('app.bypass_rls', true) = 'on');

