import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { toMinor, fromMinor } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { decimal, toMinorDecimal } from './ledger.service';
import { TransactionsService } from './transactions.service';

export interface BankRowInput {
  date: string | Date;
  amount: string | number;
  description: string;
  balance?: string | number | null;
  reference?: string | null;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  autoMatched: number;
  pending: number;
}

/**
 * BANKA ENTEGRASYONU
 *
 * Ekstre satırları (Excel/CSV ya da ileride banka servisi) BankTransaction
 * olarak saklanır, sonra eşleştirilir.
 *
 * Eşleştirme sırası:
 *   1. Açıklamadaki **banka ödeme kodu** (UnitOccupancy.bankPaymentCode) —
 *      sitelerde dağıtılan "aidat kodu" budur, en güvenilir yöntemdir.
 *   2. Açıklamadaki ad-soyad (Türkçe karakterler normalize edilerek).
 *      Birden fazla kişiye uyuyorsa eşleştirme YAPILMAZ — yanlış cariye
 *      para yazmaktansa elle onaya bırakmak doğrudur.
 *   3. Hiçbiri tutmazsa kayıt "bekleyen" olarak kalır ve panelde listelenir.
 */
@Injectable()
export class BankService {
  private readonly logger = new Logger('Bank');

  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly transactions: TransactionsService,
  ) {}

  async import(bankAccountId: string, rows: BankRowInput[]): Promise<ImportResult> {
    const siteId = requireSiteId();

    const account = await this.db.account.findUnique({
      where: { id: bankAccountId },
      select: { id: true, type: true },
    });
    if (!account) throw new NotFoundException('Banka hesabı bulunamadı');
    if (!['BANK', 'CASH'].includes(account.type)) {
      throw new BadRequestException('Seçilen cari bir banka/kasa hesabı değil');
    }
    if (rows.length === 0) throw new BadRequestException('Dosyada satır bulunamadı');

    const importBatchId = `imp_${Date.now()}`;
    let imported = 0;
    let duplicates = 0;

    for (const row of rows) {
      const date = new Date(row.date);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(`Geçersiz tarih: ${String(row.date)}`);
      }
      const amountMinor = toMinor(row.amount);
      if (amountMinor === 0) continue;

      const description = String(row.description ?? '').trim();
      const reference = row.reference ? String(row.reference) : null;

      // Aynı ekstre iki kez yüklenirse satırlar tekrarlanmasın
      const existing = await this.db.bankTransaction.findFirst({
        where: {
          accountId: bankAccountId,
          date,
          amount: decimal(amountMinor),
          reference,
          description,
        },
        select: { id: true },
      });
      if (existing) {
        duplicates++;
        continue;
      }

      await this.db.bankTransaction.create({
        data: {
          siteId,
          accountId: bankAccountId,
          date,
          amount: decimal(amountMinor),
          description,
          balance: row.balance != null ? decimal(toMinor(row.balance)) : null,
          reference,
          raw: row as object,
          extractedPaymentCode: null,
          importBatchId,
        },
      });
      imported++;
    }

    const autoMatched = await this.autoMatch();
    const pending = await this.db.bankTransaction.count({ where: { matchStatus: 'UNMATCHED' } });

    this.logger.log(`Ekstre yüklendi: ${imported} yeni, ${duplicates} tekrar, ${autoMatched} otomatik eşleşti`);
    return { imported, duplicates, autoMatched, pending };
  }

  /** Bekleyen hareketleri otomatik eşleştirir; eşleşen her biri için tahsilat üretir */
  async autoMatch(): Promise<number> {
    const siteId = requireSiteId();
    const settings = await this.db.siteSettings.findUnique({ where: { siteId } });
    if (!settings?.autoMatchBankTransactions) return 0;

    const pending = await this.db.bankTransaction.findMany({
      where: { matchStatus: 'UNMATCHED', amount: { gt: 0 } },
      orderBy: { date: 'asc' },
    });
    if (pending.length === 0) return 0;

    const index = await this.buildMatchIndex();
    let matched = 0;

    for (const transaction of pending) {
      const hit = this.findAccount(transaction.description, index);
      if (!hit) continue;

      const document = await this.transactions.collect({
        accountId: hit.accountId,
        cashAccountId: transaction.accountId,
        amount: fromMinor(toMinorDecimal(transaction.amount)),
        date: transaction.date,
        description: `Banka: ${transaction.description}`.slice(0, 500),
      });

      await this.db.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchStatus: 'AUTO_MATCHED',
          matchedDocumentId: document.id,
          matchedAt: new Date(),
          extractedPaymentCode: hit.code,
        },
      });
      matched++;
    }

    return matched;
  }

  /** Elle eşleştirme — paneldeki "bekleyen hareketler" ekranından */
  async matchManually(transactionId: string, accountId: string) {
    const transaction = await this.db.bankTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Banka hareketi bulunamadı');
    if (transaction.matchStatus !== 'UNMATCHED') {
      throw new BadRequestException('Bu hareket zaten eşleştirilmiş');
    }

    const amountMinor = toMinorDecimal(transaction.amount);
    if (amountMinor <= 0) {
      throw new BadRequestException('Çıkış hareketleri tahsilat olarak eşleştirilemez');
    }

    return this.transactions.collect({
      accountId,
      cashAccountId: transaction.accountId,
      amount: fromMinor(amountMinor),
      date: transaction.date,
      description: `Banka: ${transaction.description}`.slice(0, 500),
      bankTransactionId: transactionId,
    });
  }

  async ignore(transactionId: string) {
    return this.db.bankTransaction.update({
      where: { id: transactionId },
      data: { matchStatus: 'IGNORED' },
    });
  }

  async listPending() {
    return this.db.bankTransaction.findMany({
      where: { matchStatus: 'UNMATCHED' },
      orderBy: { date: 'desc' },
      include: { account: { select: { name: true } } },
      take: 500,
    });
  }

  // ------------------------------------------------------------------ eşleşme

  private async buildMatchIndex() {
    const occupancies = await this.db.unitOccupancy.findMany({
      where: { bankPaymentCode: { not: null }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
      select: { bankPaymentCode: true, personId: true },
    });

    const accounts = await this.db.account.findMany({
      where: { type: 'PERSON', isActive: true },
      select: { id: true, personId: true, name: true },
    });
    const accountByPerson = new Map(accounts.map((a) => [a.personId!, a.id]));

    const byCode = new Map<string, string>();
    for (const occupancy of occupancies) {
      const code = occupancy.bankPaymentCode!.trim().toUpperCase();
      const accountId = accountByPerson.get(occupancy.personId);
      if (!code || !accountId) continue;
      // Aynı kod iki kişiye verilmişse güvenilmez sayılır
      byCode.set(code, byCode.has(code) && byCode.get(code) !== accountId ? '' : accountId);
    }

    const byName = new Map<string, string>();
    for (const account of accounts) {
      const key = normalize(account.name);
      if (!key) continue;
      byName.set(key, byName.has(key) ? '' : account.id);
    }

    return { byCode, byName };
  }

  private findAccount(
    description: string,
    index: { byCode: Map<string, string>; byName: Map<string, string> },
  ): { accountId: string; code: string | null } | null {
    const upper = description.toUpperCase();

    // 1) Ödeme kodu — kelime sınırına bakarak, en uzun koddan başlayarak
    const codes = [...index.byCode.keys()].sort((a, b) => b.length - a.length);
    for (const code of codes) {
      const accountId = index.byCode.get(code);
      if (!accountId) continue;
      if (new RegExp(`(^|[^0-9A-ZÇĞİÖŞÜ])${escapeRegex(code)}([^0-9A-ZÇĞİÖŞÜ]|$)`).test(upper)) {
        return { accountId, code };
      }
    }

    // 2) Ad soyad
    const normalized = normalize(description);
    for (const [name, accountId] of index.byName) {
      if (!accountId) continue;
      if (name.length >= 8 && normalized.includes(name)) {
        return { accountId, code: null };
      }
    }

    return null;
  }
}

/** Türkçe karakterleri sadeleştirip boşlukları tekilleştirir */
function normalize(value: string): string {
  const map: Record<string, string> = {
    ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
    Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u',
  };
  return value
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { normalize as normalizeForMatching };
