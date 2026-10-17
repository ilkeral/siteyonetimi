-- Her site bir müşteriye bağlı olmak zorunda: müşterisiz (faturalanmayan, sınırsız) site
-- kavramı kaldırıldı. Uygulamadan önce müşterisiz site kalmamış olmalı.

-- AlterTable
ALTER TABLE "Site" ALTER COLUMN "organizationId" SET NOT NULL;

