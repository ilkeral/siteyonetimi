-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'OTHER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "paymentChannel" "PaymentChannel";

-- CreateTable
CREATE TABLE "PaymentScore" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "scoreDate" DATE NOT NULL,
    "score" DECIMAL(3,1) NOT NULL,
    "collectionRate" DECIMAL(5,4) NOT NULL,
    "avgDaysEarly" DECIMAL(7,1) NOT NULL,
    "dueAmount" DECIMAL(18,4) NOT NULL,
    "lateFeeCollected" DECIMAL(18,4) NOT NULL,
    "channels" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePaymentScore" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "scoreDate" DATE NOT NULL,
    "averageScore" DECIMAL(3,1) NOT NULL,
    "scoredCount" INTEGER NOT NULL,
    "highCount" INTEGER NOT NULL,
    "midCount" INTEGER NOT NULL,
    "lowCount" INTEGER NOT NULL,
    "channels" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePaymentScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentScore_siteId_scoreDate_idx" ON "PaymentScore"("siteId", "scoreDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentScore_siteId_personId_scoreDate_key" ON "PaymentScore"("siteId", "personId", "scoreDate");

-- CreateIndex
CREATE UNIQUE INDEX "SitePaymentScore_siteId_scoreDate_key" ON "SitePaymentScore"("siteId", "scoreDate");

-- AddForeignKey
ALTER TABLE "PaymentScore" ADD CONSTRAINT "PaymentScore_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentScore" ADD CONSTRAINT "PaymentScore_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePaymentScore" ADD CONSTRAINT "SitePaymentScore_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mevcut tahsilatların kanalını geriye dönük doldur (ödeme skoru dijital kanal payı için)
-- 1) Banka ekstresinden eşleşen tahsilat → havale/EFT
UPDATE "Document" d SET "paymentChannel" = 'BANK_TRANSFER'
WHERE d."type" = 'COLLECTION'
  AND EXISTS (SELECT 1 FROM "BankTransaction" b WHERE b."matchedDocumentId" = d."id");

-- 2) Sakin portalından kartla ödeme
UPDATE "Document" d SET "paymentChannel" = 'CARD'
WHERE d."type" = 'COLLECTION' AND d."paymentChannel" IS NULL
  AND d."description" LIKE 'Online ödeme%';

-- 3) Kalanlar: paranın girdiği hesabın türüne göre (kasa → elden, banka → havale)
UPDATE "Document" d SET "paymentChannel" = CASE a."type" WHEN 'CASH' THEN 'CASH'::"PaymentChannel" ELSE 'BANK_TRANSFER'::"PaymentChannel" END
FROM "LedgerEntry" e JOIN "Account" a ON a."id" = e."accountId"
WHERE e."documentId" = d."id" AND e."debit" > 0 AND a."type" IN ('CASH', 'BANK')
  AND d."type" = 'COLLECTION' AND d."paymentChannel" IS NULL;

UPDATE "Document" SET "paymentChannel" = 'OTHER'
WHERE "type" = 'COLLECTION' AND "paymentChannel" IS NULL;
