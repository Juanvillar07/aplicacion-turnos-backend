import { IsArray, IsUUID } from 'class-validator';

export class SetResourceServicesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds: string[];
}
