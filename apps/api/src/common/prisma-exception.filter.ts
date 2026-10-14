import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@sy/db';
import type { Response } from 'express';

/**
 * Prisma hatalarını kullanıcının anlayacağı Türkçe mesajlara çevirir.
 * Ham veritabanı hatası istemciye hiçbir zaman sızmaz.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Prisma');

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.BAD_REQUEST;
    let message = 'İşlem tamamlanamadı';

    switch (exception.code) {
      case 'P2002': {
        const fields = (exception.meta?.target as string[] | undefined)?.join(', ');
        status = HttpStatus.CONFLICT;
        message = fields
          ? `Bu kayıt zaten mevcut (${fields})`
          : 'Aynı kayıttan zaten var';
        break;
      }
      case 'P2003':
        status = HttpStatus.CONFLICT;
        message = 'İlişkili kayıtlar olduğu için bu işlem yapılamıyor';
        break;
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        message = 'Kayıt bulunamadı';
        break;
      case 'P2023':
        status = HttpStatus.BAD_REQUEST;
        message = 'Geçersiz kayıt numarası';
        break;
      default:
        this.logger.error(`Beklenmeyen Prisma hatası ${exception.code}: ${exception.message}`);
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Beklenmeyen bir hata oluştu';
    }

    response.status(status).json({ statusCode: status, message });
  }
}
