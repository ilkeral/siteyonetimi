import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('', { exclude: ['health'] });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:3000').split(','),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Site-Id'],
  });
  // Doğrulama Zod ile yapılır (packages/shared) — class-validator kullanılmaz.
  app.enableShutdownHooks();

  // --- OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Site Yönetim API')
    .setDescription(
      'Çok siteli site/apartman yönetim platformu. Tüm uç noktalar `X-Site-Id` başlığı ile aktif siteyi belirtir.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'X-Site-Id',
      in: 'header',
      required: false,
      description: 'Aktif site kimliği',
      schema: { type: 'string' },
    })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('API_PORT', 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`API hazır → http://localhost:${port}  (dokümantasyon: /docs)`);
}

void bootstrap();
