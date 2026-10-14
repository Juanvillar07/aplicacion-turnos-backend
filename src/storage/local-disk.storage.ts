import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join, normalize, sep } from 'path';
import { StorageService } from './storage.service';

/** Carpeta servida por el backend en /uploads (ver main.ts) */
export const UPLOADS_DIR = join(process.cwd(), 'uploads');

/** Guarda los archivos en `uploads/` y los sirve el propio backend. */
@Injectable()
export class LocalDiskStorage extends StorageService {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    super();
    // URL con la que el navegador llega al backend (sin /api)
    this.baseUrl = (
      config.get<string>('PUBLIC_API_URL') ??
      `http://localhost:${config.get('PORT', 3000)}`
    ).replace(/\/$/, '');
  }

  async save(key: string, data: Buffer): Promise<string> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return `${this.baseUrl}/uploads/${key}`;
  }

  async remove(url: string): Promise<void> {
    const prefix = `${this.baseUrl}/uploads/`;
    if (!url.startsWith(prefix)) return;
    try {
      await unlink(this.pathOf(url.slice(prefix.length)));
    } catch (error) {
      this.logger.warn(`No se pudo borrar ${url}: ${(error as Error).message}`);
    }
  }

  /** Ruta dentro de uploads/ (evita que una clave escape de la carpeta) */
  private pathOf(key: string) {
    const path = normalize(join(UPLOADS_DIR, key));
    if (!path.startsWith(UPLOADS_DIR + sep)) {
      throw new Error('Ruta de archivo no válida');
    }
    return path;
  }
}
