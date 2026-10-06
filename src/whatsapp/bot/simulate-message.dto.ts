import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SimulateMessageDto {
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  /** id del botón o fila de lista tocado */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  replyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  profileName?: string;
}
