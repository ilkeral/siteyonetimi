-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'SITE_ADMIN', 'ACCOUNTANT', 'TECHNICIAN', 'SECURITY', 'RESIDENT');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('TR', 'EN', 'DE', 'RU');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('APARTMAN', 'SITE', 'REZIDANS', 'IS_MERKEZI', 'TOPLU_YAPI');

-- CreateEnum
CREATE TYPE "OccupancyRole" AS ENUM ('OWNER', 'TENANT');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('OCCUPIED', 'EMPTY', 'UNDER_RENOVATION');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PERSON', 'SUPPLIER', 'EMPLOYEE', 'CASH', 'BANK');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('OPENING_BALANCE', 'DUES_ACCRUAL', 'METER_DISTRIBUTION', 'LATE_FEE', 'EXPENSE', 'INCOME', 'COLLECTION', 'PAYMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DuesDistributionMethod" AS ENUM ('EQUAL', 'BY_AREA', 'BY_LAND_SHARE', 'BY_SHARE_RATIO');

-- CreateEnum
CREATE TYPE "DuesLiabilityRule" AS ENUM ('OWNER', 'OCCUPANT');

-- CreateEnum
CREATE TYPE "LateFeeMethod" AS ENUM ('MONTHLY_PERCENT', 'DAILY_PERCENT', 'NONE');

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('FUEL', 'HOT_WATER', 'COLD_WATER', 'COOLING', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "WaterPricingMethod" AS ENUM ('UNIT_PRICE', 'INVOICE_TOTAL');

-- CreateEnum
CREATE TYPE "DistributionStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('WAITING', 'REVIEWING', 'AWAITING_REPLY', 'FORWARDED', 'PLANNED', 'IN_PROGRESS', 'POSTPONED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TicketRequestType" AS ENUM ('COMPLAINT', 'FAULT', 'QUESTION', 'SUGGESTION', 'REQUEST', 'SATISFACTION', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('PORTAL', 'PHONE', 'IN_PERSON', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'WHATSAPP', 'VOICE', 'POST');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankMatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "LostItemStatus" AS ENUM ('FOUND', 'CLAIMED', 'DELIVERED', 'DISPOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SiteType" NOT NULL DEFAULT 'APARTMAN',
    "city" TEXT,
    "district" TEXT,
    "address" TEXT,
    "postCode" TEXT,
    "taxNumber" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fiscalStartMonth" INTEGER NOT NULL DEFAULT 1,
    "fiscalStartYear" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "duesDistributionMethod" "DuesDistributionMethod" NOT NULL DEFAULT 'EQUAL',
    "duesLiabilityRule" "DuesLiabilityRule" NOT NULL DEFAULT 'OCCUPANT',
    "dueDayOfMonth" INTEGER NOT NULL DEFAULT 15,
    "defaultCashAccountId" TEXT,
    "lateFeeMethod" "LateFeeMethod" NOT NULL DEFAULT 'MONTHLY_PERCENT',
    "lateFeeRate" DECIMAL(9,4) NOT NULL DEFAULT 5,
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 0,
    "applyLateFee" BOOLEAN NOT NULL DEFAULT true,
    "requireNationalId" BOOLEAN NOT NULL DEFAULT false,
    "requireEmail" BOOLEAN NOT NULL DEFAULT false,
    "requireMobilePhone" BOOLEAN NOT NULL DEFAULT true,
    "requireDeviceOnTicket" BOOLEAN NOT NULL DEFAULT false,
    "requireVisitorId" BOOLEAN NOT NULL DEFAULT false,
    "communicationLanguages" "Language"[] DEFAULT ARRAY['TR']::"Language"[],
    "notificationSenderName" TEXT,
    "notificationFooter" TEXT,
    "autoMatchBankTransactions" BOOLEAN NOT NULL DEFAULT true,
    "paymentAllocationRule" TEXT NOT NULL DEFAULT 'OLDEST_FIRST',
    "customFieldLabels" JSONB,
    "policyTexts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "personId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "floorCount" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "blockId" TEXT,
    "doorNumber" TEXT NOT NULL,
    "floor" INTEGER,
    "area" DECIMAL(10,2),
    "landShare" DECIMAL(12,6),
    "shareRatio" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "roomCount" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'OCCUPIED',
    "isExempt" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationalId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "birthDate" TIMESTAMP(3),
    "language" "Language" NOT NULL DEFAULT 'TR',
    "photoPath" TEXT,
    "note" TEXT,
    "inLegalAction" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOccupancy" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "OccupancyRole" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "bankPaymentCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOccupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "hgsNumber" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "personId" TEXT,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "iban" TEXT,
    "bankName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "period" TEXT,
    "description" TEXT,
    "unitId" TEXT,
    "parentId" TEXT,
    "duesRunId" TEXT,
    "meterDistributionId" TEXT,
    "ticketId" TEXT,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "unitId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "duesItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesItem" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "distributionMethod" "DuesDistributionMethod",
    "categoryId" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuesItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCount" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuesRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesRunLine" (
    "id" TEXT NOT NULL,
    "duesRunId" TEXT NOT NULL,
    "duesItemId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "distributionMethod" "DuesDistributionMethod" NOT NULL,

    CONSTRAINT "DuesRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" TEXT NOT NULL,
    "balance" DECIMAL(18,4),
    "reference" TEXT,
    "raw" JSONB,
    "extractedPaymentCode" TEXT,
    "matchStatus" "BankMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedDocumentId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedById" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meter" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "unitId" TEXT,
    "type" "MeterType" NOT NULL,
    "serialNumber" TEXT,
    "name" TEXT,
    "factor" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterDistribution" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "categoryId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "applyLateFee" BOOLEAN NOT NULL DEFAULT false,
    "lateFeeStartDate" TIMESTAMP(3),
    "documentNote" TEXT,
    "waterOutletTemp" DECIMAL(6,2) NOT NULL DEFAULT 50,
    "fuelLowerHeatValue" DECIMAL(12,4) NOT NULL DEFAULT 8250,
    "waterPricingMethod" "WaterPricingMethod" NOT NULL DEFAULT 'UNIT_PRICE',
    "waterUnitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "penaltyPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "fixedSharePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "fuelInvoiceDocumentId" TEXT,
    "waterInvoiceDocumentId" TEXT,
    "electricInvoiceDocumentId" TEXT,
    "status" "DistributionStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeterDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MainMeterReading" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "meterId" TEXT,
    "type" "MeterType" NOT NULL,
    "readingDate" TIMESTAMP(3) NOT NULL,
    "previousValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currentValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "invoiceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "skip" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MainMeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitMeterReading" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "meterId" TEXT,
    "type" "MeterType" NOT NULL,
    "previousValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currentValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "consumption" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "UnitMeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'WAITING',
    "requestType" "TicketRequestType" NOT NULL DEFAULT 'REQUEST',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "channel" "TicketChannel" NOT NULL DEFAULT 'PORTAL',
    "personId" TEXT,
    "unitId" TEXT,
    "departmentId" TEXT,
    "assigneeId" TEXT,
    "area" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "boardOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketExpense" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketSurveyResponse" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'TR',
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "campaignId" TEXT,
    "personId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireAt" TIMESTAMP(3),
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT,
    "personId" TEXT,
    "unitId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostItem" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "LostItemStatus" NOT NULL DEFAULT 'FOUND',
    "itemName" TEXT NOT NULL,
    "description" TEXT,
    "photoPath" TEXT,
    "lostAt" TIMESTAMP(3),
    "foundAt" TIMESTAMP(3),
    "loserName" TEXT,
    "loserPhone" TEXT,
    "finderName" TEXT,
    "finderPhone" TEXT,
    "custodianName" TEXT,
    "custodianRole" TEXT,
    "deliveredTo" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "nationalId" TEXT,
    "plate" TEXT,
    "unitId" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "VisitorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSettings_siteId_key" ON "SiteSettings"("siteId");

-- CreateIndex
CREATE INDEX "SiteMembership_siteId_role_idx" ON "SiteMembership"("siteId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMembership_userId_siteId_key" ON "SiteMembership"("userId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_siteId_entityType_entityId_idx" ON "AuditLog"("siteId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Block_siteId_idx" ON "Block"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_siteId_name_key" ON "Block"("siteId", "name");

-- CreateIndex
CREATE INDEX "Unit_siteId_idx" ON "Unit"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_siteId_blockId_doorNumber_key" ON "Unit"("siteId", "blockId", "doorNumber");

-- CreateIndex
CREATE INDEX "Person_siteId_lastName_firstName_idx" ON "Person"("siteId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Person_siteId_nationalId_idx" ON "Person"("siteId", "nationalId");

-- CreateIndex
CREATE INDEX "UnitOccupancy_siteId_unitId_startDate_idx" ON "UnitOccupancy"("siteId", "unitId", "startDate");

-- CreateIndex
CREATE INDEX "UnitOccupancy_siteId_personId_idx" ON "UnitOccupancy"("siteId", "personId");

-- CreateIndex
CREATE INDEX "UnitOccupancy_bankPaymentCode_idx" ON "UnitOccupancy"("bankPaymentCode");

-- CreateIndex
CREATE INDEX "Vehicle_siteId_plate_idx" ON "Vehicle"("siteId", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "Account_personId_key" ON "Account"("personId");

-- CreateIndex
CREATE INDEX "Account_siteId_type_idx" ON "Account"("siteId", "type");

-- CreateIndex
CREATE INDEX "Account_siteId_name_idx" ON "Account"("siteId", "name");

-- CreateIndex
CREATE INDEX "Category_siteId_kind_idx" ON "Category"("siteId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Category_siteId_kind_name_key" ON "Category"("siteId", "kind", "name");

-- CreateIndex
CREATE INDEX "Document_siteId_type_date_idx" ON "Document"("siteId", "type", "date");

-- CreateIndex
CREATE INDEX "Document_siteId_period_idx" ON "Document"("siteId", "period");

-- CreateIndex
CREATE INDEX "Document_siteId_dueDate_idx" ON "Document"("siteId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Document_siteId_number_key" ON "Document"("siteId", "number");

-- CreateIndex
CREATE INDEX "LedgerEntry_siteId_accountId_date_idx" ON "LedgerEntry"("siteId", "accountId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_siteId_date_idx" ON "LedgerEntry"("siteId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_documentId_idx" ON "LedgerEntry"("documentId");

-- CreateIndex
CREATE INDEX "DuesItem_siteId_idx" ON "DuesItem"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "DuesItem_siteId_name_key" ON "DuesItem"("siteId", "name");

-- CreateIndex
CREATE INDEX "DuesRun_siteId_idx" ON "DuesRun"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "DuesRun_siteId_period_key" ON "DuesRun"("siteId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "DuesRunLine_duesRunId_duesItemId_key" ON "DuesRunLine"("duesRunId", "duesItemId");

-- CreateIndex
CREATE INDEX "BankTransaction_siteId_matchStatus_idx" ON "BankTransaction"("siteId", "matchStatus");

-- CreateIndex
CREATE INDEX "BankTransaction_siteId_date_idx" ON "BankTransaction"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_siteId_accountId_date_amount_reference_key" ON "BankTransaction"("siteId", "accountId", "date", "amount", "reference");

-- CreateIndex
CREATE INDEX "Meter_siteId_type_idx" ON "Meter"("siteId", "type");

-- CreateIndex
CREATE INDEX "Meter_siteId_unitId_idx" ON "Meter"("siteId", "unitId");

-- CreateIndex
CREATE INDEX "MeterDistribution_siteId_status_idx" ON "MeterDistribution"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MeterDistribution_siteId_period_key" ON "MeterDistribution"("siteId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "MainMeterReading_distributionId_type_key" ON "MainMeterReading"("distributionId", "type");

-- CreateIndex
CREATE INDEX "UnitMeterReading_distributionId_idx" ON "UnitMeterReading"("distributionId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitMeterReading_distributionId_unitId_type_key" ON "UnitMeterReading"("distributionId", "unitId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Department_siteId_name_key" ON "Department"("siteId", "name");

-- CreateIndex
CREATE INDEX "Ticket_siteId_status_boardOrder_idx" ON "Ticket"("siteId", "status", "boardOrder");

-- CreateIndex
CREATE INDEX "Ticket_siteId_assigneeId_idx" ON "Ticket"("siteId", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_siteId_number_key" ON "Ticket"("siteId", "number");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_idx" ON "TicketComment"("ticketId");

-- CreateIndex
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

-- CreateIndex
CREATE INDEX "TicketExpense_ticketId_idx" ON "TicketExpense"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketSurveyResponse_ticketId_key" ON "TicketSurveyResponse"("ticketId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_siteId_channel_idx" ON "NotificationTemplate"("siteId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_siteId_name_channel_language_key" ON "NotificationTemplate"("siteId", "name", "channel", "language");

-- CreateIndex
CREATE INDEX "NotificationCampaign_siteId_status_idx" ON "NotificationCampaign"("siteId", "status");

-- CreateIndex
CREATE INDEX "NotificationMessage_siteId_personId_createdAt_idx" ON "NotificationMessage"("siteId", "personId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationMessage_campaignId_status_idx" ON "NotificationMessage"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Announcement_siteId_publishAt_idx" ON "Announcement"("siteId", "publishAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_siteId_date_idx" ON "SecurityIncident"("siteId", "date");

-- CreateIndex
CREATE INDEX "LostItem_siteId_status_idx" ON "LostItem"("siteId", "status");

-- CreateIndex
CREATE INDEX "VisitorLog_siteId_enteredAt_idx" ON "VisitorLog"("siteId", "enteredAt");

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMembership" ADD CONSTRAINT "SiteMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMembership" ADD CONSTRAINT "SiteMembership_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMembership" ADD CONSTRAINT "SiteMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOccupancy" ADD CONSTRAINT "UnitOccupancy_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOccupancy" ADD CONSTRAINT "UnitOccupancy_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOccupancy" ADD CONSTRAINT "UnitOccupancy_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_duesRunId_fkey" FOREIGN KEY ("duesRunId") REFERENCES "DuesRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_meterDistributionId_fkey" FOREIGN KEY ("meterDistributionId") REFERENCES "MeterDistribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_duesItemId_fkey" FOREIGN KEY ("duesItemId") REFERENCES "DuesItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesItem" ADD CONSTRAINT "DuesItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesRunLine" ADD CONSTRAINT "DuesRunLine_duesRunId_fkey" FOREIGN KEY ("duesRunId") REFERENCES "DuesRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesRunLine" ADD CONSTRAINT "DuesRunLine_duesItemId_fkey" FOREIGN KEY ("duesItemId") REFERENCES "DuesItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedDocumentId_fkey" FOREIGN KEY ("matchedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterDistribution" ADD CONSTRAINT "MeterDistribution_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MainMeterReading" ADD CONSTRAINT "MainMeterReading_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "MeterDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MainMeterReading" ADD CONSTRAINT "MainMeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMeterReading" ADD CONSTRAINT "UnitMeterReading_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "MeterDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMeterReading" ADD CONSTRAINT "UnitMeterReading_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMeterReading" ADD CONSTRAINT "UnitMeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketExpense" ADD CONSTRAINT "TicketExpense_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSurveyResponse" ADD CONSTRAINT "TicketSurveyResponse_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
