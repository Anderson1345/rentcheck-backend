import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const LIMITE_FEED_POR_DEFECTO = 20;
export const LIMITE_FEED_MAXIMO = 50;

export class FeedAlertasQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Solo leídas (`true`) o solo no leídas (`false`). Sin él, todas. No cambia `no_leidas`.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  leida?: boolean;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: LIMITE_FEED_MAXIMO,
    default: LIMITE_FEED_POR_DEFECTO,
    description: `Alertas por página (1 a ${LIMITE_FEED_MAXIMO}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_FEED_MAXIMO)
  limite?: number;

  @ApiPropertyOptional({
    description:
      'Cursor opaco: el `siguiente_cursor` de la página anterior. Uno inválido responde 400.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
