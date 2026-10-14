/**
 * Dónde se guardan los archivos subidos (logos, fotos). Hoy en disco local;
 * en producción se cambia por una implementación de S3 en StorageModule.
 */
export abstract class StorageService {
  /** Guarda el archivo y devuelve su URL pública */
  abstract save(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<string>;
  /** Borra un archivo a partir de la URL que devolvió `save` (si es suya) */
  abstract remove(url: string): Promise<void>;
}
