import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { Request } from 'express';
import type { AuthUser } from '../common/decorators';
import { runWithTenant } from './tenant.context';

/**
 * AuthGuard'ın doğruladığı site/kullanıcı bilgisini AsyncLocalStorage'a taşır.
 * Bu noktadan sonra isteğin tüm akışında (servisler, Prisma eklentisi)
 * aktif site bilinir.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;

    return runWithTenant(
      {
        siteId: user?.siteId ?? null,
        userId: user?.id ?? null,
        role: user?.role ?? null,
        personId: user?.personId ?? null,
        isSuperAdmin: user?.isSuperAdmin ?? false,
      },
      () => next.handle(),
    );
  }
}
