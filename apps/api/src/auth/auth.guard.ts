import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Role } from '@sy/db';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { IS_PUBLIC, NO_SITE, ROLES, type AuthUser } from '../common/decorators';
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

    const noSite = this.reflector.getAllAndOverride<boolean>(NO_SITE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const siteIdHeader = request.header('x-site-id') ?? null;
    let role: Role | null = null;

    if (!noSite) {
      if (!siteIdHeader) {
        throw new BadRequestException('Aktif site seçilmedi (X-Site-Id başlığı eksik)');
      }
      if (!UUID_RE.test(siteIdHeader)) {
        throw new BadRequestException('X-Site-Id geçerli bir kimlik değil');
      }

      // Üyelik ve site kontrolü global tablolarda yapılır → tenant filtresi devre dışı
      const [site, membership] = await runWithoutTenant(() =>
        Promise.all([
          this.db.site.findUnique({
            where: { id: siteIdHeader },
            select: { id: true, isActive: true },
          }),
          this.db.siteMembership.findUnique({
            where: { userId_siteId: { userId: payload.sub, siteId: siteIdHeader } },
            select: { role: true, isActive: true },
          }),
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
      } else {
        role = membership?.role ?? 'SUPER_ADMIN';
      }
    }

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !payload.sa && (!role || !required.includes(role))) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.name,
      isSuperAdmin: payload.sa,
      siteId: noSite ? null : siteIdHeader,
      role,
    };

    return true;
  }
}

function extractToken(request: Request): string | undefined {
  const header = request.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Sakin portalı httpOnly cookie ile de çalışabilsin
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.access_token;
}
