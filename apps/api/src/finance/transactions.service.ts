import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { toMinor } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { LedgerService } from './ledger.service';

export interface CollectionInput {
  /** Tahsil edilen cari (kişi) */
  accountId: string;
  /** Paranın girdiği kasa/banka hesabı */
  cashAccountId: string;
  amount: string | number;
  date: Date;
  description?: string;
  /** Banka hareketinden geliyorsa ilişkilendirilecek kayıt */
  bankTransactionId?: string;
}

export interface ExpenseInput {
  /** Tedarikçi carisi */
  accountId: string;
  categoryId: string;
  amount: string | number;
  date: Date;
  dueDate?: Date | null;
  description?: string;
  /** Talepten (iş takibi) doğan masraf ise */
  ticketId?: string;
}

export interface PaymentInput {
  /** Ödeme yapılan cari (tedarikçi/personel) */
  accountId: string;
  /** Paranın çıktığı kasa/banka */
  cashAccountId: string;
  amount: string | number;
  date: Date;
  description?: string;
}

/**
 * Tahsilat, gider faturası ve ödeme evraklarını üretir.
 * Tüm tutar doğrulamaları ve cari tip kontrolleri burada yapılır;
 * defter yazımı LedgerService üzerinden geçer.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  /** Tahsilat makbuzu: cari alacaklanır, kasa/banka borçlanır */
  async collect(input: CollectionInput) {
    const amountMinor = toMinor(input.amount);
    if (amountMinor <= 0) throw new BadRequestException('Tahsilat tutarı sıfırdan büyük olmalı');

    const [account, cashAccount] = await Promise.all([
      this.requireAccount(input.accountId),
      this.requireAccount(input.cashAccountId),
    ]);

    if (!['CASH', 'BANK'].includes(cashAccount.type)) {
      throw new BadRequestException('Tahsilat yalnızca kasa veya banka hesabına yapılabilir');
    }
    if (['CASH', 'BANK'].includes(account.type)) {
      throw new BadRequestException('Kasa/banka hesabından tahsilat yapılamaz, virman kullanın');
    }

    const document = await this.ledger.createPosted({
      type: 'COLLECTION',
      date: input.date,
      description: input.description ?? `${account.name} tahsilatı`,
      entries: [
        { accountId: input.accountId, creditMinor: amountMinor },
        { accountId: input.cashAccountId, debitMinor: amountMinor },
      ],
    });

    if (input.bankTransactionId) {
      await this.db.bankTransaction.update({
        where: { id: input.bankTransactionId },
        data: {
          matchStatus: 'MANUAL_MATCHED',
          matchedDocumentId: document.id,
          matchedAt: new Date(),
        },
      });
    }

    return document;
  }

  /** Gider faturası: tedarikçi alacaklanır (biz borçlanırız), gider kategorisine yazılır */
  async expense(input: ExpenseInput) {
    const amountMinor = toMinor(input.amount);
    if (amountMinor <= 0) throw new BadRequestException('Fatura tutarı sıfırdan büyük olmalı');

    const account = await this.requireAccount(input.accountId);
    if (['CASH', 'BANK'].includes(account.type)) {
      throw new BadRequestException('Gider faturası kasa/banka hesabına kesilemez');
    }

    const category = await this.db.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, kind: true },
    });
    if (!category) throw new NotFoundException('Gider kategorisi bulunamadı');
    if (category.kind !== 'EXPENSE') {
      throw new BadRequestException('Seçilen kategori bir gider kategorisi değil');
    }

    return this.ledger.createPosted({
      type: 'EXPENSE',
      date: input.date,
      dueDate: input.dueDate ?? null,
      description: input.description ?? `${account.name} faturası`,
      ticketId: input.ticketId,
      entries: [
        {
          accountId: input.accountId,
          creditMinor: amountMinor,
          categoryId: input.categoryId,
        },
      ],
    });
  }

  /** Tedarikçiye/personele ödeme: cari borçlanır, kasa/banka alacaklanır */
  async pay(input: PaymentInput) {
    const amountMinor = toMinor(input.amount);
    if (amountMinor <= 0) throw new BadRequestException('Ödeme tutarı sıfırdan büyük olmalı');

    const [account, cashAccount] = await Promise.all([
      this.requireAccount(input.accountId),
      this.requireAccount(input.cashAccountId),
    ]);
    if (!['CASH', 'BANK'].includes(cashAccount.type)) {
      throw new BadRequestException('Ödeme yalnızca kasa veya banka hesabından yapılabilir');
    }

    return this.ledger.createPosted({
      type: 'PAYMENT',
      date: input.date,
      description: input.description ?? `${account.name} ödemesi`,
      entries: [
        { accountId: input.accountId, debitMinor: amountMinor },
        { accountId: input.cashAccountId, creditMinor: amountMinor },
      ],
    });
  }

  /** Kasa ↔ banka virmanı */
  async transfer(input: {
    fromAccountId: string;
    toAccountId: string;
    amount: string | number;
    date: Date;
    description?: string;
  }) {
    const amountMinor = toMinor(input.amount);
    if (amountMinor <= 0) throw new BadRequestException('Virman tutarı sıfırdan büyük olmalı');
    if (input.fromAccountId === input.toAccountId) {
      throw new BadRequestException('Aynı hesaba virman yapılamaz');
    }

    const [from, to] = await Promise.all([
      this.requireAccount(input.fromAccountId),
      this.requireAccount(input.toAccountId),
    ]);
    if (!['CASH', 'BANK'].includes(from.type) || !['CASH', 'BANK'].includes(to.type)) {
      throw new BadRequestException('Virman yalnızca kasa/banka hesapları arasında yapılır');
    }

    return this.ledger.createPosted({
      type: 'TRANSFER',
      date: input.date,
      description: input.description ?? `${from.name} → ${to.name} virman`,
      entries: [
        { accountId: input.toAccountId, debitMinor: amountMinor },
        { accountId: input.fromAccountId, creditMinor: amountMinor },
      ],
    });
  }

  private async requireAccount(accountId: string) {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, type: true, isActive: true },
    });
    if (!account) throw new NotFoundException('Cari hesap bulunamadı');
    if (!account.isActive) throw new BadRequestException(`${account.name} pasif durumda`);
    return account;
  }
}
