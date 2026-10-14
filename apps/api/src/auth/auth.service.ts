import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { LoginInput } from '@sy/shared';
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

  async listSites(userId: string, isSuperAdmin: boolean): Promise<SiteSummary[]> {
    return runWithoutTenant(async () => {
      if (isSuperAdmin) {
        const sites = await this.db.site.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, city: true, district: true },
        });
        return sites.map((s) => ({ ...s, role: 'SUPER_ADMIN' }));
      }

      const memberships = await this.db.siteMembership.findMany({
        where: { userId, isActive: true, site: { isActive: true } },
        include: { site: { select: { id: true, name: true, city: true, district: true } } },
        orderBy: { site: { name: 'asc' } },
      });

      return memberships.map((m) => ({
        id: m.site.id,
        name: m.site.name,
        city: m.site.city,
        district: m.site.district,
        role: m.role,
      }));
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
