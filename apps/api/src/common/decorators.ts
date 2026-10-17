import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@sy/db';
import type { PlanFeature } from '@sy/shared';

/** Kimlik doğrulaması istemeyen uç nokta (login, health) */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Aktif site seçimi gerektirmeyen uç nokta (site listesi, profil) */
export const NO_SITE = 'noSite';
export const NoSite = () => SetMetadata(NO_SITE, true);

/** Bu uç noktaya erişebilecek roller */
export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Paketle açılan modül: müşterinin paketinde yoksa 403 (sınıf ya da yöntem düzeyinde) */
export const FEATURE = 'planFeature';
export const Feature = (feature: PlanFeature) => SetMetadata(FEATURE, feature);

/** Yalnızca platform (süper) yöneticisi — site seçimi gerekmez */
export const PLATFORM_ONLY = 'platformOnly';
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  siteId: string | null;
  role: Role | null;
  /** İkamet eden (RESIDENT) üyeliğinin bağlı olduğu kişi kaydı */
  personId: string | null;
}

/** `@CurrentUser() user: AuthUser` */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);

/** `@SiteId() siteId: string` */
export const SiteId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  return request.user?.siteId ?? null;
});
