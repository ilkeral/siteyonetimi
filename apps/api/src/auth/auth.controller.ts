import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { changePasswordSchema, loginSchema, refreshSchema, type LoginInput } from '@sy/shared';
import { AuthService } from './auth.service';
import { CurrentUser, NoSite, Public, type AuthUser } from '../common/decorators';
import { ZodBody } from '../common/zod-validation.pipe';

@ApiTags('Kimlik')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'E-posta ve parola ile giriş' })
  login(@Body(new ZodBody(loginSchema)) dto: LoginInput, @Req() req: Request) {
    return this.auth.login(dto, { ip: req.ip, userAgent: req.header('user-agent') });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Access token yenileme (refresh token rotasyonlu)' })
  refresh(
    @Body(new ZodBody(refreshSchema)) dto: { refreshToken: string },
    @Req() req: Request,
  ) {
    return this.auth.refresh(dto.refreshToken, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Oturumu kapat (refresh token iptal edilir)' })
  async logout(@Body(new ZodBody(refreshSchema)) dto: { refreshToken: string }): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @NoSite()
  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Parola değiştir (diğer oturumlar kapanır, yeni token döner)' })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(changePasswordSchema)) dto: { currentPassword: string; newPassword: string },
    @Req() req: Request,
  ) {
    return this.auth.changePassword(user.id, dto, { ip: req.ip, userAgent: req.header('user-agent') });
  }

  @NoSite()
  @Get('me')
  @ApiOperation({ summary: 'Oturumdaki kullanıcı ve erişebildiği siteler' })
  async me(@CurrentUser() user: AuthUser) {
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isSuperAdmin: user.isSuperAdmin,
      },
      sites: await this.auth.listSites(user.id, user.isSuperAdmin),
    };
  }
}
