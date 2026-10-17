-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('THEFT', 'DAMAGE', 'NOISE', 'TRESPASS', 'FIRE', 'ACCIDENT', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
ALTER TYPE "LostItemStatus" ADD VALUE 'LOST';

-- AlterTable
ALTER TABLE "LostItem" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "disposalNote" TEXT,
ADD COLUMN     "disposedAt" TIMESTAMP(3),
ADD COLUMN     "location" TEXT,
ADD COLUMN     "number" INTEGER;

-- Mevcut kayıtlara site içinde sırayla emanet numarası ver
UPDATE "LostItem" l SET "number" = n.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "siteId" ORDER BY "createdAt", id) AS rn FROM "LostItem") n
WHERE l.id = n.id;
ALTER TABLE "LostItem" ALTER COLUMN "number" SET NOT NULL;

-- AlterTable
ALTER TABLE "SecurityIncident" ADD COLUMN     "category" "IncidentCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "severity" "IncidentSeverity" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Olay';
ALTER TABLE "SecurityIncident" ALTER COLUMN "title" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VisitorLog" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "exitedById" TEXT,
ADD COLUMN     "hostPersonId" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "visitorPhone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LostItem_siteId_number_key" ON "LostItem"("siteId", "number");

-- CreateIndex
CREATE INDEX "VisitorLog_siteId_exitedAt_idx" ON "VisitorLog"("siteId", "exitedAt");

-- Silinmiş daireye işaret eden eski kayıtlar yabancı anahtarı bozmasın
UPDATE "VisitorLog" v SET "unitId" = NULL
WHERE "unitId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Unit" u WHERE u.id = v."unitId");

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_hostPersonId_fkey" FOREIGN KEY ("hostPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

