import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Membership } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { BusinessScoped } from '../common/tenancy/business-scoped.decorator';
import { CurrentMembership } from '../common/tenancy/current-membership.decorator';
import { Roles } from '../common/tenancy/roles.decorator';
import { MANAGER_ROLES } from '../common/tenancy/roles';
import { MAX_UPLOAD_BYTES } from '../storage/image.service';
import { BusinessMediaService, MAX_PHOTOS } from './business-media.service';

class ReorderPhotosDto {
  @IsArray()
  @ArrayMaxSize(MAX_PHOTOS)
  @IsUUID('4', { each: true })
  ids: string[];
}

/** Archivo en memoria (luego se procesa con sharp); límite de 5 MB */
const imageUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  );

/** Logo y fotos de la página pública: solo administradores. */
@Controller('businesses/:businessId')
@BusinessScoped()
@Roles(...MANAGER_ROLES)
export class BusinessMediaController {
  constructor(private readonly media: BusinessMediaService) {}

  @Post('logo')
  @imageUpload()
  async uploadLogo(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentMembership() membership: Membership,
  ) {
    const business = await this.media.setLogo(businessId, file);
    return { ...business, role: membership.role };
  }

  @Delete('logo')
  async removeLogo(
    @Param('businessId') businessId: string,
    @CurrentMembership() membership: Membership,
  ) {
    const business = await this.media.removeLogo(businessId);
    return { ...business, role: membership.role };
  }

  @Get('photos')
  listPhotos(@Param('businessId') businessId: string) {
    return this.media.listPhotos(businessId);
  }

  @Post('photos')
  @imageUpload()
  addPhoto(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.media.addPhoto(businessId, file);
  }

  @Put('photos/order')
  reorder(
    @Param('businessId') businessId: string,
    @Body() dto: ReorderPhotosDto,
  ) {
    return this.media.reorderPhotos(businessId, dto.ids);
  }

  @Delete('photos/:photoId')
  removePhoto(
    @Param('businessId') businessId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return this.media.removePhoto(businessId, photoId);
  }
}
