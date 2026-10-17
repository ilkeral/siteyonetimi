import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import type { AnnouncementInput } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, requireSiteId } from '../tenant/tenant.context';

/** Karışabilen karakterler (0/O, 1/l/I) yok */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';

/** Parola kuralını (harf + rakam, 8+) karşılayan, okunaklı geçici parola */
export function temporaryPassword(): string {
  const letters = Array.from({ length: 7 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]);
  const digits = Array.from({ length: 3 }, () => PASSWORD_DIGITS[randomInt(PASSWORD_DIGITS.length)]);
  return `${letters.join('')}${digits.join('')}`;
}

/**
 * Yönetim tarafı: duyurular ve ikamet edenlere portal erişimi.
 *
 * Portal erişimi = ikamet eden için `User` + bu sitede `RESIDENT` rolünde ve kişi
 * kaydına bağlı (`personId`) `SiteMembership`. User ve SiteMembership global
 * tablolardır; sorgular her zaman açık `siteId` ile yapılır.
 */
@Injectable()
export class PortalAdminService {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ---------------------------------------------------------------- duyuru

  listAnnouncements() {
    return this.db.announcement.findMany({ orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }] });
  }

  createAnnouncement(input: AnnouncementInput) {
    return this.db.announcement.create({
      data: { siteId: requireSiteId(), createdById: currentUserId(), ...this.announcementData(input) },
    });
  }

  async updateAnnouncement(id: string, input: AnnouncementInput) {
    await this.requireAnnouncement(id);
    return this.db.announcement.update({ where: { id }, data: this.announcementData(input) });
  }

  async removeAnnouncement(id: string) {
    await this.requireAnnouncement(id);
    await this.db.announcement.delete({ where: { id } });
    return { id, deleted: true };
  }

  private announcementData(input: AnnouncementInput) {
    return {
      title: input.title,
      body: input.body,
      publishAt: input.publishAt ?? new Date(),
      expireAt: input.expireAt ?? null,
      isPinned: input.isPinned,
      isActive: input.isActive,
    };
  }

  private async requireAnnouncement(id: string) {
    const announcement = await this.db.announcement.findUnique({ where: { id }, select: { id: true } });
    if (!announcement) throw new NotFoundException('Duyuru bulunamadı');
  }

  // --------------------------------------------------------- portal erişimi

  async access(personId: string) {
    await this.requirePerson(personId);
    const membership = await this.membership(personId);
    return membership
      ? {
          enabled: membership.isActive,
          email: membership.user.email,
          lastLoginAt: membership.user.lastLoginAt,
          createdAt: membership.createdAt,
        }
      : { enabled: false, email: null, lastLoginAt: null, createdAt: null };
  }

  /**
   * Erişim ver. E-posta yeni ise kullanıcı geçici parolayla açılır ve parola
   * **yalnızca bu yanıtta** döner (saklanmaz). E-posta başka sitede zaten
   * ikamet eden olarak kayıtlıysa mevcut hesaba bu site eklenir, parolaya dokunulmaz.
   */
  async grant(personId: string, email: string) {
    const siteId = requireSiteId();
    const person = await this.requirePerson(personId);

    const existingAccess = await this.membership(personId);
    if (existingAccess?.isActive) throw new ConflictException('Bu kişinin portal erişimi zaten açık');

    let user = await this.db.user.findUnique({ where: { email } });
    let password: string | null = null;

    if (user) {
      const staff = await this.db.siteMembership.findFirst({
        where: { userId: user.id, role: { not: 'RESIDENT' } },
        select: { id: true },
      });
      // Personel hesabına ikamet eden rolü eklemek yetki karışıklığı doğurur
      if (staff || user.isSuperAdmin) {
        throw new ConflictException('Bu e-posta bir personel hesabına ait. Farklı bir e-posta kullanın.');
      }
      const sameSite = await this.db.siteMembership.findUnique({
        where: { userId_siteId: { userId: user.id, siteId } },
      });
      if (sameSite && sameSite.personId && sameSite.personId !== personId && sameSite.isActive) {
        throw new ConflictException('Bu e-posta bu sitede başka bir ikamet edene bağlı');
      }
    } else {
      password = temporaryPassword();
      user = await this.db.user.create({
        data: {
          email,
          passwordHash: await argon2.hash(password),
          fullName: `${person.firstName} ${person.lastName}`,
        },
      });
    }

    await this.db.$transaction([
      // Eski (pasif) erişim farklı bir e-postayla verilmişse onu kaldır
      this.db.siteMembership.deleteMany({
        where: { siteId, personId, role: 'RESIDENT', userId: { not: user.id } },
      }),
      this.db.siteMembership.upsert({
        where: { userId_siteId: { userId: user.id, siteId } },
        create: { userId: user.id, siteId, role: 'RESIDENT', personId },
        update: { role: 'RESIDENT', personId, isActive: true },
      }),
      ...(person.email ? [] : [this.db.person.update({ where: { id: personId }, data: { email } })]),
    ]);

    return { email, temporaryPassword: password, existingUser: password === null };
  }

  async revoke(personId: string) {
    await this.requirePerson(personId);
    const membership = await this.membership(personId);
    if (!membership?.isActive) throw new NotFoundException('Bu kişinin açık portal erişimi yok');
    await this.db.$transaction([
      this.db.siteMembership.update({ where: { id: membership.id }, data: { isActive: false } }),
      // Açık oturumlar da kapansın
      this.db.refreshToken.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { personId, enabled: false };
  }

  /** Parolayı sıfırlar — yalnızca başka hiçbir yerde personel olmayan ikamet eden hesabında */
  async resetPassword(personId: string) {
    await this.requirePerson(personId);
    const membership = await this.membership(personId);
    if (!membership?.isActive) throw new NotFoundException('Bu kişinin açık portal erişimi yok');

    const staff = await this.db.siteMembership.findFirst({
      where: { userId: membership.userId, role: { not: 'RESIDENT' } },
      select: { id: true },
    });
    if (staff || membership.user.isSuperAdmin) {
      throw new ConflictException('Personel hesabının parolası buradan sıfırlanamaz');
    }

    const password = temporaryPassword();
    await this.db.$transaction([
      this.db.user.update({ where: { id: membership.userId }, data: { passwordHash: await argon2.hash(password) } }),
      this.db.refreshToken.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { email: membership.user.email, temporaryPassword: password };
  }

  private membership(personId: string) {
    return this.db.siteMembership.findFirst({
      where: { siteId: requireSiteId(), personId, role: 'RESIDENT' },
      include: { user: { select: { email: true, lastLoginAt: true, isSuperAdmin: true } } },
      orderBy: { isActive: 'desc' },
    });
  }

  /** Tenant filtreli: başka sitenin kişisi "bulunamadı" olur */
  private async requirePerson(id: string) {
    const person = await this.db.person.findUnique({
      where: { id },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!person) throw new NotFoundException('Kişi bulunamadı');
    return person;
  }
}
