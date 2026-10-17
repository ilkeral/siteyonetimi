export * from '@prisma/client';
export { PrismaClient, Prisma } from '@prisma/client';

/**
 * Tenant'lı (siteId taşıyan) modellerin listesi.
 * API tarafındaki Prisma extension bu listeyi kullanarak her sorguya
 * otomatik `siteId` filtresi enjekte eder — bir modeli buraya eklemeyi
 * unutmak, o modelin siteler arası sızmasına yol açar.
 */
export const TENANT_MODELS = [
  'Block',
  'Unit',
  'Person',
  'UnitOccupancy',
  'Vehicle',
  'Account',
  'Category',
  'Document',
  'LedgerEntry',
  'DuesItem',
  'DuesRun',
  'BankTransaction',
  'Meter',
  'MeterDistribution',
  'Department',
  'Ticket',
  'NotificationTemplate',
  'NotificationCampaign',
  'NotificationMessage',
  'Announcement',
  'SecurityIncident',
  'LostItem',
  'VisitorLog',
  'PaymentScore',
  'SitePaymentScore',
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

export const TENANT_MODEL_SET: ReadonlySet<string> = new Set(TENANT_MODELS);
