import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@sy/db';

/** Kimlik doğrulaması istemeyen uç nokta (login, health) */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Aktif site seçimi gerektirmeyen uç nokta (site listesi, profil) */
export const NO_SITE = 'noSite';
export const NoSite = () => SetMetadata(NO_SITE, true);

/** Bu uç noktaya erişebilecek roller */
export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  siteId: string | null;
  role: Role | null;
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
