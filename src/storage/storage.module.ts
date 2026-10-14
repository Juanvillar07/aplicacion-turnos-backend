import { Global, Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { LocalDiskStorage } from './local-disk.storage';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    // En producción: cambiar por la implementación de S3
    { provide: StorageService, useClass: LocalDiskStorage },
    ImageService,
  ],
  exports: [StorageService, ImageService],
})
export class StorageModule {}
