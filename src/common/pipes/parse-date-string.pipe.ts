import { BadRequestException, PipeTransform } from '@nestjs/common';
import { isValidDateString } from '../../availability/time.utils';

/** Valida un parámetro `YYYY-MM-DD`. */
export class ParseDateStringPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !isValidDateString(value)) {
      throw new BadRequestException(
        'La fecha debe tener el formato AAAA-MM-DD',
      );
    }
    return value;
  }
}
