import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Role } from '@sy/db';
import { PLAN_FEATURES, accessLevel, hasFeature, type PlanFeature } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { FEATURE, IS_PUBLIC, NO_SITE, PLATFORM_ONLY, ROLES, type AuthUser } from '../common/decorators';
import { runWithoutTenant } from '../tenant/tenant.context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  sa: boolean; // isSuperAdmin
}

/**
 * ÇOK KİRACILILIK KATMANI 1/3 — istek doğrulama
 *
 * 1. Authorization: Bearer <token> doğrulanır
 * 2. X-Site-Id başlığındaki site için kullanıcının ÜYELİĞİ VE ROLÜ sorgulanır
 * 3. Sonuç request.user'a yazılır; TenantInterceptor bunu AsyncLocalStorage'a taşır
 *
 * Üyeliği olmayan bir siteyi istemek 403 döner — başlığı değiştirerek başka
 * sitenin verisine erişmek mümkün değildir.
 *
 * SaaS kuralları (site isteklerinde):
 *  - Süper yönetici üyesi olmadığı siteye yalnızca geçerli DESTEK ERİŞİMİ ile girer
 *  - Müşteri askıda/iptal → 403; ödeme gecikti/deneme bitti → okuma dışı istek 402
 *  - `@Feature` modülü müşterinin paketinde yoksa 403
 *
 * 403 mesajlarında "site" kelimesi geçmez: web istemcisi 403 + "site"de site
 * seçimini silip girişe yollar (yalnızca gerçekten bayat seçim için).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException('Oturum bulunamadı');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Oturum süresi dolmuş, lütfen tekrar giriş yapın');
    }

    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (platformOnly && !payload.sa) {
      throw new ForbiddenException('Bu işlem yalnızca platform yöneticisine açıktır');
    }

    const noSite =
      platformOnly ||
      this.reflector.getAllAndOverride<boolean>(NO_SITE, [context.getHandler(), context.getClass()]);

    const siteIdHeader = request.header('x-site-id') ?? null;
    let role: Role | null = null;
    let personId: string | null = null;

    if (!noSite) {
      if (!siteIdHeader) {
        throw new BadRequestException('Aktif site seçilmedi (X-Site-Id başlığı eksik)');
      }
      if (!UUID_RE.test(siteIdHeader)) {
        throw new BadRequestException('X-Site-Id geçerli bir kimlik değil');
      }

      // Üyelik ve site kontrolü global tablolarda yapılır → tenant filtresi devre dışı
      const [site, membership, support] = await runWithoutTenant(() =>
        Promise.all([
          this.db.site.findUnique({
            where: { id: siteIdHeader },
            select: {
              id: true,
              isActive: true,
              organization: {
                select: { status: true, trialEndsAt: true, paidUntil: true, plan: { select: { features: true } } },
              },
            },
          }),
          this.db.siteMembership.findUnique({
            where: { userId_siteId: { userId: payload.sub, siteId: siteIdHeader } },
            select: { role: true, isActive: true, personId: true },
          }),
          payload.sa
            ? this.db.supportAccess.findFirst({
                where: { userId: payload.sub, siteId: siteIdHeader, revokedAt: null, expiresAt: { gt: new Date() } },
                select: { id: true },
              })
            : null,
        ]),
      );

      // Var olmayan ya da pasif site, süper admin için de erişilemez
      if (!site || !site.isActive) {
        throw new ForbiddenException('Site bulunamadı veya pasif durumda');
      }

      if (!payload.sa) {
        if (!membership || !membership.isActive) {
          throw new ForbiddenException('Bu siteye erişim yetkiniz yok');
        }
        role = membership.role;
        personId = membership.personId;
      } else if (membership?.isActive) {
        role = membership.role;
        personId = membership.personId;
      } else {
        // Platform yöneticisi müşteri verisine kendiliğinden erişmez (KVKK):
        // gerekçeli, süreli destek erişimi açılmış olmalı (platform paneli)
        if (!support) {
          throw new ForbiddenException('Destek erişimi açılmamış. Platform panelinden gerekçe yazarak erişim açın.');
        }
        role = 'SUPER_ADMIN';
      }

      // Abonelik ve paket — destek erişimindeki platform yöneticisi etkilenmez
      if (!(payload.sa && role === 'SUPER_ADMIN')) {
        const org = site.organization;
        const access = accessLevel(org, new Date());
        if (access.level === 'BLOCKED') throw new ForbiddenException(access.reason);
        if (access.level === 'READ_ONLY' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          throw new HttpException(access.reason ?? 'Kayıtlar salt okunur', HttpStatus.PAYMENT_REQUIRED);
        }
        const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(FEATURE, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (feature && !hasFeature(org?.plan, feature)) {
          throw new ForbiddenException(`"${PLAN_FEATURES[feature]}" modülü paketinizde yok`);
        }
      }
    }

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !payload.sa && (!role || !required.includes(role))) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }

    // İkamet eden varsayılan olarak REDDEDİLİR: rol listesi olmayan uç noktalar
    // (cari listesi, kişi listesi, pano…) personel içindir. İkamet eden yalnızca
    // @Roles('RESIDENT') taşıyan portal uç noktalarına erişir.
    // (Mesajda "site" geçmesin: web istemcisi 403 + "site"de seçimi siler.)
    if (role === 'RESIDENT' && !payload.sa && !noSite && !required?.includes('RESIDENT')) {
      throw new ForbiddenException('Bu işlem ikamet eden hesabına kapalıdır');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.name,
      isSuperAdmin: payload.sa,
      siteId: noSite ? null : siteIdHeader,
      role,
      personId,
    };

    return true;
  }
}

function extractToken(request: Request): string | undefined {
  const header = request.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // İkamet Eden Portalı httpOnly cookie ile de çalışabilsin
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.access_token;
}
