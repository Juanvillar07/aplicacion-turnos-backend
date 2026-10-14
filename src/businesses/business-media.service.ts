import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../storage/image.service';

/** Fotos de la galería por negocio */
export const MAX_PHOTOS = 8;

const photoSelect = { id: true, url: true, sortOrder: true } as const;

/** Logo y galería de fotos de la página pública del negocio. */
@Injectable()
export class BusinessMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageService,
  ) {}

  async setLogo(businessId: string, file: Express.Multer.File | undefined) {
    const url = await this.images.saveImage(file, {
      folder: `businesses/${businessId}`,
      maxSize: 512,
    });
    const previous = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { logoUrl: true },
    });
    const business = await this.prisma.business.update({
      where: { id: businessId },
      data: { logoUrl: url },
    });
    await this.images.remove(previous.logoUrl);
    return business;
  }

  async removeLogo(businessId: string) {
    const previous = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { logoUrl: true },
    });
    const business = await this.prisma.business.update({
      where: { id: businessId },
      data: { logoUrl: null },
    });
    await this.images.remove(previous.logoUrl);
    return business;
  }

  listPhotos(businessId: string) {
    return this.prisma.businessPhoto.findMany({
      where: { businessId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: photoSelect,
    });
  }

  async addPhoto(businessId: string, file: Express.Multer.File | undefined) {
    const count = await this.prisma.businessPhoto.count({
      where: { businessId },
    });
    if (count >= MAX_PHOTOS) {
      throw new BadRequestException(
        `Puedes tener hasta ${MAX_PHOTOS} fotos. Borra una para subir otra.`,
      );
    }
    const url = await this.images.saveImage(file, {
      folder: `businesses/${businessId}/photos`,
      maxSize: 1600,
    });
    await this.prisma.businessPhoto.create({
      data: { businessId, url, sortOrder: count },
    });
    return this.listPhotos(businessId);
  }

  async removePhoto(businessId: string, photoId: string) {
    const photo = await this.prisma.businessPhoto.findFirst({
      where: { id: photoId, businessId },
    });
    if (!photo) throw new NotFoundException('Foto no encontrada');
    await this.prisma.businessPhoto.delete({ where: { id: photo.id } });
    await this.images.remove(photo.url);
    return this.listPhotos(businessId);
  }

  /** Nuevo orden: la lista debe tener exactamente las fotos del negocio */
  async reorderPhotos(businessId: string, ids: string[]) {
    const photos = await this.prisma.businessPhoto.findMany({
      where: { businessId },
      select: { id: true },
    });
    const current = new Set(photos.map((p) => p.id));
    if (ids.length !== current.size || !ids.every((id) => current.has(id))) {
      throw new BadRequestException('La lista de fotos no coincide');
    }
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.businessPhoto.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.listPhotos(businessId);
  }
}
