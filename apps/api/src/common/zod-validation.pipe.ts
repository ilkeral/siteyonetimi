import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * `@Body(new ZodBody(personSchema)) dto: PersonInput`
 *
 * Doğrulama şemaları packages/shared'dan gelir — frontend form doğrulaması ile
 * birebir aynı kuralları kullanırız.
 */
export class ZodBody<T> implements PipeTransform {
  // Girdi tipi serbest: default/transform içeren şemalarda girdi ≠ çıktı
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      message: 'Gönderilen veri geçersiz',
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

/** Query string doğrulaması (sayfalama, filtreler) */
export class ZodQuery<T> extends ZodBody<T> {}
