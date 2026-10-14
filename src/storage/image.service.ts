import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as sharp from 'sharp';
import { StorageService } from './storage.service';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Procesa imágenes subidas: valida el formato real (no el que dice el
 * navegador), corrige la rotación, reduce el tamaño, convierte a WebP y quita
 * los metadatos (EXIF, ubicación GPS de la foto).
 */
@Injectable()
export class ImageService {
  constructor(private readonly storage: StorageService) {}

  async saveImage(
    file: Express.Multer.File | undefined,
    { folder, maxSize }: { folder: string; maxSize: number },
  ): Promise<string> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Selecciona una imagen');
    }
    let format: string | undefined;
    try {
      format = (await sharp(file.buffer).metadata()).format;
    } catch {
      format = undefined;
    }
    if (!format || !ALLOWED_FORMATS.has(format)) {
      throw new BadRequestException('La imagen debe ser JPG, PNG o WebP');
    }

    const output = await sharp(file.buffer)
      .rotate() // según la orientación EXIF, antes de quitar los metadatos
      .resize({
        width: maxSize,
        height: maxSize,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer(); // sharp no copia metadatos a la salida salvo que se pida

    return this.storage.save(
      `${folder}/${randomUUID()}.webp`,
      output,
      'image/webp',
    );
  }

  remove(url: string | null | undefined) {
    return url ? this.storage.remove(url) : Promise.resolve();
  }
}
