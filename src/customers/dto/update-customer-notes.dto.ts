import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCustomerNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Las notas pueden tener máximo 1000 caracteres' })
  notes?: string | null;
}
