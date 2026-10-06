import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateResourceDto } from './create-resource.dto';

/** El tipo no se cambia: un profesional (persona) solo existe por invitación. */
export class UpdateResourceDto extends PartialType(
  OmitType(CreateResourceDto, ['serviceIds', 'type'] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
