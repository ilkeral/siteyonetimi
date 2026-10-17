import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { accessLevel, type AccessLevel, type LoginInput, type OrganizationStatus } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { runWithoutTenant } from '../tenant/tenant.context';
import type { AccessTokenPayload } from './auth.guard';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface SiteSummary {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  role: string;
  /** Platform yöneticisinin destek erişimi bitişi (üyelikle girişte null) */
  supportUntil: Date | null;
  /** Sitenin müşteri hesabı ve abonelik durumu (her site bir müşteriye bağlıdır) */
  subscription: {
    organizationName: string;
    status: OrganizationStatus;
    planName: string | null;
    access: AccessLevel;
    reason: string | null;
    daysLeft: number | null;
    features: string[] | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
  ) {}

  async login(input: LoginInput, meta: { ip?: string; userAgent?: string }) {
    const user = await runWithoutTenant(() =>
      this.db.user.findUnique({ where: { email: input.email.toLowerCase().trim() } }),
    );

    // Kullanıcı yoksa da parola doğrulaması kadar zaman harcanır (timing attack)
    const valid = user
      ? await argon2.verify(user.passwordHash, input.password).catch(() => false)
      : await argon2
          .hash(input.password)
          .then(() => false)
          .catch(() => false);

    if (!user || !valid) {
      throw new UnauthorizedException('E-posta veya parola hatalı');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Hesabınız pasif durumda, yöneticinizle görüşün');
    }

    const tokens = await this.issueTokens(user.id, user.email, user.fullName, user.isSuperAdmin, meta);
    const sites = await this.listSites(user.id, user.isSuperAdmin);

    await runWithoutTenant(() =>
      this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isSuperAdmin: user.isSuperAdmin,
      },
      sites,
    };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const tokenHash = hashToken(refreshToken);

    const stored = await runWithoutTenant(() =>
      this.db.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } }),
    );

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Oturum geçersiz, lütfen tekrar giriş yapın');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException('Hesabınız pasif durumda');
    }

    // Rotasyon: eski token iptal edilir, yenisi verilir
    await runWithoutTenant(() =>
      this.db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
    );

    return this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.fullName,
      stored.user.isSuperAdmin,
      meta,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await runWithoutTenant(() =>
      this.db.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  /**
   * Parola değiştirme. Diğer cihazlardaki oturumlar kapatılır (tüm refresh
   * token'lar iptal); bu cihaz için yeni token çifti döner.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    meta: { ip?: string; userAgent?: string },
  ) {
    const user = await runWithoutTenant(() => this.db.user.findUnique({ where: { id: userId } }));
    if (!user || !user.isActive) throw new UnauthorizedException('Oturum geçersiz');

    const valid = await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false);
    if (!valid) throw new BadRequestException('Mevcut parola hatalı');
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException('Yeni parola eskisiyle aynı olamaz');
    }

    const passwordHash = await argon2.hash(input.newPassword);
    await runWithoutTenant(() =>
      this.db.$transaction([
        this.db.user.update({ where: { id: userId }, data: { passwordHash } }),
        this.db.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]),
    );
    return this.issueTokens(user.id, user.email, user.fullName, user.isSuperAdmin, meta);
  }

  /**
   * Kullanıcının girebildiği siteler + her sitenin abonelik durumu (uyarı
   * bandı ve kilitli modüller için). Süper yönetici yalnızca üyesi olduğu ve
   * geçerli destek erişimi açtığı siteleri görür — tüm müşterileri değil.
   */
  async listSites(userId: string, isSuperAdmin: boolean): Promise<SiteSummary[]> {
    return runWithoutTenant(async () => {
      const siteSelect = {
        id: true,
        name: true,
        city: true,
        district: true,
        organization: {
          select: {
            id: true,
            name: true,
            status: true,
            trialEndsAt: true,
            paidUntil: true,
            plan: { select: { name: true, features: true } },
          },
        },
      } as const;
      const [memberships, support] = await Promise.all([
        this.db.siteMembership.findMany({
          where: { userId, isActive: true, site: { isActive: true } },
          select: { role: true, site: { select: siteSelect } },
          orderBy: { site: { name: 'asc' } },
        }),
        isSuperAdmin
          ? this.db.supportAccess.findMany({
              where: { userId, revokedAt: null, expiresAt: { gt: new Date() }, site: { isActive: true } },
              select: { expiresAt: true, site: { select: siteSelect } },
              orderBy: { expiresAt: 'desc' },
            })
          : [],
      ]);

      const now = new Date();
      const summarize = (site: (typeof memberships)[number]['site'], role: string, supportUntil: Date | null): SiteSummary => {
        const org = site.organization;
        const access = accessLevel(org, now);
        return {
          id: site.id,
          name: site.name,
          city: site.city,
          district: site.district,
          role,
          supportUntil,
          subscription: {
            organizationName: org.name,
            status: org.status,
            planName: org.plan?.name ?? null,
            access: access.level,
            reason: access.reason,
            daysLeft: access.daysLeft,
            // null = tüm modüller (paketsiz / özel sözleşme)
            features: org.plan ? org.plan.features : null,
          },
        };
      };

      const result = memberships.map((m) => summarize(m.site, m.role, null));
      const seen = new Set(result.map((s) => s.id));
      for (const grant of support) {
        if (!seen.has(grant.site.id)) {
          result.push(summarize(grant.site, 'SUPER_ADMIN', grant.expiresAt));
          seen.add(grant.site.id);
        }
      }
      return result;
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    fullName: string,
    isSuperAdmin: boolean,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const payload: AccessTokenPayload = {
      sub: userId,
      email,
      name: fullName,
      sa: isSuperAdmin,
    };

    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '7d');

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    // Refresh token rastgele üretilir ve HASH'i saklanır (veritabanı sızsa bile kullanılamaz)
    const refreshToken = randomBytes(48).toString('base64url');
    await runWithoutTenant(() =>
      this.db.refreshToken.create({
        data: {
          userId,
          tokenHash: hashToken(refreshToken),
          expiresAt: new Date(Date.now() + parseDuration(refreshTtl)),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      }),
    );

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** '7d' | '15m' | '30s' → milisaniye */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Geçersiz süre: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2];
  const factors: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * factors[unit];
}
